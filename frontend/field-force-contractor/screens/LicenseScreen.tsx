// LicenseScreen.tsx  —  Troy (rewired by Aldo for real backend data)
// Shows the contractor's licenses with expandable detail rows. Reached by
// tapping "License" on Profile or by tapping the LicenseExpirationBanner.
//
// Data source: GET /contractors/me/licenses returns each license with a
// computed days_until_expiration field. We render one card per license,
// sorted soonest-expiration first, so the most urgent shows at the top.
//
// Status logic (derived from days_until_expiration, never hardcoded):
//   Expired       — days < 0
//   Expiring Soon — 0 <= days <= 30
//   Active        — days > 30

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { Ionicons }      from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { MainFrame } from '../components/MainFrame';
import { colors, spacing, radius, fontSize, fonts } from '../constants/theme';
import { api } from '../utils/api';

interface BackendLicense {
  id:                       string;
  license_type:             string;
  license_number:           string;
  license_state:            string | null;
  license_expiration_date:  string | null;  // ISO date
  license_verified:         boolean | null;
  days_until_expiration:    number | null;
}

// ── Status helpers ────────────────────────────────────────────────────────
const EXPIRING_SOON_DAYS = 30;
type LicenseStatus = 'Active' | 'Expiring Soon' | 'Expired';

function getLicenseStatus(daysUntil: number | null): LicenseStatus {
  if (daysUntil == null) return 'Active';
  if (daysUntil < 0)                   return 'Expired';
  if (daysUntil <= EXPIRING_SOON_DAYS) return 'Expiring Soon';
  return 'Active';
}

function getStatusColor(status: LicenseStatus): string {
  if (status === 'Expired')       return colors.error;
  if (status === 'Expiring Soon') return colors.warning;
  return colors.success;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

// ── DetailRow ─────────────────────────────────────────────────────────────────
type DetailRowProps = { label: string; value: string; isOpen: boolean; onToggle: () => void; };

const DetailRow = (props: DetailRowProps) => (
  <TouchableOpacity style={rowStyles.container} onPress={props.onToggle} activeOpacity={0.8}>
    <View style={rowStyles.header}>
      <View style={rowStyles.dot} />
      <Text style={rowStyles.label}>{props.label}</Text>
      <Ionicons name={props.isOpen ? 'chevron-up' : 'chevron-forward'} size={18} color={colors.textMuted} />
    </View>
    {props.isOpen && <Text style={rowStyles.value}>{props.value}</Text>}
  </TouchableOpacity>
);

const rowStyles = StyleSheet.create({
  container: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, paddingHorizontal: spacing.md, gap: spacing.xs },
  header:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textMuted },
  label:     { flex: 1, fontFamily: fonts.regular, fontSize: fontSize.base, color: colors.textWhite },
  value:     { fontFamily: fonts.regular, fontSize: fontSize.sm, color: colors.textMuted, paddingLeft: 20, marginTop: spacing.xs },
});

// ── License card (one per license) ───────────────────────────────────────────

interface CardProps {
  license: BackendLicense;
  expanded: boolean;
  onToggle: () => void;
}

