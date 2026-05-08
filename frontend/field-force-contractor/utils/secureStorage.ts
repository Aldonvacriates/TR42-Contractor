// secureStorage.ts
// Thin wrapper around expo-secure-store for tokens and PINs.

import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY       = 'auth_token';
const OFFLINE_PIN_KEY = 'offline_pin';

// ── Token helpers ──────────────────────────────────────────────

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function deleteToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// ── Offline PIN helpers ────────────────────────────────────────

export async function saveOfflinePin(pin: string): Promise<void> {
  await SecureStore.setItemAsync(OFFLINE_PIN_KEY, pin);
}

export async function getOfflinePin(): Promise<string | null> {
  return SecureStore.getItemAsync(OFFLINE_PIN_KEY);
}

export async function deleteOfflinePin(): Promise<void> {
  await SecureStore.deleteItemAsync(OFFLINE_PIN_KEY);
}

// ── PIN verification ───────────────────────────────────────────
//
// DEMO_FALLBACK_PIN is used when SecureStore has nothing stored yet
// (fresh install, before a real PIN has been provisioned). Both the
// OfflineLogin screen and the in-task verification modal call
// verifyOfflinePin so they share a single source of truth — change
// the fallback here and both flows pick it up.
//
// PRODUCTION TODO:
//  1. Provision a real per-user PIN at first login (pulled from the
//     backend or set via a dedicated screen) and persist via
//     saveOfflinePin().
//  2. Delete DEMO_FALLBACK_PIN below and have verifyOfflinePin return
//     false when SecureStore has nothing stored.
export const DEMO_FALLBACK_PIN = '123456';

export async function verifyOfflinePin(entered: string): Promise<boolean> {
  if (!entered) return false;
  const stored = await getOfflinePin();
  if (stored && stored.length > 0) return entered === stored;
  // Fallback while no real PIN is provisioned. Remove for production.
  return entered === DEMO_FALLBACK_PIN;
}
