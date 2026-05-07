// TicketsScreen — list view of tickets assigned to the logged-in contractor.
// Pulls real data from /contractors/assigned-tickets and groups by status:
//   "Action needed"        — ASSIGNED        (contractor needs to start)
//   "In progress"          — IN_PROGRESS     (already started, complete it)
//   "Pending approval"     — PENDING_APPROVAL
//   "Completed (recent)"   — COMPLETED / APPROVED, end_time within last 24h
// Server-side status drives all UI — no local toggle since the contractor
// can't actually flip a ticket to complete from this list (that requires
// the verification flow on TicketDetailScreen).

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import { MainFrame } from '../components/MainFrame';
import { api } from '../utils/api';

interface BackendTicket {
  id:           string;
  description:  string | null;
  status:       string;
  priority:     string | null;
  start_time:   string | null;
  end_time:     string | null;
  due_date:     string | null;
  route:        string | null;
  service_type: string | null;
  notes:        string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ticketTitle(t: BackendTicket): string {
  if (t.service_type) return t.service_type;
  const desc = (t.description || '').trim();
  if (desc) return desc.length > 60 ? `${desc.slice(0, 60)}...` : desc;
  return `Ticket ${t.id.slice(0, 8)}`;
}

function fmtDeadline(iso: string | null): string {
  if (!iso) return 'No deadline';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return 'No deadline'; }
}

function locationLabel(t: BackendTicket): string {
  return t.route?.trim() || 'Location TBD';
}

// ── Component ──────────────────────────────────────────────────────────────

