// DriveTimeStatusBar.tsx
// Color-coded drive time alert bar that surfaces FMCSA HOS limit warnings
// before the contractor hits a violation. Cory called this out as a
// stakeholder priority alongside license expiration alerts:
//
//   "color-coded bottom bar (yellow approaching limit, red within 15-30min),
//    tap-through to detail page"  — 3/24 stakeholder meeting
//
// Severity rules (based on remaining_seconds in the daily 11-hour limit):
//   ≤ 15 min  → critical (red, attention-grabbing)
//   ≤ 30 min → urgent   (red, less intense)
//   ≤ 60 min → warning  (yellow)
//   >  1 hour → not rendered (no banner shown)
//
// Tapping the bar navigates to the DriveTimeTracker screen for full detail.

import { FC, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { RootStackParamList } from '@/App'
import { api } from '@/utils/api'

type Nav = NativeStackNavigationProp<RootStackParamList>

interface DriveTimeResponse {
    session: unknown
    driving_seconds: number
    remaining_seconds: number
    cycle_seconds: number
}

// ── Severity classification ────────────────────────────────────────────────

type Severity = 'critical' | 'urgent' | 'warning'

function severityFor(remainingSeconds: number): Severity | null {
    if (remainingSeconds <= 15 * 60) return 'critical'
    if (remainingSeconds <= 30 * 60) return 'urgent'
    if (remainingSeconds <= 60 * 60) return 'warning'
    return null
}

const SEVERITY_STYLE: Record<Severity, {
    bg:     string
    border: string
    fg:     string
    icon:   keyof typeof Ionicons.glyphMap
    label:  string
}> = {
    critical: {
        bg:     'rgba(239,68,68,0.18)',
        border: 'rgba(239,68,68,0.55)',
        fg:     '#ef4444',
        icon:   'alert-circle',
        label:  'PULL OVER SOON',
    },
    urgent: {
        bg:     'rgba(239,68,68,0.12)',
        border: 'rgba(239,68,68,0.40)',
        fg:     '#ef4444',
        icon:   'warning',
        label:  'APPROACHING LIMIT',
    },
    warning: {
        bg:     'rgba(245,158,11,0.12)',
        border: 'rgba(245,158,11,0.40)',
        fg:     '#f59e0b',
        icon:   'time',
        label:  'HEADS UP',
    },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRemaining(seconds: number): string {
    if (seconds <= 0) return 'limit reached'
    const minutes = Math.ceil(seconds / 60)
    if (minutes < 60) return `${minutes} min remaining`
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `${h}h ${m}m remaining` : `${h}h remaining`
}

// ── Component ──────────────────────────────────────────────────────────────

export const DriveTimeStatusBar: FC = () => {
    const navigation = useNavigation<Nav>()
    const [loading,        setLoading]        = useState(true)
    const [remainingSecs, setRemainingSecs]   = useState<number | null>(null)

    useEffect(() => {
        let cancelled = false
        api.authGet<DriveTimeResponse>('/drive-time/current')
            .then(res => {
                if (cancelled) return
                // No active session → don't render the bar (the contractor isn't
                // on duty yet, no need to alarm them about a limit they aren't
                // approaching).
                setRemainingSecs(res.session ? res.remaining_seconds : null)
            })
            .catch(() => { if (!cancelled) setRemainingSecs(null) })
            .finally(() => { if (!cancelled) setLoading(false) })

        // Refresh every 60s while mounted so the bar reflects the active driver
        // ticking down toward the limit.
        const tick = setInterval(() => {
            api.authGet<DriveTimeResponse>('/drive-time/current')
                .then(res => {
                    if (cancelled) return
                    setRemainingSecs(res.session ? res.remaining_seconds : null)
                })
                .catch(() => { /* keep last value on transient failure */ })
        }, 60_000)

        return () => {
            cancelled = true
            clearInterval(tick)
        }
    }, [])

    // First load: subtle placeholder so layout doesn't jump if a banner is
    // about to appear.
    if (loading) {
        return (
            <View style={[s.bar, s.placeholder]}>
                <ActivityIndicator size="small" color="rgba(255,255,255,0.4)" />
            </View>
        )
    }

    if (remainingSecs == null) return null

    const sev = severityFor(remainingSecs)
    if (!sev) return null

    const style = SEVERITY_STYLE[sev]

    return (
        <TouchableOpacity
            style={[s.bar, { backgroundColor: style.bg, borderColor: style.border }]}
            onPress={() => navigation.navigate('DriveTimeTracker')}
            activeOpacity={0.8}
        >
            <View style={[s.iconWrap, { backgroundColor: style.fg }]}>
                <Ionicons name={style.icon} size={18} color="#0a0a0a" />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[s.severityLabel, { color: style.fg }]}>{style.label}</Text>
                <Text style={s.title} numberOfLines={1}>Drive time {formatRemaining(remainingSecs)}</Text>
                <Text style={s.subtitle} numberOfLines={1}>
                    Tap to view detail and switch status
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={style.fg} />
        </TouchableOpacity>
    )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    bar: {
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

export default DriveTimeStatusBar
