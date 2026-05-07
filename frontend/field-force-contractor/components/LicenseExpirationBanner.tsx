// LicenseExpirationBanner.tsx
// Profile screen banner that surfaces licenses about to expire (or already
// expired). Cory called this out as a stakeholder priority — a contractor
// should see it the moment they open the Profile tab.
//
// Severity rules:
//   ≤  7 days  or already expired → red    (CRITICAL)
//   ≤ 30 days                     → amber  (WARNING)
//   ≤ 60 days                     → yellow (HEADS UP)
//   > 60 days                     → not rendered (no banner shown)
//
// If multiple licenses qualify, we show the most urgent one in the headline
// and a "+N more" pill for the rest. Tapping the banner navigates to the
// full LicenseDetails screen.

import { FC, useEffect, useState } from 'react'
import { Text, TouchableOpacity, View, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { RootStackParamList } from '@/App'
import { api } from '@/utils/api'

type Nav = NativeStackNavigationProp<RootStackParamList>

interface LicenseRow {
    id: string
    license_type: string
    license_number: string
    license_state: string
    license_expiration_date: string | null
    license_verified: boolean | null
    days_until_expiration: number | null
}

interface LicensesResponse {
    licenses: LicenseRow[]
    count: number
}

// ── Severity classification ────────────────────────────────────────────────

type Severity = 'critical' | 'warning' | 'heads-up'

function severityFor(days: number | null): Severity | null {
    if (days == null) return null
    if (days <= 7)  return 'critical'   // expired or expiring this week
    if (days <= 30) return 'warning'    // within a month
    if (days <= 60) return 'heads-up'   // within two months
    return null                          // healthy, no banner
}

const SEVERITY_STYLE: Record<Severity, {
    bg: string
    border: string
    fg: string
    icon: keyof typeof Ionicons.glyphMap
    label: string
}> = {
    critical: {
        bg:     'rgba(239,68,68,0.12)',
        border: 'rgba(239,68,68,0.45)',
        fg:     '#ef4444',
        icon:   'alert-circle',
        label:  'CRITICAL',
    },
    warning: {
        bg:     'rgba(245,158,11,0.12)',
        border: 'rgba(245,158,11,0.45)',
        fg:     '#f59e0b',
        icon:   'warning',
        label:  'WARNING',
    },
    'heads-up': {
        bg:     'rgba(250,204,21,0.10)',
        border: 'rgba(250,204,21,0.40)',
        fg:     '#facc15',
        icon:   'time',
        label:  'HEADS UP',
    },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function describeDays(days: number): string {
    if (days < 0)  return `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
    if (days === 0) return 'expires today'
    if (days === 1) return 'expires tomorrow'
    return `expires in ${days} days`
}

// ── Component ──────────────────────────────────────────────────────────────

export const LicenseExpirationBanner: FC = () => {
    const navigation = useNavigation<Nav>()
    const [loading,  setLoading]  = useState(true)
    const [licenses, setLicenses] = useState<LicenseRow[]>([])

    useEffect(() => {
        let cancelled = false
        api.authGet<LicensesResponse>('/contractors/me/licenses')
            .then(res => { if (!cancelled) setLicenses(res.licenses) })
            .catch(() => { if (!cancelled) setLicenses([]) })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [])

    if (loading) {
        // Subtle placeholder so the layout doesn't jump when the banner finally
        // renders. Hidden once data lands.
        return (
            <View style={[s.banner, s.placeholder]}>
                <ActivityIndicator size="small" color="rgba(255,255,255,0.4)" />
            </View>
        )
    }

    // Filter to only licenses that should trigger a banner, then pick the most
    // urgent one (lowest days_until_expiration).
    const flagged = licenses
        .map(l => ({ row: l, severity: severityFor(l.days_until_expiration) }))
        .filter((x): x is { row: LicenseRow; severity: Severity } => x.severity !== null)
        .sort((a, b) => (a.row.days_until_expiration ?? 0) - (b.row.days_until_expiration ?? 0))

    if (flagged.length === 0) return null

    const top  = flagged[0]
    const rest = flagged.length - 1
    const sev  = SEVERITY_STYLE[top.severity]

    return (
        <TouchableOpacity
            style={[s.banner, { backgroundColor: sev.bg, borderColor: sev.border }]}
            onPress={() => navigation.navigate('LicenseDetails')}
            activeOpacity={0.8}
        >
            <View style={[s.iconWrap, { backgroundColor: sev.fg }]}>
                <Ionicons name={sev.icon} size={18} color="#0a0a0a" />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[s.severityLabel, { color: sev.fg }]}>{sev.label}</Text>
                <Text style={s.title} numberOfLines={1}>{top.row.license_type}</Text>
                <Text style={s.subtitle} numberOfLines={1}>
                    {describeDays(top.row.days_until_expiration ?? 0)}
                    {rest > 0 ? ` · +${rest} more flagged` : ''}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={sev.fg} />
        </TouchableOpacity>
    )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    banner: {
        flexDirection:    'row',
        alignItems:       'center',
        gap:              12,
        padding:          14,
        borderRadius:     14,
        borderWidth:      1,
        marginHorizontal: 16,
        marginTop:        12,
    },
    placeholder: {
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderColor:     'rgba(255,255,255,0.08)',
        height:          64,
        justifyContent:  'center',
    },
    iconWrap: {
        width:          36,
        height:         36,
        borderRadius:   18,
        alignItems:     'center',
        justifyContent: 'center',
    },
    severityLabel: {
        fontFamily:    'poppins-bold',
        fontSize:      10,
        letterSpacing: 0.6,
    },
    title: {
        fontFamily: 'poppins-bold',
        fontSize:   14,
        color:      '#fff',
        marginTop:  2,
    },
    subtitle: {
        fontFamily: 'poppins-regular',
        fontSize:   12,
        color:      'rgba(255,255,255,0.65)',
        marginTop:  2,
    },
})

export default LicenseExpirationBanner
