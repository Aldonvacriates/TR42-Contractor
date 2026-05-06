// OfflineBanner.tsx
// Thin status strip rendered by MainFrame. Stays out of the way when the
// device is online with nothing queued; surfaces a warning when offline, and
// reports the outbox backlog (+ a Sync Now button) when items are pending.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useNetwork } from '../contexts/NetworkContext';
import { colors, spacing, fontSize, fonts } from '../constants/theme';

export function OfflineBanner() {
  const { isOnline, pendingSync, isSyncing, triggerSync } = useNetwork();

  if (isOnline && pendingSync === 0 && !isSyncing) return null;

  const bg = !isOnline
    ? 'rgba(245, 158, 11, 0.15)'
    : 'rgba(59, 130, 246, 0.15)';
  const border = !isOnline ? colors.warning : colors.primary;
  const textColor = !isOnline ? colors.warning : colors.primary;

  let label: string;
  if (!isOnline && pendingSync > 0) {
    label = `Offline — ${pendingSync} change${pendingSync === 1 ? '' : 's'} will sync when connected`;
  } else if (!isOnline) {
    label = 'Offline — changes you make will sync when you reconnect';
  } else if (isSyncing) {
    label = `Syncing ${pendingSync} change${pendingSync === 1 ? '' : 's'}…`;
  } else {
    label = `${pendingSync} change${pendingSync === 1 ? '' : 's'} pending sync`;
  }

  return (
    <View style={[styles.wrap, { backgroundColor: bg, borderColor: border }]}>
      <Ionicons
        name={!isOnline ? 'cloud-offline-outline' : 'cloud-upload-outline'}
        size={14}
        color={textColor}
      />
      <Text style={[styles.text, { color: textColor }]} numberOfLines={2}>{label}</Text>
      {isOnline && pendingSync > 0 && !isSyncing && (
        <TouchableOpacity onPress={triggerSync} style={styles.syncBtn} activeOpacity={0.7}>
          <Text style={[styles.syncBtnText, { color: textColor }]}>Sync now</Text>
        </TouchableOpacity>
      )}
      {isSyncing && <ActivityIndicator size="small" color={textColor} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing.sm,
    paddingVertical:   6,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
  },
  text: {
    flex:       1,
    fontFamily: fonts.regular,
    fontSize:   fontSize.xs,
  },
  syncBtn: {
    paddingVertical:   2,
    paddingHorizontal: spacing.sm,
  },
  syncBtnText: {
    fontFamily: fonts.bold,
    fontSize:   fontSize.xs,
  },
});