const LicenseCard = ({ license, expanded, onToggle }: CardProps) => {
  const status      = getLicenseStatus(license.days_until_expiration);
  const statusColor = getStatusColor(status);
  const showWarning = status !== 'Active';
  const days        = license.days_until_expiration ?? 0;

  return (
    <View style={styles.cardWrap}>
      {/* Warning strip */}
      {showWarning && (
        <View style={[
          styles.warningBanner,
          {
            borderColor: statusColor,
            backgroundColor: status === 'Expired'
              ? 'rgba(248,113,113,0.10)'
              : 'rgba(245,158,11,0.10)',
          },
        ]}>
          <Ionicons
            name={status === 'Expired' ? 'close-circle-outline' : 'warning-outline'}
            size={18}
            color={statusColor}
          />
          <Text style={[styles.warningText, { color: statusColor }]}>
            {status === 'Expired'
              ? `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago. Contact your vendor to renew.`
              : `Expires in ${days} day${days === 1 ? '' : 's'}. Renew soon to avoid disruption.`
            }
          </Text>
        </View>
      )}

      {/* Card */}
      <View style={styles.licenseCard}>
        <View style={styles.iconWrap}>
          <Ionicons name="ribbon-outline" size={32} color={statusColor} />
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={2}>{license.license_type}</Text>
          {license.license_state ? (
            <Text style={styles.cardType}>{license.license_state}</Text>
          ) : null}
          <Text style={styles.licenseLabel}>License No.</Text>
          <Text style={styles.licenseNumber}>{license.license_number}</Text>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Status </Text>
            <Text style={[styles.statusValue, { color: statusColor }]}>{status}</Text>
          </View>
        </View>
      </View>

      {/* Expand toggle */}
      <TouchableOpacity onPress={onToggle} style={styles.toggleBtn} activeOpacity={0.8}>
        <Text style={styles.toggleText}>
          {expanded ? 'Hide details' : 'Show details'}
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.detailsList}>
          <View style={rowStyles.container}>
            <View style={rowStyles.header}>
              <View style={rowStyles.dot} />
              <Text style={rowStyles.label}>Expiration</Text>
            </View>
            <Text style={rowStyles.value}>{fmtDate(license.license_expiration_date)}</Text>
          </View>
          <View style={rowStyles.container}>
            <View style={rowStyles.header}>
              <View style={rowStyles.dot} />
              <Text style={rowStyles.label}>State</Text>
            </View>
            <Text style={rowStyles.value}>{license.license_state || '—'}</Text>
          </View>
          <View style={rowStyles.container}>
            <View style={rowStyles.header}>
              <View style={rowStyles.dot} />
              <Text style={rowStyles.label}>Verified</Text>
            </View>
            <Text style={rowStyles.value}>
              {license.license_verified === true
                ? 'Yes'
                : license.license_verified === false ? 'No' : 'Pending'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
};

// ── LicenseScreen ─────────────────────────────────────────────────────────

export default function LicenseScreen() {
  const navigation = useNavigation<any>();
  const [licenses, setLicenses] = useState<BackendLicense[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.authGet<{ licenses: BackendLicense[]; count: number }>('/contractors/me/licenses')
      .then(d => {
        if (cancelled) return;
        const rows = d.licenses ?? [];
        setLicenses(rows);
        // Auto-expand the most urgent license so the warning detail is
        // visible without an extra tap.
        if (rows[0]) setExpandedId(rows[0].id);
      })
      .catch(()  => { if (!cancelled) setError("Couldn't load licenses."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <MainFrame header="home" headerMenu={['Menu2', ['License Details']]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {loading && (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color="#9ca3af" />
        </View>
      )}

      {error && !loading && (
        <View style={[styles.warningBanner, { borderColor: colors.error, backgroundColor: 'rgba(248,113,113,0.10)' }]}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
          <Text style={[styles.warningText, { color: colors.error }]}>{error}</Text>
        </View>
      )}

      {!loading && licenses.length === 0 && !error && (
        <View style={styles.empty}>
          <Ionicons name="ribbon-outline" size={32} color="rgba(255,255,255,0.3)" />
          <Text style={styles.emptyText}>No licenses on file. Contact your vendor.</Text>
        </View>
      )}

      {licenses.map(l => (
        <LicenseCard
          key={l.id}
          license={l}
          expanded={expandedId === l.id}
          onToggle={() => setExpandedId(prev => prev === l.id ? null : l.id)}
        />
      ))}

    </MainFrame>
  );
}

const styles = StyleSheet.create({
  cardWrap:    { width: '100%', maxWidth: 480, alignSelf: 'center', marginTop: spacing.md },
  empty:       { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText:   { fontFamily: fonts.regular, fontSize: fontSize.sm, color: colors.textMuted },
  warningBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    borderWidth: 1, borderRadius: radius.md, padding: spacing.md,
    marginHorizontal: spacing.md, marginTop: spacing.md,
    width: '100%', maxWidth: 480, alignSelf: 'center',
  },
  warningText: { flex: 1, fontFamily: fonts.regular, fontSize: fontSize.sm, lineHeight: 20 },

  licenseCard: {
    flexDirection: 'row', backgroundColor: '#0f1d33',
    marginHorizontal: spacing.md, marginTop: spacing.md,
    borderRadius: radius.lg, padding: spacing.md, gap: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  iconWrap: {
    width:           70,
    height:          70,
    borderRadius:    8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  cardInfo:      { flex: 1, gap: 2 },
  cardName:      { fontFamily: fonts.bold,    fontSize: fontSize.base, color: colors.textWhite },
  cardType:      { fontFamily: fonts.regular, fontSize: fontSize.sm, color: colors.textLight, marginBottom: 6 },
  licenseLabel:  { fontFamily: fonts.regular, fontSize: fontSize.xs, color: colors.primary },
  licenseNumber: { fontFamily: fonts.bold,    fontSize: fontSize.sm, color: colors.textWhite, marginBottom: 4 },
  statusRow:     { flexDirection: 'row', alignItems: 'center' },
  statusLabel:   { fontFamily: fonts.regular, fontSize: fontSize.sm, color: colors.textLight },
  statusValue:   { fontFamily: fonts.bold,    fontSize: fontSize.sm },

  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    marginTop: 4,
    alignSelf: 'flex-start',
    marginLeft: spacing.md,
  },
  toggleText: {
    fontFamily: fonts.regular,
    fontSize:   fontSize.sm,
    color:      colors.textMuted,
  },

  detailsList: {
    gap: spacing.sm, paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
});
