// PhotoReviewScreen.tsx
// AI photo review for ticket photos. Picks a ticket, lists its uploaded
// photos, and lets the contractor run Claude/Gemini vision against any
// one of them to surface safety/OSHA concerns.
//
// Backend touchpoints:
//   GET  /contractors/assigned-tickets   -> ticket selector
//   GET  /api/photos?ticket_id=<uuid>    -> photo grid
//   GET  /api/photos/<id>                -> bytes (auth-required, fetched
//                                          via aiClient.fetchPhotoDataUri so
//                                          we can attach the JWT)
//   POST /api/ai/analyze-photo           -> Claude vision result

import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import {
    ActivityIndicator,
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { MainFrame } from '@/components/MainFrame'
import {
    analyzePhoto,
    fetchPhotoDataUri,
    friendlyAIError,
    listAssignedTickets,
    listTicketPhotos,
    AssignedTicketSummary,
    PhotoAnalysis,
    TicketPhotoSummary,
} from '@/utils/aiClient'

// ─── Helpers ───────────────────────────────────────────────────────────────

function severityColor(s: PhotoAnalysis['severity']) {
    switch (s) {
        case 'high':   return { fg: '#ef4444', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)' }
        case 'medium': return { fg: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' }
        case 'low':    return { fg: '#facc15', bg: 'rgba(250,204,21,0.12)', border: 'rgba(250,204,21,0.3)' }
        case 'none':
        default:       return { fg: '#34d399', bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.3)' }
    }
}

// Compact label for the corner badge on thumbnails. Full word looks crowded
// in a 31%-wide tile, so we abbreviate medium and treat 'none' as "OK".
function severityShort(s: PhotoAnalysis['severity']) {
    switch (s) {
        case 'high':   return 'HIGH'
        case 'medium': return 'MED'
        case 'low':    return 'LOW'
        case 'none':
        default:       return 'OK'
    }
}

function ticketLabel(t: AssignedTicketSummary) {
    const short = (t.description || '').split('\n')[0].slice(0, 50)
    return short ? `${short}${t.description.length > 50 ? '...' : ''}` : `Ticket ${t.id.slice(0, 8)}`
}

function fmtDate(iso: string | null | undefined) {
    if (!iso) return ''
    try {
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return '' }
}

// ─── Authed thumbnail component ────────────────────────────────────────────
// React Native's <Image> can't attach the Authorization header, so we fetch
// the bytes through aiClient (which sets the JWT) and convert to a data URI.

const AuthedThumbnail: FC<{ photoId: string; style?: any }> = ({ photoId, style }) => {
    const [uri, setUri] = useState<string | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        setFailed(false)
        setUri(null)
        fetchPhotoDataUri(photoId)
            .then(d => { if (!cancelled) setUri(d) })
            .catch(()  => { if (!cancelled) setFailed(true) })
        return () => { cancelled = true }
    }, [photoId])

    if (failed) {
        return (
            <View style={[s.thumbFallback, style]}>
                <Ionicons name="image-outline" size={20} color="rgba(255,255,255,0.3)" />
            </View>
        )
    }
    if (!uri) {
        return (
            <View style={[s.thumbFallback, style]}>
                <ActivityIndicator size="small" color="rgba(255,255,255,0.4)" />
            </View>
        )
    }
    return <Image source={{ uri }} style={[s.thumb, style]} />
}

// ─── Main screen ──────────────────────────────────────────────────────────

