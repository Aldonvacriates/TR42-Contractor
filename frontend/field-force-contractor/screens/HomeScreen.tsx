import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../App';
import { MainFrame } from '../components/MainFrame';
import { DriveTimeStatusBar } from '../components/DriveTimeStatusBar';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Dashboard'>;
type Status = 'driving' | 'work' | 'offline';

const statusOptions: { value: Status; label: string; color: string; bg: string; border: string }[] = [
    { value: 'driving', label: 'Driving', color: '#60a5fa', bg: 'rgba(59,130,246,0.2)',  border: '#60a5fa' },
    { value: 'work',    label: 'Work',    color: '#4ade80', bg: 'rgba(34,197,94,0.2)',   border: '#4ade80' },
    { value: 'offline', label: 'Offline', color: '#9ca3af', bg: 'rgba(107,114,128,0.2)', border: '#9ca3af' },
];

// ── Backend response shapes ───────────────────────────────────────────────
// /api/analytics/dashboard/stats — total ticket counts and completion rate
interface DashboardStats {
    total_jobs:      number;
    completed_jobs:  number;
    completion_rate: number;
    flag_rate:       number;
    avg_rating:      number;
}

// /api/analytics/jobs — paginated ticket history with parent work_order
interface JobRow {
    id:             string;
    description:    string | null;
    status:         string;
    priority:       string | null;
    end_time:       string | null;
    created_at:     string | null;
}

