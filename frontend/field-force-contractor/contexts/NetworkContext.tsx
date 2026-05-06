// NetworkContext.tsx
// Single source of truth for "is the device online?". Subscribes to NetInfo
// and also exposes a manual refresh + pending-sync count so screens can show
// accurate status pills and offline banners.
//
// When the device transitions offline → online the provider triggers a drain
// of the outbox queue via the syncRunner registered by utils/api.ts. Keeping
// the drain wiring inside the provider (instead of scattering useEffects in
// screens) means the queue is replayed automatically regardless of which
// screen the user is on when connectivity returns.

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

import { pendingCount } from '../utils/outbox';

interface NetworkContextType {
  isOnline:      boolean;
  isSyncing:     boolean;
  pendingSync:   number;
  refresh:       () => Promise<void>;
  triggerSync:   () => Promise<void>;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

// utils/api.ts registers its drain function here so the provider can call it
// without pulling in a circular import at module load time.
let _syncRunner: (() => Promise<void>) | null = null;
export function registerSyncRunner(fn: () => Promise<void>) {
  _syncRunner = fn;
}

function deriveOnline(state: NetInfoState): boolean {
  if (state.isConnected === false) return false;
  // isInternetReachable is null before the first probe completes — treat
  // that as "probably online" so the very first request isn't held up.
  if (state.isInternetReachable === false) return false;
  return true;
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [isOnline,    setIsOnline]    = useState(true);
  const [isSyncing,   setIsSyncing]   = useState(false);
  const [pendingSync, setPendingSync] = useState(0);

  // Track the previous online state so we only fire the drain on a real
  // offline → online transition, not on every re-render.
  const wasOnlineRef = useRef(true);

  const refreshPending = useCallback(async () => {
    try {
      setPendingSync(await pendingCount());
    } catch {
      // DB not ready on very first launch — safe to ignore.
    }
  }, []);

  const triggerSync = useCallback(async () => {
    if (!_syncRunner || isSyncing) return;
    setIsSyncing(true);
    try {
      await _syncRunner();
    } finally {
      setIsSyncing(false);
      await refreshPending();
    }
  }, [isSyncing, refreshPending]);

  const refresh = useCallback(async () => {
    const state = await NetInfo.fetch();
    setIsOnline(deriveOnline(state));
    await refreshPending();
  }, [refreshPending]);

  useEffect(() => {
    refresh();

    const unsubscribe = NetInfo.addEventListener(state => {
      const next = deriveOnline(state);
      setIsOnline(next);

      if (next && !wasOnlineRef.current) {
        // Came back online — replay the queue.
        triggerSync();
      }
      wasOnlineRef.current = next;
    });

    const interval = setInterval(refreshPending, 5_000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh, refreshPending, triggerSync]);

  return (
    <NetworkContext.Provider
      value={{ isOnline, isSyncing, pendingSync, refresh, triggerSync }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextType {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork() must be used inside <NetworkProvider>');
  return ctx;
}
