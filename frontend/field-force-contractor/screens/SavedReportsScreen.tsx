// SavedReportsScreen.tsx
// Shows all AI-generated artefacts saved by the contractor — inspection
// reports (GET /api/ai/reports) and Field Assistant conversations
// (GET /api/ai/chats). Two tabs at the top let the user switch between
// the two lists; both flows save through the same backend pattern.

import { FC, useCallback, useState } from 'react'
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { MainFrame } from '@/components/MainFrame'
import { api } from '@/utils/api'
import { listChats, SavedChat } from '@/utils/aiClient'
import { exportChatPdf, exportReportPdf } from '@/utils/pdfExport'

// ─── Types ────────────────────────────────────────────────────────────────────

type SavedReport = {
    id: string
    title: string
    priority: string
    category: string
    description: string
    recommended_actions: string[]
    raw_notes: string | null
    created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function priorityBadge(priority: string) {
    if (priority === 'high')   return { label: '🔴 HIGH',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)' }
    if (priority === 'medium') return { label: '🟡 MEDIUM', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)' }
    return                            { label: '🟢 LOW',    color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.3)' }
}

function formatDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Report card ──────────────────────────────────────────────────────────────

const ReportCard: FC<{ report: SavedReport }> = ({ report }) => {
    // Default to expanded so the contractor lands on full report content
    // instead of having to tap each row.
    const [expanded, setExpanded] = useState(true)
    const badge = priorityBadge(report.priority)

    return (
        <TouchableOpacity
            style={s.card}
            onPress={() => setExpanded(e => !e)}
            activeOpacity={0.8}
        >
            {/* ── Header row ── */}
            <View style={s.cardHeader}>
                <View style={{ flex: 1, gap: 6 }}>
                    {/* Title is never truncated. The card defaults to expanded
                        anyway and the user explicitly asked to see the whole
                        title at all times. */}
                    <Text style={s.cardTitle}>
                        {report.title}
                    </Text>
                    <View style={s.cardMeta}>
                        <View style={[s.badge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
                            <Text style={[s.badgeText, { color: badge.color }]} numberOfLines={1}>
                                {badge.label}
                            </Text>
                        </View>
                        <View style={s.categoryPill}>
                            <Text style={s.categoryText} numberOfLines={1}>
                                {report.category}
                            </Text>
                        </View>
                    </View>
                </View>
                <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color="rgba(255,255,255,0.3)"
                    style={{ marginLeft: 8, marginTop: 2 }}
                />
            </View>

            {/* ── Expanded content ── */}
            {expanded && (
                <View style={s.cardBody}>
                    <View style={s.divider} />

                    <Text style={s.sectionLabel}>Description</Text>
                    <Text style={s.bodyText}>{report.description}</Text>

                    <Text style={[s.sectionLabel, { marginTop: 12 }]}>Recommended Actions</Text>
                    {report.recommended_actions.map((action, i) => (
                        <View key={i} style={s.actionRow}>
                            <Text style={s.actionNum}>{i + 1}.</Text>
                            <Text style={s.actionText}>{action}</Text>
                        </View>
                    ))}

                    {report.raw_notes && (
                        <>
                            <Text style={[s.sectionLabel, { marginTop: 12 }]}>Original Notes</Text>
                            <Text style={s.notesText}>{report.raw_notes}</Text>
                        </>
                    )}
                </View>
            )}

            {/* ── Footer ── */}
            <View style={s.cardFooterRow}>
                <Text style={s.dateText}>{formatDate(report.created_at)}</Text>
                <TouchableOpacity
                    style={s.pdfBtn}
                    // Stop the toggle-expand from firing when the PDF
                    // button is tapped — the contractor wanted a quick
                    // export, not to collapse the report.
                    onPress={(e) => {
                        e.stopPropagation?.()
                        exportReportPdf({
                            title:               report.title,
                            priority:            report.priority,
                            category:            report.category,
                            description:         report.description,
                            recommended_actions: report.recommended_actions,
                            raw_notes:           report.raw_notes,
                            created_at:          report.created_at,
                        }).catch(() => {})
                    }}
                    activeOpacity={0.7}
                >
                    <Ionicons name="document-text-outline" size={12} color="#a78bfa" />
                    <Text style={s.pdfBtnText}>Export PDF</Text>
                </TouchableOpacity>
            </View>
        </TouchableOpacity>
    )
}

// ─── Chat card ────────────────────────────────────────────────────────────────

const ChatCard: FC<{ chat: SavedChat }> = ({ chat }) => {
    // Default expanded so the contractor lands on the full transcript
    // without an extra tap, matching ReportCard behaviour.
    const [expanded, setExpanded] = useState(true)
    const userTurns      = chat.messages.filter(m => m.role === 'user').length
    const assistantTurns = chat.messages.filter(m => m.role === 'assistant').length

    return (
        <TouchableOpacity
            style={s.card}
            onPress={() => setExpanded(e => !e)}
            activeOpacity={0.8}
        >
            <View style={s.cardHeader}>
                <View style={{ flex: 1, gap: 6 }}>
                    <Text style={s.cardTitle}>{chat.title}</Text>
                    <View style={s.cardMeta}>
                        <View style={[s.badge, { backgroundColor: 'rgba(167,139,250,0.12)', borderColor: 'rgba(167,139,250,0.3)' }]}>
                            <Text style={[s.badgeText, { color: '#a78bfa' }]} numberOfLines={1}>
                                💬 CHAT
                            </Text>
                        </View>
                        <View style={s.categoryPill}>
                            <Text style={s.categoryText} numberOfLines={1}>
                                {userTurns} q · {assistantTurns} a
                            </Text>
                        </View>
                    </View>
                </View>
                <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color="rgba(255,255,255,0.3)"
                    style={{ marginLeft: 8, marginTop: 2 }}
                />
            </View>

            {expanded && (
                <View style={s.cardBody}>
                    <View style={s.divider} />
                    {chat.summary && (
                        <>
                            <Text style={s.sectionLabel}>Summary</Text>
                            <Text style={s.bodyText}>{chat.summary}</Text>
                        </>
                    )}
                    <Text style={[s.sectionLabel, { marginTop: chat.summary ? 12 : 0 }]}>Transcript</Text>
                    {chat.messages.map((m, i) => (
                        <View key={i} style={{ marginBottom: 8 }}>
                            <Text style={s.transcriptRole}>
                                {m.role === 'user' ? 'You' : 'Assistant'}
                                {m.timestamp ? ` · ${m.timestamp}` : ''}
                            </Text>
                            <Text style={s.bodyText}>{m.content}</Text>
                        </View>
                    ))}
                </View>
            )}

            <View style={s.cardFooterRow}>
                <Text style={s.dateText}>{formatDate(chat.created_at)}</Text>
                <TouchableOpacity
                    style={s.pdfBtn}
                    onPress={(e) => {
                        e.stopPropagation?.()
                        exportChatPdf({
                            title:    chat.title,
                            summary:  chat.summary,
                            messages: chat.messages,
                        }).catch(() => {})
                    }}
                    activeOpacity={0.7}
                >
                    <Ionicons name="document-text-outline" size={12} color="#a78bfa" />
                    <Text style={s.pdfBtnText}>Export PDF</Text>
                </TouchableOpacity>
            </View>
        </TouchableOpacity>
    )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const EmptyState: FC<{ tab: 'reports' | 'chats' }> = ({ tab }) => (
    <View style={s.empty}>
        <View style={s.emptyIcon}>
            <Ionicons
                name={tab === 'reports' ? 'document-text-outline' : 'chatbubbles-outline'}
                size={28}
                color="rgba(255,255,255,0.2)"
            />
        </View>
        <Text style={s.emptyTitle}>
            {tab === 'reports' ? 'No saved reports yet' : 'No saved conversations yet'}
        </Text>
        <Text style={s.emptyBody}>
            {tab === 'reports'
                ? 'Generate a report with Field Force AI and tap Save Report to see it here.'
                : 'Open Field Assistant, ask a question, then tap Save & Share to keep the conversation here.'}
        </Text>
    </View>
)

// ─── Main screen ──────────────────────────────────────────────────────────────

type Tab = 'reports' | 'chats'

export const SavedReportsScreen: FC = () => {
    const [tab, setTab]               = useState<Tab>('reports')
    const [reports, setReports]       = useState<SavedReport[]>([])
    const [chats, setChats]           = useState<SavedChat[]>([])
    const [loading, setLoading]       = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError]           = useState<string | null>(null)

    // Pull both lists in parallel so switching tabs is instant. The
    // network round-trip is dominated by Render's cold-start anyway, so
    // saving the second request when the user only looks at one tab is
    // not worth the complexity. Pull-to-refresh re-fetches both.
    const fetchAll = async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true)
        else setLoading(true)
        setError(null)

        const [reportsResult, chatsResult] = await Promise.allSettled([
            api.authCachedGet<SavedReport[]>('/api/ai/reports'),
            listChats(),
        ])
        if (reportsResult.status === 'fulfilled') setReports(reportsResult.value)
        if (chatsResult.status   === 'fulfilled') setChats(chatsResult.value)

        if (reportsResult.status === 'rejected' && chatsResult.status === 'rejected') {
            setError('Could not load saved items. Pull down to retry.')
        }
        setLoading(false)
        setRefreshing(false)
    }

    // Reload every time the screen comes into focus
    useFocusEffect(useCallback(() => { fetchAll() }, []))

    const showingReports = tab === 'reports'

    return (
        <MainFrame headerMenu={['Menu2', ['Saved Reports']]}>
            {/* Tabs — Reports vs Chats. Mirrors the two save flows so the
                contractor can find either kind of saved AI artefact in
                one place. */}
            <View style={s.tabRow}>
                <TouchableOpacity
                    style={[s.tabBtn, showingReports && s.tabBtnActive]}
                    onPress={() => setTab('reports')}
                    activeOpacity={0.8}
                >
                    <Ionicons
                        name="document-text-outline"
                        size={14}
                        color={showingReports ? '#0f172a' : '#a78bfa'}
                    />
                    <Text style={[s.tabBtnText, showingReports && s.tabBtnTextActive]}>
                        Reports ({reports.length})
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[s.tabBtn, !showingReports && s.tabBtnActive]}
                    onPress={() => setTab('chats')}
                    activeOpacity={0.8}
                >
                    <Ionicons
                        name="chatbubbles-outline"
                        size={14}
                        color={!showingReports ? '#0f172a' : '#a78bfa'}
                    />
                    <Text style={[s.tabBtnText, !showingReports && s.tabBtnTextActive]}>
                        Chats ({chats.length})
                    </Text>
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={s.center}>
                    <ActivityIndicator size="large" color="#a78bfa" />
                </View>
            ) : error ? (
                <ScrollView
                    contentContainerStyle={s.center}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={() => fetchAll(true)} tintColor="#a78bfa" />
                    }
                >
                    <Ionicons name="cloud-offline-outline" size={36} color="rgba(255,255,255,0.2)" />
                    <Text style={s.errorText}>{error}</Text>
                </ScrollView>
            ) : showingReports ? (
                <FlatList
                    data={reports}
                    keyExtractor={item => String(item.id)}
                    renderItem={({ item }) => <ReportCard report={item} />}
                    style={s.flatList}
                    contentContainerStyle={s.list}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={<EmptyState tab="reports" />}
                    scrollEnabled={false}
                />
            ) : (
                <FlatList
                    data={chats}
                    keyExtractor={item => String(item.id)}
                    renderItem={({ item }) => <ChatCard chat={item} />}
                    style={s.flatList}
                    contentContainerStyle={s.list}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={<EmptyState tab="chats" />}
                    scrollEnabled={false}
                />
            )}
        </MainFrame>
    )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({

    // FlatList itself needs alignSelf:'stretch' to fill MainFrame's centered
    // ScrollView. Without this the list collapses to its content's natural
    // width, which then makes the cards (width:100%) collapse along with it.
    flatList: { alignSelf: 'stretch', width: '100%' },
    list:     { padding: 16, gap: 12, paddingBottom: 32 },

    // Reports / Chats tab toggle row
    tabRow: {
        flexDirection:     'row',
        alignSelf:         'stretch',
        gap:               8,
        paddingHorizontal: 16,
        paddingTop:        12,
        paddingBottom:     4,
    },
    tabBtn: {
        flex:            1,
        flexDirection:   'row',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             6,
        paddingVertical: 10,
        borderRadius:    10,
        backgroundColor: 'rgba(167,139,250,0.10)',
        borderWidth:     1,
        borderColor:     'rgba(167,139,250,0.25)',
    },
    tabBtnActive: {
        backgroundColor: '#a78bfa',
        borderColor:     '#a78bfa',
    },
    tabBtnText: {
        fontFamily:    'poppins-bold',
        fontSize:      12,
        color:         '#a78bfa',
        letterSpacing: 0.3,
    },
    tabBtnTextActive: {
        color: '#0f172a',
    },

    // Chat transcript inside a ChatCard
    transcriptRole: {
        fontFamily:    'poppins-bold',
        fontSize:      11,
        color:         '#a78bfa',
        letterSpacing: 0.3,
        marginBottom:  2,
    },

    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 32,
    },

    // Report card
    card: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth:     1,
        borderColor:     'rgba(255,255,255,0.08)',
        borderRadius:    16,
        padding:         16,
        gap:             8,
        // MainFrame uses a centered ScrollView (alignItems: center). Without
        // alignSelf:'stretch' the card collapses to its content width, which
        // makes the badges look like single-letter columns. Stretching it
        // makes the card span the full available width inside the FlatList.
        alignSelf:       'stretch',
        width:           '100%',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems:    'flex-start',
    },
    cardTitle: {
        fontFamily: 'poppins-bold',
        fontSize:   14,
        color:      '#ffffff',
        lineHeight: 20,
    },
    cardMeta: {
        flexDirection: 'row',
        alignItems:    'center',
        gap:           8,
        flexWrap:      'wrap',
    },
    badge: {
        paddingVertical:   3,
        paddingHorizontal: 8,
        borderRadius:      8,
        borderWidth:       1,
        // Don't let flex squeeze the badge into a single-char column when
        // the title is long. flexShrink:0 + alignSelf:flex-start keeps it
        // sized to its text content.
        flexShrink:        0,
        alignSelf:         'flex-start',
    },
    badgeText: {
        fontFamily: 'poppins-bold',
        fontSize:   11,
        // Belt-and-braces: even if the parent ever does shrink, keep the
        // text on one line and ellipsize rather than wrap per-letter.
        // includeFontPadding:false trims the spacing Android adds around glyphs.
    },
    categoryPill: {
        paddingVertical:   3,
        paddingHorizontal: 8,
        borderRadius:      8,
        backgroundColor:   'rgba(167,139,250,0.1)',
        borderWidth:       1,
        borderColor:       'rgba(167,139,250,0.25)',
        flexShrink:        0,
        alignSelf:         'flex-start',
        maxWidth:          160,
    },
    categoryText: {
        fontFamily: 'poppins-regular',
        fontSize:   11,
        color:      '#a78bfa',
    },

    // Expanded body
    cardBody: { gap: 4 },
    divider: {
        height:          1,
        backgroundColor: 'rgba(255,255,255,0.06)',
        marginVertical:  8,
    },
    sectionLabel: {
        fontFamily: 'poppins-bold',
        fontSize:   11,
        color:      'rgba(255,255,255,0.4)',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    bodyText: {
        fontFamily: 'poppins-regular',
        fontSize:   13,
        color:      'rgba(255,255,255,0.75)',
        lineHeight: 20,
    },
    actionRow: {
        flexDirection: 'row',
        gap:           6,
        marginBottom:  4,
    },
    actionNum: {
        fontFamily: 'poppins-bold',
        fontSize:   13,
        color:      '#a78bfa',
        width:      16,
    },
    actionText: {
        fontFamily: 'poppins-regular',
        fontSize:   13,
        color:      'rgba(255,255,255,0.75)',
        flex:       1,
        lineHeight: 20,
    },
    notesText: {
        fontFamily:      'poppins-regular',
        fontSize:        12,
        color:           'rgba(255,255,255,0.4)',
        fontStyle:       'italic',
        lineHeight:      18,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderRadius:    8,
        padding:         10,
        borderWidth:     1,
        borderColor:     'rgba(255,255,255,0.06)',
    },

    // Date row + PDF export pill
    cardFooterRow: {
        flexDirection:  'row',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginTop:      6,
    },
    dateText: {
        fontFamily: 'poppins-regular',
        fontSize:   10,
        color:      'rgba(255,255,255,0.25)',
    },
    pdfBtn: {
        flexDirection:     'row',
        alignItems:        'center',
        gap:               4,
        paddingVertical:   4,
        paddingHorizontal: 10,
        borderRadius:      999,
        backgroundColor:   'rgba(167,139,250,0.10)',
        borderWidth:       1,
        borderColor:       'rgba(167,139,250,0.25)',
    },
    pdfBtnText: {
        fontFamily:    'poppins-bold',
        fontSize:      10,
        color:         '#a78bfa',
        letterSpacing: 0.3,
    },

    // Empty state
    empty: {
        flex:           1,
        alignItems:     'center',
        justifyContent: 'center',
        padding:        32,
        gap:            12,
        marginTop:      60,
    },
    emptyIcon: {
        width:           64,
        height:          64,
        borderRadius:    32,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth:     1,
        borderColor:     'rgba(255,255,255,0.08)',
        alignItems:      'center',
        justifyContent:  'center',
    },
    emptyTitle: {
        fontFamily: 'poppins-bold',
        fontSize:   15,
        color:      'rgba(255,255,255,0.4)',
    },
    emptyBody: {
        fontFamily: 'poppins-regular',
        fontSize:   13,
        color:      'rgba(255,255,255,0.25)',
        textAlign:  'center',
        lineHeight: 20,
    },

    // Error
    errorText: {
        fontFamily: 'poppins-regular',
        fontSize:   13,
        color:      'rgba(255,255,255,0.4)',
        textAlign:  'center',
    },
})