export const PhotoReviewScreen: FC = () => {
    const [tickets, setTickets]                 = useState<AssignedTicketSummary[]>([])
    const [loadingTickets, setLoadingTickets]   = useState(true)
    const [selectedTicketId, setSelectedTicket] = useState<string | null>(null)
    const [pickerOpen, setPickerOpen]           = useState(false)

    const [photos, setPhotos]                   = useState<TicketPhotoSummary[]>([])
    const [loadingPhotos, setLoadingPhotos]     = useState(false)
    const [photoError, setPhotoError]           = useState<string | null>(null)

    // Map photo id -> latest analysis result, so re-tapping a photo doesn't
    // re-bill the AI. Cleared whenever the selected ticket changes.
    const [analyses, setAnalyses] = useState<Record<string, PhotoAnalysis>>({})
    const [analyzingId, setAnalyzingId] = useState<string | null>(null)
    const [analysisError, setAnalysisError] = useState<string | null>(null)

    // Modal state for the focused photo + its analysis
    const [focusedPhoto, setFocusedPhoto] = useState<TicketPhotoSummary | null>(null)

    // ── Load tickets on focus ─────────────────────────────────────────────
    useFocusEffect(useCallback(() => {
        let cancelled = false
        setLoadingTickets(true)
        listAssignedTickets()
            .then(ts => {
                if (cancelled) return
                setTickets(ts)
                // Auto-select the first ticket if nothing's selected yet,
                // so the screen doesn't open empty.
                if (!selectedTicketId && ts.length > 0) {
                    setSelectedTicket(ts[0].id)
                }
            })
            .catch(() => { /* surfaced via empty state */ })
            .finally(() => { if (!cancelled) setLoadingTickets(false) })
        return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []))

    // ── Load photos when ticket changes ───────────────────────────────────
    useEffect(() => {
        if (!selectedTicketId) {
            setPhotos([])
            return
        }
        let cancelled = false
        setLoadingPhotos(true)
        setPhotoError(null)
        setAnalyses({}) // analyses are per-ticket; reset on ticket change
        listTicketPhotos(selectedTicketId)
            .then(ps => { if (!cancelled) setPhotos(ps) })
            .catch(e  => { if (!cancelled) setPhotoError(friendlyAIError(e)) })
            .finally(() => { if (!cancelled) setLoadingPhotos(false) })
        return () => { cancelled = true }
    }, [selectedTicketId])

    const selectedTicket = useMemo(
        () => tickets.find(t => t.id === selectedTicketId) ?? null,
        [tickets, selectedTicketId],
    )

    // ── Analyze a photo ───────────────────────────────────────────────────
    const handleAnalyze = async (photoId: string) => {
        if (analyzingId) return
        if (analyses[photoId]) return // already cached
        setAnalyzingId(photoId)
        setAnalysisError(null)
        try {
            const result = await analyzePhoto(photoId)
            setAnalyses(prev => ({ ...prev, [photoId]: result }))
        } catch (e: any) {
            setAnalysisError(friendlyAIError(e))
        } finally {
            setAnalyzingId(null)
        }
    }

    return (
        <MainFrame headerMenu={['Menu2', ['Photo Review']]}>
            <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

                {/* Welcome strip */}
                <View style={s.welcome}>
                    <View style={s.welcomeIcon}>
                        <Ionicons name="scan-circle-outline" size={22} color="#a78bfa" />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={s.welcomeTitle}>AI Photo Review</Text>
                        <Text style={s.welcomeBody}>
                            Pick a ticket, tap a photo, then "Analyze with AI" to flag safety
                            and OSHA concerns.
                        </Text>
                    </View>
                </View>

                {/* Ticket selector */}
                <Text style={s.sectionLabel}>Ticket</Text>
                <TouchableOpacity
                    style={s.ticketBtn}
                    onPress={() => setPickerOpen(true)}
                    disabled={loadingTickets || tickets.length === 0}
                    activeOpacity={0.7}
                >
                    {loadingTickets ? (
                        <ActivityIndicator size="small" color="#a78bfa" />
                    ) : tickets.length === 0 ? (
                        <Text style={s.ticketBtnTextMuted}>No assigned tickets</Text>
                    ) : selectedTicket ? (
                        <>
                            <Ionicons name="document-text-outline" size={16} color="#a78bfa" />
                            <Text style={s.ticketBtnText} numberOfLines={1}>
                                {ticketLabel(selectedTicket)}
                            </Text>
                        </>
                    ) : (
                        <Text style={s.ticketBtnTextMuted}>Pick a ticket</Text>
                    )}
                    <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.5)" style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>

                {/* Photo grid */}
                <View style={s.photosHeader}>
                    <Text style={[s.sectionLabel, { marginTop: 0 }]}>Photos</Text>
                    {photos.length > 0 && (
                        <Text style={s.analyzedCount}>
                            {Object.keys(analyses).length}/{photos.length} analyzed
                        </Text>
                    )}
                </View>
                {loadingPhotos ? (
                    <View style={s.center}>
                        <ActivityIndicator size="large" color="#a78bfa" />
                    </View>
                ) : photoError ? (
                    <View style={s.errorBox}>
                        <Ionicons name="alert-circle-outline" size={18} color="#ef4444" />
                        <Text style={s.errorText}>{photoError}</Text>
                    </View>
                ) : photos.length === 0 ? (
                    <View style={s.empty}>
                        <Ionicons name="images-outline" size={32} color="rgba(255,255,255,0.2)" />
                        <Text style={s.emptyText}>
                            {selectedTicket ? 'No photos on this ticket yet.' : 'Pick a ticket to see its photos.'}
                        </Text>
                    </View>
                ) : (
                    <View style={s.grid}>
                        {photos.map(p => {
                            const a  = analyses[p.id]
                            const sc = a ? severityColor(a.severity) : null
                            return (
                                <TouchableOpacity
                                    key={p.id}
                                    style={[
                                        s.gridItem,
                                        sc && { borderColor: sc.fg, borderWidth: 2 },
                                    ]}
                                    onPress={() => setFocusedPhoto(p)}
                                    activeOpacity={0.8}
                                >
                                    <AuthedThumbnail photoId={p.id} />
                                    {a && sc && (
                                        <View style={[s.severityBadgeCorner, { backgroundColor: sc.fg }]}>
                                            <Ionicons
                                                name={a.severity === 'none' ? 'checkmark' : 'warning'}
                                                size={9}
                                                color="#0a0a0a"
                                            />
                                            <Text style={s.severityBadgeCornerText}>
                                                {severityShort(a.severity)}
                                            </Text>
                                        </View>
                                    )}
                                </TouchableOpacity>
                            )
                        })}
                    </View>
                )}

            </ScrollView>

            {/* Ticket picker modal */}
            <Modal
                visible={pickerOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setPickerOpen(false)}
            >
                <View style={s.modalBackdrop}>
                    <View style={s.pickerCard}>
                        <Text style={s.pickerTitle}>Pick a ticket</Text>
                        <ScrollView style={{ maxHeight: 360 }}>
                            {tickets.map(t => (
                                <TouchableOpacity
                                    key={t.id}
                                    style={[s.pickerRow, t.id === selectedTicketId && s.pickerRowActive]}
                                    onPress={() => {
                                        setSelectedTicket(t.id)
                                        setPickerOpen(false)
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons
                                        name={t.id === selectedTicketId ? 'radio-button-on' : 'radio-button-off'}
                                        size={16}
                                        color={t.id === selectedTicketId ? '#a78bfa' : 'rgba(255,255,255,0.4)'}
                                    />
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.pickerLabel} numberOfLines={2}>{ticketLabel(t)}</Text>
                                        <Text style={s.pickerMeta}>
                                            {t.status} · {fmtDate(t.created_at)}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                        <TouchableOpacity style={s.pickerClose} onPress={() => setPickerOpen(false)}>
                            <Text style={s.pickerCloseText}>Close</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Focused photo + analyze modal */}
            <Modal
                visible={focusedPhoto !== null}
                transparent
                animationType="slide"
                onRequestClose={() => setFocusedPhoto(null)}
            >
                <View style={s.modalBackdrop}>
                    <View style={s.focusedCard}>
                        {focusedPhoto && (
                            <ScrollView showsVerticalScrollIndicator={false}>
                                <View style={s.focusedHeader}>
                                    <Text style={s.focusedTitle}>Photo</Text>
                                    <TouchableOpacity onPress={() => setFocusedPhoto(null)} hitSlop={10}>
                                        <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
                                    </TouchableOpacity>
                                </View>

                                <AuthedThumbnail
                                    photoId={focusedPhoto.id}
                                    style={s.focusedImage}
                                />

                                <Text style={s.focusedMeta}>
                                    Uploaded {fmtDate(focusedPhoto.created_at)}
                                    {focusedPhoto.latitude != null && focusedPhoto.longitude != null
                                        ? ` · ${focusedPhoto.latitude.toFixed(4)}, ${focusedPhoto.longitude.toFixed(4)}`
                                        : ''}
                                </Text>

                                {/* Analyze button or analysis result */}
                                {analyses[focusedPhoto.id] ? (
                                    <AnalysisCard analysis={analyses[focusedPhoto.id]} />
                                ) : (
                                    <TouchableOpacity
                                        style={[
                                            s.analyzeBtn,
                                            analyzingId === focusedPhoto.id && s.analyzeBtnDisabled,
                                        ]}
                                        onPress={() => handleAnalyze(focusedPhoto.id)}
                                        disabled={analyzingId === focusedPhoto.id}
                                        activeOpacity={0.8}
                                    >
                                        {analyzingId === focusedPhoto.id ? (
                                            <>
                                                <ActivityIndicator size="small" color="#0a0a0a" />
                                                <Text style={s.analyzeBtnText}>Analyzing...</Text>
                                            </>
                                        ) : (
                                            <>
                                                <Ionicons name="sparkles" size={16} color="#0a0a0a" />
                                                <Text style={s.analyzeBtnText}>Analyze with AI</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                )}

                                {analysisError && (
                                    <View style={s.errorBox}>
                                        <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
                                        <Text style={s.errorText}>{analysisError}</Text>
                                    </View>
                                )}
                            </ScrollView>
                        )}
                    </View>
                </View>
            </Modal>
        </MainFrame>
    )
}

export default PhotoReviewScreen

// ─── Analysis result card ──────────────────────────────────────────────────

const AnalysisCard: FC<{ analysis: PhotoAnalysis }> = ({ analysis }) => {
    const sc = severityColor(analysis.severity)
    return (
        <View style={s.analysisCard}>
            {/* Severity + summary */}
            <View style={[s.severityBadge, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                <Text style={[s.severityText, { color: sc.fg }]} numberOfLines={1}>
                    {analysis.severity.toUpperCase()}
                </Text>
            </View>
            <Text style={s.summary}>{analysis.summary}</Text>

            {/* Concerns */}
            {analysis.concerns.length > 0 && (
                <>
                    <Text style={s.subLabel}>Concerns</Text>
                    {analysis.concerns.map((c, i) => (
                        <View key={i} style={s.bulletRow}>
                            <Text style={s.bulletDot}>•</Text>
                            <Text style={s.bulletText}>{c}</Text>
                        </View>
                    ))}
                </>
            )}

            {/* Recommendations */}
            {analysis.recommendations.length > 0 && (
                <>
                    <Text style={[s.subLabel, { marginTop: 10 }]}>Recommended actions</Text>
                    {analysis.recommendations.map((r, i) => (
                        <View key={i} style={s.bulletRow}>
                            <Text style={s.bulletDot}>{i + 1}.</Text>
                            <Text style={s.bulletText}>{r}</Text>
                        </View>
                    ))}
                </>
            )}
        </View>
    )
}

// ─── Styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    scroll:        { flex: 1, width: '100%' },
    scrollContent: { padding: 16, paddingBottom: 32, gap: 8 },

    welcome: {
        flexDirection:   'row',
        gap:             12,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth:     1,
        borderColor:     'rgba(255,255,255,0.08)',
        borderRadius:    14,
        padding:         14,
        alignSelf:       'stretch',
        marginBottom:    8,
    },
    welcomeIcon: {
        width:           36,
        height:          36,
        borderRadius:    18,
        backgroundColor: 'rgba(167,139,250,0.12)',
        borderWidth:     1,
        borderColor:     'rgba(167,139,250,0.25)',
        alignItems:      'center',
        justifyContent:  'center',
    },
    welcomeTitle: { fontFamily: 'poppins-bold', fontSize: 14, color: '#fff' },
    welcomeBody:  { fontFamily: 'poppins-regular', fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 18, marginTop: 2 },

    sectionLabel: {
        fontFamily:   'poppins-bold',
        fontSize:     11,
        color:        'rgba(255,255,255,0.5)',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginTop:    4,
    },

    ticketBtn: {
        flexDirection:     'row',
        alignItems:        'center',
        gap:               10,
        paddingVertical:   12,
        paddingHorizontal: 14,
        borderRadius:      12,
        borderWidth:       1,
        borderColor:       'rgba(255,255,255,0.1)',
        backgroundColor:   'rgba(255,255,255,0.04)',
        alignSelf:         'stretch',
    },
    ticketBtnText:      { flex: 1, fontFamily: 'poppins-regular', fontSize: 13, color: '#fff' },
    ticketBtnTextMuted: { flex: 1, fontFamily: 'poppins-regular', fontSize: 13, color: 'rgba(255,255,255,0.4)' },

    grid: {
        flexDirection: 'row',
        flexWrap:      'wrap',
        gap:           8,
        alignSelf:     'stretch',
    },
    gridItem: {
        width:           '31%',
        aspectRatio:     1,
        borderRadius:    10,
        overflow:        'hidden',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth:     1,
        borderColor:     'rgba(255,255,255,0.08)',
        position:        'relative',
    },
    thumb:         { width: '100%', height: '100%' },
    thumbFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },

    // Corner badge that overlays an analyzed thumbnail. Pairs with the
    // colored 2px border on the gridItem so the severity reads at a glance.
    severityBadgeCorner: {
        position:          'absolute',
        top:               4,
        right:             4,
        flexDirection:     'row',
        alignItems:        'center',
        gap:               2,
        paddingHorizontal: 5,
        paddingVertical:   2,
        borderRadius:      6,
        borderWidth:       1,
        borderColor:       '#0a0a0a',
    },
    severityBadgeCornerText: {
        fontFamily:    'poppins-bold',
        fontSize:      9,
        color:         '#0a0a0a',
        letterSpacing: 0.3,
    },

    photosHeader: {
        flexDirection:  'row',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginTop:      16,
        marginBottom:   4,
    },
    analyzedCount: {
        fontFamily: 'poppins-regular',
        fontSize:   11,
        color:      'rgba(167,139,250,0.7)',
    },

    center: { padding: 32, alignItems: 'center' },
    empty:  { padding: 24, alignItems: 'center', gap: 8 },
    emptyText: {
        fontFamily: 'poppins-regular', fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'center',
    },

    errorBox: {
        flexDirection:   'row',
        alignItems:      'center',
        gap:             8,
        padding:         10,
        borderRadius:    10,
        borderWidth:     1,
        borderColor:     'rgba(239,68,68,0.3)',
        backgroundColor: 'rgba(239,68,68,0.08)',
        marginTop:       10,
    },
    errorText: { flex: 1, fontFamily: 'poppins-regular', fontSize: 12, color: '#ef4444' },

    // Modals (shared backdrop)
    modalBackdrop: {
        flex:            1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems:      'center',
        justifyContent:  'center',
        padding:         20,
    },

    // Ticket picker
    pickerCard: {
        width:           '100%',
        maxWidth:        420,
        backgroundColor: '#0f0f12',
        borderRadius:    18,
        borderWidth:     1,
        borderColor:     'rgba(255,255,255,0.08)',
        padding:         18,
        gap:             10,
    },
    pickerTitle: { fontFamily: 'poppins-bold', fontSize: 15, color: '#fff', marginBottom: 4 },
    pickerRow: {
        flexDirection:     'row',
        alignItems:        'center',
        gap:               10,
        paddingVertical:   10,
        paddingHorizontal: 8,
        borderRadius:      10,
    },
    pickerRowActive: { backgroundColor: 'rgba(167,139,250,0.08)' },
    pickerLabel: { fontFamily: 'poppins-regular', fontSize: 13, color: '#fff' },
    pickerMeta:  { fontFamily: 'poppins-regular', fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
    pickerClose: { alignSelf: 'flex-end', paddingVertical: 10, paddingHorizontal: 14 },
    pickerCloseText: { fontFamily: 'poppins-regular', fontSize: 13, color: 'rgba(255,255,255,0.7)' },

    // Focused photo modal
    focusedCard: {
        width:           '100%',
        maxWidth:        500,
        maxHeight:       '90%',
        backgroundColor: '#0f0f12',
        borderRadius:    18,
        borderWidth:     1,
        borderColor:     'rgba(255,255,255,0.08)',
        padding:         16,
    },
    focusedHeader: {
        flexDirection:  'row',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   10,
    },
    focusedTitle: { fontFamily: 'poppins-bold', fontSize: 15, color: '#fff' },
    focusedImage: {
        width:           '100%',
        height:          280,
        borderRadius:    12,
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    focusedMeta: {
        fontFamily: 'poppins-regular',
        fontSize:   11,
        color:      'rgba(255,255,255,0.5)',
        marginTop:  8,
    },

    // Analyze button
    analyzeBtn: {
        flexDirection:    'row',
        alignItems:       'center',
        justifyContent:   'center',
        gap:              8,
        marginTop:        12,
        paddingVertical:  12,
        borderRadius:     12,
        backgroundColor:  '#a78bfa',
    },
    analyzeBtnDisabled: { opacity: 0.6 },
    analyzeBtnText:     { fontFamily: 'poppins-bold', fontSize: 13, color: '#0a0a0a' },

    // Analysis result card
    analysisCard: {
        marginTop:       12,
        padding:         12,
        borderRadius:    12,
        borderWidth:     1,
        borderColor:     'rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(255,255,255,0.03)',
        gap:             6,
    },
    severityBadge: {
        alignSelf:         'flex-start',
        paddingVertical:   3,
        paddingHorizontal: 10,
        borderRadius:      8,
        borderWidth:       1,
    },
    severityText: { fontFamily: 'poppins-bold', fontSize: 11 },
    summary: { fontFamily: 'poppins-regular', fontSize: 13, color: '#fff', lineHeight: 19, marginTop: 4 },
    subLabel: {
        fontFamily:    'poppins-bold',
        fontSize:      11,
        color:         'rgba(255,255,255,0.5)',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        marginTop:     6,
    },
    bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 4 },
    bulletDot: {
        fontFamily: 'poppins-bold',
        fontSize:   13,
        color:      '#a78bfa',
        minWidth:   18,
    },
    bulletText: {
        flex:       1,
        fontFamily: 'poppins-regular',
        fontSize:   12,
        color:      'rgba(255,255,255,0.8)',
        lineHeight: 18,
    },
})