export default function TicketsScreen() {
  const navigation = useNavigation<any>();
  const [tickets, setTickets] = useState<BackendTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Re-fetch on focus so returning from TicketDetail (e.g. after Start or
  // Complete) reflects the new server-side status without needing a manual
  // pull-to-refresh.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    setError(null);
    api.authGet<BackendTicket[]>('/contractors/assigned-tickets')
      .then(rows => { if (!cancelled) setTickets(rows ?? []); })
      .catch(()  => { if (!cancelled) setError("Couldn't load tickets. Pull to refresh."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []));

  const handleTaskClick = (t: BackendTicket) => {
    navigation.navigate('TicketDetail' as never, { taskId: t.id, assigned: true } as never);
  };

  // Group by status. UPPERCASE per backend enum.
  const upper = (s: string) => (s || '').toUpperCase();
  const isCompletedRecent = (t: BackendTicket) => {
    const s = upper(t.status);
    if (s !== 'COMPLETED' && s !== 'APPROVED') return false;
    const ts = t.end_time;
    if (!ts) return false;
    return Date.now() - new Date(ts).getTime() <= 24 * 60 * 60 * 1000;
  };
  const action     = tickets.filter(t => upper(t.status) === 'ASSIGNED');
  const inProgress = tickets.filter(t => upper(t.status) === 'IN_PROGRESS');
  const pending    = tickets.filter(t => upper(t.status) === 'PENDING_APPROVAL');
  const completed  = tickets.filter(isCompletedRecent);

  return (
    <MainFrame header='home'>

      {/* Header */}
      <View style={styles.section}>
        <Text style={styles.title}>Tickets</Text>
        <Text style={styles.subtitle}>
          {loading
            ? 'Loading...'
            : `${action.length} action needed · ${inProgress.length} in progress · ${pending.length} pending approval`}
        </Text>
      </View>

      {error && (
        <View style={[styles.section, styles.errorBox]}>
          <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading && (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color="#9ca3af" />
        </View>
      )}

      {/* Action needed (ASSIGNED) */}
      {action.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="alert-circle" size={16} color="#f59e0b" />
            <Text style={styles.sectionTitle}>Action needed</Text>
          </View>
          {action.map(t => (
            <TouchableOpacity key={t.id} style={styles.taskCard} onPress={() => handleTaskClick(t)}>
              <Ionicons name="ellipse-outline" size={20} color="#9ca3af" />
              <View style={styles.taskText}>
                <Text style={styles.taskTitle} numberOfLines={2}>{ticketTitle(t)}</Text>
                <Text style={styles.taskDetail}>
                  {locationLabel(t)} · Due {fmtDeadline(t.due_date)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* In progress */}
      {inProgress.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="briefcase" size={16} color="#3b82f6" />
            <Text style={styles.sectionTitle}>In progress</Text>
          </View>
          {inProgress.map(t => (
            <TouchableOpacity key={t.id} style={styles.taskCard} onPress={() => handleTaskClick(t)}>
              <Ionicons name="time" size={20} color="#3b82f6" />
              <View style={styles.taskText}>
                <Text style={styles.taskTitle} numberOfLines={2}>{ticketTitle(t)}</Text>
                <Text style={styles.taskDetail}>
                  {locationLabel(t)} · Started {t.start_time ? fmtDeadline(t.start_time) : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Pending approval */}
      {pending.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="hourglass-outline" size={16} color="#a78bfa" />
            <Text style={styles.sectionTitle}>Pending approval</Text>
          </View>
          {pending.map(t => (
            <TouchableOpacity key={t.id} style={styles.taskCard} onPress={() => handleTaskClick(t)}>
              <Ionicons name="hourglass-outline" size={20} color="#a78bfa" />
              <View style={styles.taskText}>
                <Text style={styles.taskTitle} numberOfLines={2}>{ticketTitle(t)}</Text>
                <Text style={styles.taskDetail}>
                  {locationLabel(t)} · Submitted {t.end_time ? fmtDeadline(t.end_time) : ''}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Recently completed */}
      {completed.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
            <Text style={styles.sectionTitle}>Completed (last 24h)</Text>
          </View>
          {completed.map(t => (
            <View key={t.id} style={styles.taskCard}>
              <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
              <View style={styles.taskText}>
                <Text style={[styles.taskTitle, { color: '#9ca3af' }]} numberOfLines={2}>{ticketTitle(t)}</Text>
                <Text style={styles.taskDetail}>{locationLabel(t)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {!loading && tickets.length === 0 && (
        <View style={styles.empty}>
          <Ionicons name="documents-outline" size={32} color="rgba(255,255,255,0.3)" />
          <Text style={styles.emptyText}>No tickets assigned yet.</Text>
        </View>
      )}

    </MainFrame>
  );
}

const CARD_BG = 'rgba(255,255,255,0.1)';
const BORDER  = 'rgba(255,255,255,0.15)';

const styles = StyleSheet.create({
    section:       { width: '90%', marginBottom: 16 },
    title:         { fontSize: 22, fontFamily: 'poppins-bold', color: 'white', marginBottom: 4 },
    subtitle:      { fontSize: 13, color: '#9ca3af' },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    sectionTitle:  { fontSize: 13, fontFamily: 'poppins-bold', color: 'white', marginBottom: 8 },
    taskCard: {
        backgroundColor: CARD_BG,
        borderWidth:     1,
        borderColor:     BORDER,
        borderRadius:    12,
        padding:         14,
        flexDirection:   'row',
        alignItems:      'center',
        gap:             10,
        marginBottom:    8,
    },
    taskText:   { flex: 1 },
    taskTitle:  { fontSize: 13, fontFamily: 'poppins-bold', color: 'white' },
    taskDetail: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
    empty:      { alignItems: 'center', paddingVertical: 40, gap: 8 },
    emptyText:  { fontSize: 13, color: '#9ca3af' },
    errorBox: {
        flexDirection: 'row',
        alignItems:    'center',
        gap:           8,
        padding:       10,
        borderRadius:  10,
        borderWidth:   1,
        borderColor:   'rgba(239,68,68,0.3)',
        backgroundColor:'rgba(239,68,68,0.08)',
    },
    errorText: { flex: 1, fontSize: 12, color: '#ef4444' },
});
