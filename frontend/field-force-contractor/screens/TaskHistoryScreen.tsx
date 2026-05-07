// TaskHistoryScreen.tsx  —  Troy
//
// Shows the contractor's full task history pulled from their profile.
// Split into two sections:
//
//   Completed Tasks   — tasks the contractor fully completed and submitted
//   Incomplete Tasks  — tasks they were assigned to and did some work on
//                       but did not personally complete (handed off, removed,
//                       or the job was reassigned before submission)
//
// Both sections are read-only reference records. The contractor cannot
// modify anything here — it is purely for their own records and in case
// a vendor disputes or flags a ticket.
//
// Wired to /api/analytics/jobs (see backend/app/blueprints/analytics/routes.py).
// That endpoint returns paginated tickets with the parent work_order joined
// in, which has everything we need for a history record. We map the
// backend shape into the UI's TaskRecord type so the rendering code below
// stays unchanged.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { Ionicons }      from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { RootStackParamList } from '../App';
import { MainFrame }          from '../components/MainFrame';
import { colors, spacing, radius, fontSize, fonts } from '../constants/theme';
import { api } from '../utils/api';

type Nav = NativeStackNavigationProp<RootStackParamList, 'TaskHistory'>;

// ── Data shape ────────────────────────────────────────────────────────────────
// Each history record represents one task the contractor was involved with.
// The backend should return an array of these per contractor.

type TaskRecord = {
  id:          string;
  title:       string;
  vendor:      string;
  location:    string;
  date:        string;   // display-formatted date string e.g. "Mar 20, 2026"
  status:      'Completed' | 'Incomplete';
  reason?:     string;   // only for incomplete — why it was not finished
  ticketRef:   string;   // ticket / work order reference number
};

// ── Backend → UI transform ───────────────────────────────────────────────────
// /api/analytics/jobs returns rows with this rough shape (camelCase keys
// match what marshmallow dumps from the SQL aliases in routes.py):
//   id, description, route, status, priority, anomaly_flag, anomaly_reason,
//   start_time, end_time, contractor_*latitude/longitude, notes,
//   assigned_at, created_at,
//   work_order_code, work_order_description, work_order_location

interface BackendJob {
  id:                       string;
  description:              string | null;
  route:                    string | null;
  status:                   string;
  priority:                 string | null;
  anomaly_flag:             boolean | null;
  anomaly_reason:           string | null;
  start_time:               string | null;
  end_time:                 string | null;
  notes:                    string | null;
  created_at:               string | null;
  work_order_code:          number | string | null;
  work_order_description:   string | null;
  work_order_location:      string | null;
}