interface JobsResponse {
    jobs:       JobRow[];
    pagination: { page: number; limit: number; total: number; total_pages: number };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return 'just now';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1)   return 'just now';
    if (minutes < 60)  return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7)      return `${days} day${days === 1 ? '' : 's'} ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5)     return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
    return new Date(iso).toLocaleDateString();
}

function jobLabel(job: JobRow): string {
    const desc = (job.description || '').trim();
    if (desc) return desc.length > 60 ? `${desc.slice(0, 60)}...` : desc;
    return `Ticket ${job.id.slice(0, 8)}`;
}

function isCompletedStatus(status: string): boolean {
    const upper = (status || '').toUpperCase();
    return upper === 'COMPLETED' || upper === 'APPROVED';
}

export default function HomeScreen() {
    const [currentStatus, setCurrentStatus] = useState<Status>('work');
    const [isStatusOpen, setIsStatusOpen] = useState(false);
    const [stats, setStats]               = useState<DashboardStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);
    const [recentJobs, setRecentJobs]     = useState<JobRow[]>([]);
    const [jobsLoading, setJobsLoading]   = useState(true);
    const nav = useNavigation<Nav>();
    const { logout: _logout } = useAuth();
    const route = useRoute();

    // If we land on the legacy "Home" route (e.g. SplashScreen timer),
    // silently redirect to "Dashboard" so the back stack stays clean.
    useEffect(() => {
        if (route.name === 'Home') {
            nav.replace('Dashboard');
        }
    }, []);

    // Pull real dashboard stats + recent jobs from the analytics blueprint.
    // Both endpoints filter by the authenticated contractor server-side, so
    // no contractor-id wrangling needed here.
    //
    // Wrapped so pull-to-refresh can reuse the same fetch path.
    const fetchDashboard = async () => {
        const [statsResult, jobsResult] = await Promise.allSettled([
            api.authGet<DashboardStats>('/api/analytics/dashboard/stats'),
            api.authGet<JobsResponse>('/api/analytics/jobs?limit=5'),
        ]);
        if (statsResult.status === 'fulfilled') setStats(statsResult.value);
        if (jobsResult.status === 'fulfilled')  setRecentJobs(jobsResult.value.jobs ?? []);
        setStatsLoading(false);
        setJobsLoading(false);
    };

    useEffect(() => {
        fetchDashboard().catch(() => {});
    }, []);

    const currentStatusData = statusOptions.find(s => s.value === currentStatus)!;

    const totalJobs    = stats?.total_jobs ?? 0;
    const completed    = stats?.completed_jobs ?? 0;
    const pending      = Math.max(totalJobs - completed, 0);
    const completionPct = stats ? Math.round(stats.completion_rate) : 0;

    const handleStatusSelect = (status: Status) => {
        setCurrentStatus(status);
        setIsStatusOpen(false);
    };

    return (
        <MainFrame header='home' headerMenu={["none", []]} onRefresh={fetchDashboard}>

            {/* ── Title bar ──────────────────────────────────────────
                Styled to match the Menu2 navy bar visually but with no
                back arrow — Dashboard is the root of the authenticated
                stack, so there's nothing meaningful to go back to. */}
            <View style={styles.titleBar}>
                <Text style={styles.titleBarText}>Dashboard</Text>
            </View>

            {/* ── Header ── */}
            <View style={styles.header}>
                {/* [Component12 / Logo goes here] */}
                <Text style={styles.welcome}>Welcome back!</Text>
            </View>

            {/* ── Drive time alert (Cory stakeholder ask) ── */}
            {/* Renders only when remaining drive time is within 60 minutes of
                the FMCSA daily limit. Tap to navigate to DriveTimeTracker. */}
            <DriveTimeStatusBar />

            {/* ── Status Selector ── */}
            <View style={styles.section}>
                <TouchableOpacity
                    style={styles.statusButton}
                    onPress={() => setIsStatusOpen(!isStatusOpen)}
                >
                    <View style={styles.statusLeft}>
                        <View style={[styles.statusDot, { backgroundColor: currentStatusData.bg, borderColor: currentStatusData.border }]} />
                        <Text style={styles.statusLabel}>Status: {currentStatusData.label}</Text>
                    </View>
                    <Ionicons
                        name="chevron-down"
                        size={20}
                        color="#9ca3af"
                        style={{ transform: [{ rotate: isStatusOpen ? '180deg' : '0deg' }] }}
                    />
                </TouchableOpacity>

                {isStatusOpen && (
                    <View style={styles.statusDropdown}>
                        {statusOptions.map(option => (
                            <TouchableOpacity
                                key={option.value}
                                style={[
                                    styles.statusOption,
                                    currentStatus === option.value && {
                                        backgroundColor: option.bg,
                                        borderWidth: 1,
                                        borderColor: option.border,
                                    },
                                ]}
                                onPress={() => handleStatusSelect(option.value)}
                            >
                                <View style={[styles.statusDot, { backgroundColor: option.bg, borderColor: option.border }]} />
                                <Text style={[styles.statusOptionText, { color: option.color }]}>{option.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </View>

            {/* ── Stats Grid (real data from /api/analytics/dashboard/stats) ── */}
            <View style={styles.statsRow}>
                <View style={styles.statCard}>
                    <Ionicons name="checkmark-circle" size={24} color="#60a5fa" />
                    <Text style={styles.statValue}>
                        {statsLoading ? '–' : completed}
                    </Text>
                    <Text style={styles.statLabel}>Completed</Text>
                </View>
                <View style={styles.statCard}>
                    <Ionicons name="time" size={24} color="#f59e0b" />
                    <Text style={styles.statValue}>
                        {statsLoading ? '–' : pending}
                    </Text>
                    <Text style={styles.statLabel}>Pending</Text>
                </View>
                <View style={styles.statCard}>
                    <Ionicons name="trending-up" size={24} color="#a78bfa" />
                    <Text style={styles.statValue}>
                        {statsLoading ? '–' : `${completionPct}%`}
                    </Text>
                    <Text style={styles.statLabel}>Completion</Text>
                </View>
            </View>

            {/* ── Recent Activity (real data from /api/analytics/jobs) ── */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Recent Activity</Text>
                {jobsLoading ? (
                    <View style={[styles.activityRow, { justifyContent: 'center' }]}>
                        <ActivityIndicator size="small" color="#9ca3af" />
                    </View>
                ) : recentJobs.length === 0 ? (
                    <View style={styles.activityRow}>
                        <Text style={styles.activityTime}>No tickets assigned yet.</Text>
                    </View>
                ) : (
                    recentJobs.map((job, index) => {
                        const completed = isCompletedStatus(job.status);
                        const timestamp = job.end_time ?? job.created_at;
                        return (
                            <View
                                key={job.id}
                                style={[
                                    styles.activityRow,
                                    index < recentJobs.length - 1 && styles.activityBorder,
                                ]}
                            >
                                <View style={[
                                    styles.activityDot,
                                    { backgroundColor: completed ? '#16a34a' : '#ea580c' }
                                ]} />
                                <View style={styles.activityText}>
                                    <Text style={styles.activityTask} numberOfLines={1}>
                                        {jobLabel(job)}
                                    </Text>
                                    <Text style={styles.activityTime}>
                                        {relativeTime(timestamp)}
                                    </Text>
                                </View>
                            </View>
                        );
                    })
                )}
            </View>

            {/* Drive-time warning is rendered by DriveTimeStatusBar at the top
                of this screen — no static warning needed here anymore. */}

        </MainFrame>
    );
}

const CARD_BG = 'rgba(255,255,255,0.1)';
const BORDER  = 'rgba(255,255,255,0.15)';

const styles = StyleSheet.create({

    // ── Title bar (no back arrow) ─────────────────────────────
    // Matches the Menu2 SubHeader bar visually (navy background,
    // centered bold title) so Dashboard still has a clear section
    // header without a misleading "back" affordance.
    titleBar: {
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#142040',
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginBottom: 12,
    },
    titleBarText: {
        fontSize: 18,
        fontFamily: 'poppins-bold',
        color: 'white',
        letterSpacing: 0.3,
    },

    header: {
        width: '90%',
        alignItems: 'center',
        marginTop: 16,
        marginBottom: 8,
    },
    welcome: {
        fontSize: 13,
        color: '#9ca3af',
        marginTop: 4,
    },

    section: {
        width: '90%',
        marginBottom: 16,
    },

    // Status selector
    statusButton: {
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    statusLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    statusDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 2,
    },
    statusLabel: {
        color: 'white',
        fontSize: 13,
        fontFamily: 'poppins-bold',
    },
    statusDropdown: {
        backgroundColor: 'rgba(30,30,30,0.95)',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        padding: 6,
        marginTop: 6,
    },
    statusOption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 8,
    },
    statusOptionText: {
        fontSize: 13,
        fontFamily: 'poppins-bold',
    },

    // Stats
    statsRow: {
        flexDirection: 'row',
        width: '90%',
        gap: 10,
        marginBottom: 16,
    },
    statCard: {
        flex: 1,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        padding: 14,
        alignItems: 'center',
        gap: 6,
    },
    statValue: {
        fontSize: 20,
        fontFamily: 'poppins-bold',
        color: 'white',
    },
    statLabel: {
        fontSize: 11,
        color: '#9ca3af',
        textAlign: 'center',
    },

    // Recent Activity
    card: {
        width: '90%',
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    cardTitle: {
        fontSize: 15,
        fontFamily: 'poppins-bold',
        color: 'white',
        marginBottom: 12,
    },
    activityRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingBottom: 12,
        gap: 10,
    },
    activityBorder: {
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
        marginBottom: 12,
    },
    activityDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginTop: 5,
    },
    activityText: {
        flex: 1,
    },
    activityTask: {
        fontSize: 13,
        color: 'white',
        fontFamily: 'poppins-bold',
    },
    activityTime: {
        fontSize: 11,
        color: '#9ca3af',
        marginTop: 2,
    },

    // Warning
    warning: {
        width: '90%',
        backgroundColor: '#dc2626',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        marginBottom: 24,
    },
    warningText: {
        color: 'white',
        fontSize: 13,
        fontFamily: 'poppins-bold',
        textAlign: 'center',
    },

    // Dev panel
    devPanel: {
        width: '90%',
        backgroundColor: 'rgba(245,158,11,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(245,158,11,0.4)',
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
        gap: 12,
    },
    devLabel: {
        fontSize: 11,
        fontFamily: 'poppins-bold',
        color: '#f59e0b',
        letterSpacing: 2,
        textAlign: 'center',
    },
    devGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    devButton: {
        flex: 1,
        minWidth: '45%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(245,158,11,0.15)',
        borderWidth: 1,
        borderColor: 'rgba(245,158,11,0.3)',
        borderRadius: 8,
        paddingVertical: 6,
        gap: 6,
    },
    devButtonText: {
        color: '#f59e0b',
        fontSize: 12,
        fontFamily: 'poppins-bold',
    },
    devLogoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(239,68,68,0.12)',
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.3)',
        borderRadius: 8,
        paddingVertical: 6,
        gap: 6,
    },
    devLogoutText: {
        color: '#ef4444',
        fontSize: 12,
        fontFamily: 'poppins-bold',
    },
});
