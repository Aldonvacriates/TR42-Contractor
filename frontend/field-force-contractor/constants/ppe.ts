// ============================================
// ppe.ts — Pre-task PPE checklist source list
//
// Single fixed list shown in the PPEChecklistModal that gates
// Start Task. v1 limitation: not category-aware. Adding category
// variants (e.g. arc-flash gear for electrical work) is a follow-up.
//
// `id` is the stable identifier persisted in ticket.ppe_items on the
// backend and must NOT change without a corresponding migration.
// `label` is the user-facing string. `icon` is an Ionicons name.
// ============================================

import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export interface PPEItem {
  id: string;
  label: string;
  icon: IoniconName;
}

export const REQUIRED_PPE_ITEMS: ReadonlyArray<PPEItem> = [
  { id: 'hard_hat', label: 'Hard hat',           icon: 'hardware-chip-outline' },
  { id: 'vest',     label: 'High-vis vest',      icon: 'shirt-outline' },
  { id: 'gloves',   label: 'Gloves',             icon: 'hand-left-outline' },
  { id: 'glasses',  label: 'Safety glasses',     icon: 'glasses-outline' },
  { id: 'boots',    label: 'Steel-toed boots',   icon: 'footsteps-outline' },
  { id: 'hearing',  label: 'Hearing protection', icon: 'ear-outline' },
];

export const REQUIRED_PPE_IDS: ReadonlyArray<string> = REQUIRED_PPE_ITEMS.map(i => i.id);
