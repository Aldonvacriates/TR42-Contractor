// ============================================
// PPEChecklistModal.tsx — Pre-task PPE attestation
//
// Mounted by TicketDetailScreen as part of the verification state
// machine. After identity + location pass, the contractor sees this
// modal and must check each required PPE item before the Start Task
// PUT goes out. Styling mirrors the modalOverlay / modalCard pattern
// in TicketDetailScreen so the visual flow stays consistent.
// ============================================

import React, { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { REQUIRED_PPE_ITEMS } from '../constants/ppe';

interface Props {
  visible: boolean;
  onConfirm: (checkedIds: string[]) => void;
  onCancel: () => void;
}

const ORANGE = '#ff8c00';
const BORDER = '#2d3544';
const CARD_BG = '#1c2330';
const ROW_BG = '#0f1420';

export default function PPEChecklistModal({ visible, onConfirm, onCancel }: Props) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set());

  // Reset state every time the modal becomes visible so a previous
  // canceled attempt doesn't leak into a fresh start.
  useEffect(() => {
    if (visible) setChecked(new Set());
  }, [visible]);

  const allChecked = checked.size === REQUIRED_PPE_ITEMS.length;

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const checkAll = () => {
    if (allChecked) setChecked(new Set());
    else setChecked(new Set(REQUIRED_PPE_ITEMS.map(i => i.id)));
  };

  const handleConfirm = () => {
    if (!allChecked) return;
    onConfirm(REQUIRED_PPE_ITEMS.map(i => i.id));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons name="shield-checkmark" size={20} color={ORANGE} />
            <Text style={styles.title}>Confirm PPE before starting</Text>
          </View>
          <Text style={styles.subtitle}>
            Tap each item to confirm you're wearing it. All six are required to start the task.
          </Text>

          <TouchableOpacity
            style={styles.checkAllPill}
            onPress={checkAll}
            accessibilityRole="button"
            accessibilityLabel={allChecked ? 'Uncheck all PPE items' : 'Check all PPE items'}
          >
            <Ionicons
              name={allChecked ? 'remove-circle-outline' : 'checkmark-done-outline'}
              size={14}
              color={ORANGE}
            />
            <Text style={styles.checkAllText}>
              {allChecked ? 'Uncheck all' : 'Check all'}
            </Text>
          </TouchableOpacity>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {REQUIRED_PPE_ITEMS.map(item => {
              const isChecked = checked.has(item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.row, isChecked && styles.rowChecked]}
                  onPress={() => toggle(item.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isChecked }}
                  accessibilityLabel={item.label}
                >
                  <Ionicons
                    name={item.icon}
                    size={20}
                    color={isChecked ? ORANGE : '#9ca3af'}
                    style={styles.rowIcon}
                  />
                  <Text style={[styles.rowLabel, isChecked && styles.rowLabelChecked]}>
                    {item.label}
                  </Text>
                  <Ionicons
                    name={isChecked ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={isChecked ? ORANGE : '#4b5563'}
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={onCancel}
              accessibilityRole="button"
            >
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, !allChecked && styles.btnPrimaryDisabled]}
              onPress={handleConfirm}
              disabled={!allChecked}
              accessibilityRole="button"
              accessibilityState={{ disabled: !allChecked }}
            >
              <Ionicons name="play-circle" size={18} color="#fff" />
              <Text style={styles.btnPrimaryText}>Confirm & Start</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontFamily: 'poppins-bold',
    color: 'white',
  },
  subtitle: {
    fontSize: 13,
    color: '#d1d5db',
    marginTop: 8,
  },
  checkAllPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: ORANGE,
    backgroundColor: 'rgba(255,140,0,0.08)',
  },
  checkAllText: {
    color: ORANGE,
    fontSize: 12,
    fontWeight: '600',
  },
  list: {
    marginTop: 14,
  },
  listContent: {
    gap: 8,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: ROW_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  rowChecked: {
    borderColor: ORANGE,
    backgroundColor: 'rgba(255,140,0,0.08)',
  },
  rowIcon: {
    width: 24,
    textAlign: 'center',
  },
  rowLabel: {
    flex: 1,
    color: '#d1d5db',
    fontSize: 14,
  },
  rowLabelChecked: {
    color: 'white',
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  btnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: {
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: '600',
  },
  btnPrimary: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: ORANGE,
  },
  btnPrimaryDisabled: {
    backgroundColor: '#4b5563',
    opacity: 0.7,
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