interface JobsResponse {
  jobs:       BackendJob[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

function fmtDateLong(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function jobTitle(j: BackendJob): string {
  const desc = (j.description || '').trim();
  if (desc) return desc.length > 60 ? `${desc.slice(0, 60)}...` : desc;
  return `Ticket ${j.id.slice(0, 8)}`;
}

function jobToRecord(j: BackendJob): TaskRecord {
  const upper = (j.status || '').toUpperCase();
  const isComplete = upper === 'COMPLETED' || upper === 'APPROVED';
  // Use end_time when available (the moment work wrapped), otherwise the
  // creation date as a sensible fallback for incomplete records.
  const date = j.end_time ?? j.created_at;
  return {
    id:        j.id,
    title:     jobTitle(j),
    // No "vendor name" surfaces from the analytics jobs endpoint today.
    // Showing the work order code keeps the meta line useful and is more
    // honest than fabricating a vendor name.
    vendor:    j.work_order_code != null ? `Work order #${j.work_order_code}` : '—',
    location:  j.work_order_location || j.route || 'Location not specified',
    date:      fmtDateLong(date),
    status:    isComplete ? 'Completed' : 'Incomplete',
    reason:    j.anomaly_flag && j.anomaly_reason ? j.anomaly_reason : undefined,
    ticketRef: String(j.work_order_code ?? j.id.slice(0, 8)),
  };
}

// ── TaskCard — one history entry ──────────────────────────────────────────────
type TaskCardProps = {
  record:    TaskRecord;
  isOpen:    boolean;
  onToggle:  () => void;
};

const TaskCard = ({ record, isOpen, onToggle }: TaskCardProps) => {
  const isComplete = record.status === 'Completed';

  return (
    <TouchableOpacity
      style={[
        cardStyles.container,
        isOpen && cardStyles.containerOpen,
      ]}
      onPress={onToggle}
      activeOpacity={0.8}
    >
      {/* Always-visible summary row */}
      <View style={cardStyles.row}>
        {/* Status dot */}
        <View style={[
          cardStyles.dot,
          { backgroundColor: isComplete ? colors.success : colors.warning },
        ]} />

        <View style={cardStyles.info}>
          <Text style={cardStyles.title} numberOfLines={isOpen ? undefined : 1}>
            {record.title}
          </Text>
          <Text style={cardStyles.meta}>{record.vendor}  •  {record.date}</Text>
        </View>

        {/* Status badge */}
        <View style={[
          cardStyles.badge,
          { backgroundColor: isComplete ? 'rgba(52,211,153,0.12)' : 'rgba(245,158,11,0.12)' },
        ]}>
          <Text style={[
            cardStyles.badgeText,
            { color: isComplete ? colors.success : colors.warning },
          ]}>
            {isComplete ? 'Done' : 'Incomplete'}
          </Text>
        </View>

        <Ionicons
          name={isOpen ? 'chevron-up' : 'chevron-forward'}
          size={16}
          color={colors.textMuted}
          style={cardStyles.chevron}
        />
      </View>

      {/* Expanded detail section */}
      {isOpen && (
        <View style={cardStyles.detail}>
          <View style={cardStyles.detailRow}>
            <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
            <Text style={cardStyles.detailLabel}>Ticket Ref</Text>
            <Text style={cardStyles.detailValue}>{record.ticketRef}</Text>
          </View>

          <View style={cardStyles.detailRow}>
            <Ionicons name="location-outline" size={14} color={colors.textMuted} />
            <Text style={cardStyles.detailLabel}>Location</Text>
            <Text style={cardStyles.detailValue} numberOfLines={2}>{record.location}</Text>
          </View>

          {/* Show reason only for incomplete tasks */}
          {!isComplete && record.reason && (
            <View style={[cardStyles.reasonBox]}>
              <Ionicons name="information-circle-outline" size={14} color={colors.warning} />
              <Text style={cardStyles.reasonText}>{record.reason}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

const cardStyles = StyleSheet.create({
  container: {
    backgroundColor:   colors.card,
    borderRadius:      radius.md,
    borderWidth:       1,
    borderColor:       colors.border,
    paddingVertical:   spacing.md,
    paddingHorizontal: spacing.md,
    gap:               spacing.sm,
  },
  containerOpen: {
    borderColor: colors.borderActive,
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing.sm,
  },
  dot: {
    width:        8,
    height:       8,
    borderRadius: 4,
    flexShrink:   0,
  },
  info: { flex: 1 },
  title: {
    fontFamily: fonts.bold,
    fontSize:   fontSize.base,
    color:      colors.textWhite,
    marginBottom: 2,
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize:   fontSize.xs,
    color:      colors.textMuted,
  },
  badge: {
    borderRadius:      radius.sm,
    paddingVertical:   3,
    paddingHorizontal: 8,
    flexShrink:        0,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize:   fontSize.xs,
  },
  chevron: { flexShrink: 0 },

  detail: {
    gap:              spacing.sm,
    paddingTop:       spacing.sm,
    borderTopWidth:   1,
    borderTopColor:   colors.border,
    marginTop:        spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           spacing.sm,
  },
  detailLabel: {
    fontFamily: fonts.regular,
    fontSize:   fontSize.xs,
    color:      colors.textMuted,
    width:      72,
    flexShrink: 0,
  },
  detailValue: {
    fontFamily: fonts.regular,
    fontSize:   fontSize.sm,
    color:      colors.textLight,
    flex:       1,
  },
  reasonBox: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    gap:             spacing.sm,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth:     1,
    borderColor:     colors.warning,
    borderRadius:    radius.sm,
    padding:         spacing.sm,
    marginTop:       spacing.xs,
  },
  reasonText: {
    flex:       1,
    fontFamily: fonts.regular,
    fontSize:   fontSize.xs,
    color:      colors.textLight,
    lineHeight: 18,
  },
});

// ── Section header ────────────────────────────────────────────────────────────
const SectionHeader = ({ title, count, icon }: {
  title: string; count: number; icon: any;
}) => (
  <View style={sectionStyles.row}>
    <Ionicons name={icon} size={16} color={colors.primary} />
    <Text style={sectionStyles.title}>{title}</Text>
    <View style={sectionStyles.countBadge}>
      <Text style={sectionStyles.count}>{count}</Text>
    </View>
  </View>
);

const sectionStyles = StyleSheet.create({
  row: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            spacing.sm,
    paddingBottom:  spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom:   spacing.sm,
  },
  title: {
    flex:          1,
    fontFamily:    fonts.bold,
    fontSize:      fontSize.xs,
    color:         colors.textMuted,
    letterSpacing: 1.2,
  },
  countBadge: {
    backgroundColor: colors.primaryFaint,
    borderRadius:    10,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  count: {
    fontFamily: fonts.bold,
    fontSize:   fontSize.xs,
    color:      colors.primary,
  },
});

// ── TaskHistoryScreen ─────────────────────────────────────────────────────────
export default function TaskHistoryScreen() {
  const navigation = useNavigation<Nav>();

  const [openCard, setOpenCard]   = useState<string | null>(null);
  const [history,  setHistory]    = useState<TaskRecord[]>([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Pull a healthy chunk so we have several "complete" and "incomplete"
    // entries to show. The endpoint paginates; 50 is plenty for a demo
    // contractor and small enough to fetch in one round-trip.
    api.authGet<JobsResponse>('/api/analytics/jobs?limit=50')
      .then(d => {
        if (cancelled) return;
        setHistory((d.jobs ?? []).map(jobToRecord));
      })
      .catch(()  => { if (!cancelled) setError("Couldn't load task history."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const toggleCard = (id: string) => {
    setOpenCard(prev => (prev === id ? null : id));
  };

  const completed  = history.filter(r => r.status === 'Completed');
  const incomplete = history.filter(r => r.status === 'Incomplete');

  return (
    <MainFrame header="home" headerMenu={['Menu2', ['Task History']]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Summary strip */}
      <View style={styles.summaryStrip}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{loading ? '–' : completed.length}</Text>
          <Text style={styles.summaryLabel}>Completed</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryNumber, { color: colors.warning }]}>
            {loading ? '–' : incomplete.length}
          </Text>
          <Text style={styles.summaryLabel}>Incomplete</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{loading ? '–' : history.length}</Text>
          <Text style={styles.summaryLabel}>Total</Text>
        </View>
      </View>

      {loading && (
        <View style={{ alignItems: 'center', padding: spacing.lg }}>
          <ActivityIndicator size="large" color={colors.textMuted} />
        </View>
      )}

      {error && !loading && (
        <Text style={[styles.emptyText, { color: colors.error, paddingHorizontal: spacing.md }]}>
          {error}
        </Text>
      )}

      {/* ── Completed tasks ────────────────────────────── */}
      <View style={styles.section}>
        <SectionHeader
          title="COMPLETED TASKS"
          count={completed.length}
          icon="checkmark-circle-outline"
        />
        {completed.length === 0 ? (
          <Text style={styles.emptyText}>No completed tasks on record yet.</Text>
        ) : (
          completed.map(record => (
            <TaskCard
              key={record.id}
              record={record}
              isOpen={openCard === record.id}
              onToggle={() => toggleCard(record.id)}
            />
          ))
        )}
      </View>

      {/* ── Incomplete tasks ───────────────────────────── */}
      <View style={styles.section}>
        <SectionHeader
          title="INCOMPLETE TASKS"
          count={incomplete.length}
          icon="time-outline"
        />
        <Text style={styles.sectionNote}>
          Tasks you were assigned to and contributed to but did not personally complete. Kept here for your records in case a vendor follows up.
        </Text>
        {incomplete.length === 0 ? (
          <Text style={styles.emptyText}>No incomplete tasks on record.</Text>
        ) : (
          incomplete.map(record => (
            <TaskCard
              key={record.id}
              record={record}
              isOpen={openCard === record.id}
              onToggle={() => toggleCard(record.id)}
            />
          ))
        )}
      </View>

    </MainFrame>
  );
}

const styles = StyleSheet.create({
  // Summary strip at the top
  summaryStrip: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-evenly',
    backgroundColor:   colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical:   spacing.md,
    width:             '100%',
    marginBottom:      spacing.md,
  },
  summaryItem:   { alignItems: 'center', gap: 2 },
  summaryNumber: {
    fontFamily: fonts.bold,
    fontSize:   fontSize.xl,
    color:      colors.success,
  },
  summaryLabel: {
    fontFamily: fonts.regular,
    fontSize:   fontSize.xs,
    color:      colors.textMuted,
  },
  summaryDivider: {
    width:  1,
    height: 32,
    backgroundColor: colors.border,
  },

  // Section containers
  section: {
    gap:               spacing.sm,
    paddingHorizontal: spacing.md,
    width:             '100%',
    marginBottom:      spacing.xl,
  },
  sectionNote: {
    fontFamily: fonts.regular,
    fontSize:   fontSize.xs,
    color:      colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize:   fontSize.sm,
    color:      colors.textMuted,
    textAlign:  'center',
    paddingVertical: spacing.lg,
  },
});