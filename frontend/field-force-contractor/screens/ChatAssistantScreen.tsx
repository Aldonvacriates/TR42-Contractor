// ChatAssistantScreen.tsx
// Field Force AI assistant. Stateless chat with Claude. The screen owns the
// conversation history and sends the whole array to /api/ai/chat each turn,
// so reloading the screen wipes the conversation (intentional for now).
// If we want persistence later we'll add an ai_chat_session table on the
// backend without changing this file's contract.

import { FC, useEffect, useRef, useState } from 'react'
import {
    Alert,
    Animated,
    Modal,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import { MainFrame } from '@/components/MainFrame'
import { MarkdownView } from '@/components/MarkdownView'
import { SearchBar } from '@/components/SearchBar'
import { InitID } from '@/utils/InitID'
import { TimeFormater } from '@/utils/timeFormater'
import {
    chat,
    ChatMessage as AIChatMessage,
    friendlyAIError,
    saveChat,
    SavedChatMessage,
} from '@/utils/aiClient'
import { exportChatPdf } from '@/utils/pdfExport'

// ─── Types ────────────────────────────────────────────────────────────────────

type Bubble = {
    id:        string
    role:      'user' | 'assistant'
    text:      string
    timeStamp: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** OSHA-citation-flavoured prompt templates. The full pool is larger than
 *  what we display at any one time — the chips below cycle through the pool
 *  with a fade animation so contractors browsing the assistant see different
 *  starter ideas each time, all anchored on real OSHA citations and common
 *  field issues. */
const OSHA_TEMPLATES: { label: string; icon: string }[] = [
    { label: 'Cite OSHA 1910.146 — confined space entry permit requirements',  icon: 'document-lock-outline' },
    { label: 'OSHA 1910.147 lockout/tagout — what do I do before service?',    icon: 'lock-closed-outline' },
    { label: 'OSHA 1910.132 PPE assessment — high-pressure lines',              icon: 'shield-checkmark-outline' },
    { label: 'OSHA 1910.1200 HazCom — chemical I cannot identify on site',     icon: 'flask-outline' },
    { label: 'OSHA 1926.501 fall protection at 6+ ft — required gear',         icon: 'arrow-down-outline' },
    { label: 'OSHA 1910.134 respirator — change-out schedule + fit test',      icon: 'medkit-outline' },
    { label: 'OSHA 1910.95 hearing conservation — when do I need plugs?',      icon: 'ear-outline' },
    { label: 'OSHA 1926.451 scaffolding inspection before each shift',         icon: 'construct-outline' },
    { label: 'How do I document a near miss with photo + GPS for the file?',  icon: 'document-text-outline' },
    { label: 'Eyewash failed — which OSHA standard covers replacement time?',  icon: 'water-outline' },
    { label: 'Hot work permit — OSHA 1910.252 welding/cutting/brazing',         icon: 'flame-outline' },
    { label: 'OSHA 1910.178 powered industrial trucks — daily inspection',     icon: 'car-outline' },
    { label: "Explain my ticket's anomaly flag in plain language",             icon: 'help-circle-outline' },
    { label: 'Citation 1910.23 walking surfaces — guardrail height + load',   icon: 'list-outline' },
]

/** Number of chips visible at once. Cycle picks this many from the pool. */
const VISIBLE_CHIP_COUNT = 4

/** Milliseconds between rotations of the visible chip set. Long enough to
 *  read but short enough to feel alive. */
const ROTATION_INTERVAL_MS = 5000

const WELCOME_TEXT =
    "Hi! I'm your field assistant.\n\nAsk me about procedures, safety, OSHA citations, or troubleshooting equipment. Tap a suggestion below to start — the templates rotate so you'll see fresh ideas every few seconds."

// ─── Typing indicator ─────────────────────────────────────────────────────────

const TypingIndicator: FC = () => {
    const dots = [
        useRef(new Animated.Value(0.3)).current,
        useRef(new Animated.Value(0.3)).current,
        useRef(new Animated.Value(0.3)).current,
    ]

    useEffect(() => {
        const animate = (dot: Animated.Value, delay: number) =>
            Animated.loop(
                Animated.sequence([
                    Animated.delay(delay),
                    Animated.timing(dot, { toValue: 1,   duration: 300, useNativeDriver: true }),
                    Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
                    Animated.delay(600),
                ])
            ).start()

        dots.forEach((d, i) => animate(d, i * 150))
        return () => dots.forEach(d => d.stopAnimation())
    }, [])

    return (
        <View style={s.rowReceived}>
            <View style={s.aiAvatar}>
                <Ionicons name="sparkles" size={14} color="#a78bfa" />
            </View>
            <View style={s.typingBubble}>
                {dots.map((d, i) => (
                    <Animated.View key={i} style={[s.typingDot, { opacity: d }]} />
                ))}
            </View>
        </View>
    )
}

// ─── Bubbles ──────────────────────────────────────────────────────────────────

const AssistantBubble: FC<{ text: string; time: string }> = ({ text, time }) => (
    <View style={s.rowReceived}>
        <View style={s.aiAvatar}>
            <Ionicons name="sparkles" size={14} color="#a78bfa" />
        </View>
        <View style={{ flex: 1 }}>
            <View style={s.aiBubble}>
                {/* Render the assistant's reply as markdown so **bold**,
                    *italics*, lists, headings, inline code, links, and
                    block quotes display the way the model emits them
                    rather than as raw asterisks and hashes. */}
                <MarkdownView>{text}</MarkdownView>
            </View>
            <Text style={s.timeLabel}>{time}</Text>
        </View>
    </View>
)

const UserBubble: FC<{ text: string; time: string }> = ({ text, time }) => (
    <View style={s.rowSent}>
        <View style={s.userColumn}>
            <View style={s.userBubble}>
                <Text style={s.userText}>{text}</Text>
            </View>
            <Text style={s.timeLabel}>{time}</Text>
        </View>
    </View>
)

// ─── Rotating OSHA-citation templates ─────────────────────────────────────────
//
// Cory's stakeholder ask was for the AI assistant to help with OSHA citation
// lookups when a contractor hits a safety issue in the field. Surfacing one
// fixed list of suggestions hides the breadth of what the assistant can do,
// so the chips cycle through OSHA_TEMPLATES on a timer with a fade animation
// — the contractor sees fresh prompt ideas every few seconds and is much
// more likely to discover a useful starting point.
//
// Each visible chip also has its own subtle pulse animation so the row reads
// as alive even between full rotations.

const RotatingTemplates: FC<{ onPick: (label: string) => void }> = ({ onPick }) => {
    // Window into OSHA_TEMPLATES — slide it forward by VISIBLE_CHIP_COUNT
    // every ROTATION_INTERVAL_MS. We start at zero so the first frame is
    // deterministic for screenshot tests.
    const [windowStart, setWindowStart] = useState(0)
    const fade = useRef(new Animated.Value(1)).current
    const pulse = useRef(new Animated.Value(0)).current

    useEffect(() => {
        // Slow pulse — gives every chip a continuous low-key shimmer so the
        // user notices the row is interactive without it feeling frantic.
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
                Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
            ])
        ).start()

        // Rotate the visible window: fade out, advance the start index, fade
        // back in. Faster than re-mounting the chips and keeps the layout
        // stable so the keyboard / scroll position never jumps.
        const rotate = () => {
            Animated.timing(fade, {
                toValue:         0,
                duration:        260,
                useNativeDriver: true,
            }).start(() => {
                setWindowStart(prev => (prev + VISIBLE_CHIP_COUNT) % OSHA_TEMPLATES.length)
                Animated.timing(fade, {
                    toValue:         1,
                    duration:        260,
                    useNativeDriver: true,
                }).start()
            })
        }
        const id = setInterval(rotate, ROTATION_INTERVAL_MS)
        return () => {
            clearInterval(id)
            fade.stopAnimation()
            pulse.stopAnimation()
        }
    }, [fade, pulse])

    // Pulse maps 0 -> 1 to a subtle 0.85 -> 1 opacity shimmer on the chip
    // border + background. Keeps the chips feeling "live" between rotations.
    const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] })

    // Slice the visible window with wrap-around so we never run out of chips.
    const visible = Array.from({ length: VISIBLE_CHIP_COUNT }, (_, i) => {
        return OSHA_TEMPLATES[(windowStart + i) % OSHA_TEMPLATES.length]
    })

    return (
        <View style={s.chipsRow}>
            <View style={s.chipsHeader}>
                <Ionicons name="flash" size={12} color="#a78bfa" />
                <Text style={s.chipsHeaderText}>OSHA citation templates</Text>
            </View>
            <Animated.View style={[s.chips, { opacity: fade }]}>
                {visible.map(({ label, icon }) => (
                    <Animated.View key={label} style={{ opacity: pulseOpacity }}>
                        <TouchableOpacity
                            style={s.chip}
                            onPress={() => onPick(label)}
                            activeOpacity={0.7}
                        >
                            <Ionicons name={icon as any} size={14} color="#a78bfa" />
                            <Text style={s.chipText} numberOfLines={2}>{label}</Text>
                        </TouchableOpacity>
                    </Animated.View>
                ))}
            </Animated.View>
        </View>
    )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export const ChatAssistantScreen: FC = () => {
    const navigation                           = useNavigation<any>()
    const [bubbles, setBubbles]                = useState<Bubble[]>([])
    const [loading, setLoading]                = useState(false)
    const [suggestionsVisible, setSuggestions] = useState(true)
    const scrollRef                            = useRef<ScrollView>(null)

    // Optional photo to attach to the conversation when the contractor
    // chooses to save it. URI lives in component state — only matters at
    // save time. Cleared on restart.
    const [attachedPhotoUri, setAttachedPhotoUri] = useState<string | null>(null)
    const [saveModalOpen, setSaveModalOpen]       = useState(false)
    const [savingChat, setSavingChat]             = useState(false)
    const [savedAt,    setSavedAt]                = useState<string | null>(null)

    const scroll = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80)

    // ── Restart the conversation ────────────────────────────────────────
    // Pull-to-refresh fires this. Clears every bubble, brings back the
    // welcome card and the rotating OSHA chips, and drops any attached
    // photo. We confirm because the contractor might have just spent a
    // few minutes building context with the assistant.
    const restartChat = () => {
        return new Promise<void>(resolve => {
            if (bubbles.length === 0) {
                // Nothing to lose — just bounce.
                setAttachedPhotoUri(null)
                resolve()
                return
            }
            Alert.alert(
                'Start a new conversation?',
                'This clears the current questions and answers. The assistant has no memory across conversations, so anything you said will be lost.',
                [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
                    {
                        text: 'Start New', style: 'destructive', onPress: () => {
                            setBubbles([])
                            setSuggestions(true)
                            setAttachedPhotoUri(null)
                            setSavedAt(null)
                            resolve()
                        },
                    },
                ],
            )
        })
    }

    // ── Save / share the conversation ───────────────────────────────────
    // Builds a clean markdown transcript the contractor can email, save
    // to Notes, send to a supervisor, or drop into a ticket comment.
    // If a photo is attached, the share sheet sends the image alongside
    // the transcript so the recipient sees the context.
    const buildTranscript = (): string => {
        const header = '# Field Assistant Conversation'
        const stamp  = `Saved ${new Date().toLocaleString()}`
        if (bubbles.length === 0) {
            return `${header}\n${stamp}\n\n(Empty conversation)`
        }
        const turns = bubbles.map(b => {
            const who = b.role === 'user' ? 'Contractor' : 'Assistant'
            return `**${who}** · ${b.timeStamp}\n${b.text}`
        }).join('\n\n')
        return `${header}\n${stamp}\n\n${turns}`
    }

    const pickPhotoForChat = async () => {
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
            if (status !== 'granted') {
                Alert.alert(
                    'Photo library permission needed',
                    'Allow library access in Settings to attach a photo.',
                )
                return
            }
            const res = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality:    0.7,
            })
            if (!res.canceled && res.assets[0]?.uri) {
                setAttachedPhotoUri(res.assets[0].uri)
            }
        } catch (err: any) {
            Alert.alert('Photo library error', err?.message ?? 'Could not open the photo library.')
        }
    }

    const takePhotoForChat = async () => {
        try {
            const { status } = await ImagePicker.requestCameraPermissionsAsync()
            if (status !== 'granted') {
                Alert.alert(
                    'Camera permission needed',
                    'Allow camera access in Settings to capture a photo.',
                )
                return
            }
            const res = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality:    0.7,
            })
            if (!res.canceled && res.assets[0]?.uri) {
                setAttachedPhotoUri(res.assets[0].uri)
            }
        } catch (err: any) {
            Alert.alert('Camera error', err?.message ?? 'Could not open the camera.')
        }
    }

    // Saved Reports already lists ai_inspection_reports; adding the chat
    // session through the same SavedReports surface is what lets the
    // contractor "find this conversation again later" the way they would
    // an inspection report. Build a title from the first user question
    // (truncated) and a one-line summary so the list view stays readable.
    const buildTitle = (): string => {
        const firstUserMsg = bubbles.find(b => b.role === 'user')?.text?.trim() ?? ''
        if (firstUserMsg) {
            return firstUserMsg.length > 80 ? `${firstUserMsg.slice(0, 80)}...` : firstUserMsg
        }
        return `Conversation · ${new Date().toLocaleDateString()}`
    }
    const buildSummary = (): string | null => {
        const firstAssistantMsg = bubbles.find(b => b.role === 'assistant')?.text?.trim() ?? ''
        if (!firstAssistantMsg) return null
        return firstAssistantMsg.length > 200
            ? `${firstAssistantMsg.slice(0, 200)}...`
            : firstAssistantMsg
    }

    // Persist the conversation through the same backend pattern as
    // saveReport — POST /api/ai/save-chat — so SavedReports can list it
    // alongside inspection reports. The system share sheet still fires so
    // the contractor can email / send a copy on top of having it stored.
    const saveAndShare = async () => {
        if (savingChat || bubbles.length === 0) return
        setSavingChat(true)
        try {
            const messages: SavedChatMessage[] = bubbles.map(b => ({
                role:      b.role,
                content:   b.text,
                timestamp: b.timeStamp,
            }))
            // The backend ai_chat_session.photo_id FKs ticket_photo, which
            // requires a server-side photo id. The picker on this screen
            // only produces a local URI, so we leave photo_id null for
            // now and just include the photo in the system-share payload.
            // A future iteration could upload the photo to a generic
            // contractor-bucket first to persist it server-side.
            await saveChat({
                title:    buildTitle(),
                summary:  buildSummary(),
                messages,
                photoId:  null,
            })
            setSavedAt(new Date().toLocaleTimeString())

            // Then export a branded PDF and open the system share sheet so
            // the contractor can email / Notes / Slack / drop into a ticket
            // comment a polished, self-contained document. The PDF is
            // generated locally via expo-print so this works the same
            // online or offline once the backend save has completed.
            await exportChatPdf({
                title:    buildTitle(),
                summary:  buildSummary(),
                messages,
                photoUri: attachedPhotoUri,
            })
            setSaveModalOpen(false)
        } catch (err: any) {
            Alert.alert(
                'Couldn\'t save chat',
                friendlyAIError(err) ?? err?.message ?? 'Try again.',
            )
        } finally {
            setSavingChat(false)
        }
    }

    const send = async (text: string) => {
        const trimmed = text.trim()
        if (!trimmed || loading) return
        setSuggestions(false)

        // Capture the new bubble list synchronously so we can build the
        // history array sent to the API below without depending on stale
        // useState values.
        const userBubble: Bubble = {
            id:        InitID.getId(),
            role:      'user',
            text:      trimmed,
            timeStamp: TimeFormater.getTimeStamp(),
        }
        const nextBubbles = [...bubbles, userBubble]
        setBubbles(nextBubbles)
        setLoading(true)
        scroll()

        // Build the API messages array. The backend caps history at 50 turns
        // so we send the most recent 50 if we ever get there.
        const history: AIChatMessage[] = nextBubbles
            .slice(-50)
            .map(b => ({ role: b.role, content: b.text }))

        try {
            const { reply } = await chat(history)
            setBubbles(curr => [...curr, {
                id:        InitID.getId(),
                role:      'assistant',
                text:      reply,
                timeStamp: TimeFormater.getTimeStamp(),
            }])
        } catch (e: any) {
            setBubbles(curr => [...curr, {
                id:        InitID.getId(),
                role:      'assistant',
                text:      friendlyAIError(e),
                timeStamp: TimeFormater.getTimeStamp(),
            }])
        } finally {
            setLoading(false)
            scroll()
        }
    }

    // SearchBar handles its own keyboard-aware float via the floatBox spacer
    // (see SearchBar.tsx + Styles.Chat.floatBox). We pass keyboardAware so
    // the spacer fires, and we render the SearchBar directly into the
    // MainFrame footer slot instead of wrapping it in a KeyboardAvoidingView,
    // which used to push the bottom menu up alongside the SearchBar. Jonathan
    // flagged this during testing — the previous wrapping caused the menu
    // and spacer to float when the keyboard appeared.
    const Footer: FC = () => (
        <SearchBar
            placeHolder="Ask the assistant..."
            buttonText="Send"
            onClick={(msg: string) => { if (msg) send(msg) }}
            keyboardAware={true}
        />
    )

    return (
        <>
            <MainFrame
                headerMenu={['Menu2', ['Field Assistant']]}
                injectFooter={<Footer />}
                // Pull-to-refresh on the chat means "start over". The
                // assistant has no memory across conversations so this is
                // the natural way to reset for a fresh question.
                onRefresh={restartChat}
            >
                {/* Action row: Save / Share above the welcome so contractors
                    can always reach it without scrolling to the end of a long
                    transcript. Disabled when there's nothing to save yet. */}
                <View style={s.actionRow}>
                    <TouchableOpacity
                        style={[s.actionBtn, bubbles.length === 0 && s.actionBtnDisabled]}
                        onPress={() => bubbles.length > 0 && setSaveModalOpen(true)}
                        disabled={bubbles.length === 0}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="bookmark-outline" size={14} color="#a78bfa" />
                        <Text style={s.actionBtnText}>Save / Share</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[s.actionBtn, bubbles.length === 0 && s.actionBtnDisabled]}
                        onPress={restartChat}
                        disabled={bubbles.length === 0}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="refresh" size={14} color="#a78bfa" />
                        <Text style={s.actionBtnText}>New Chat</Text>
                    </TouchableOpacity>
                </View>

                <ScrollView
                    ref={scrollRef}
                    style={s.scroll}
                    contentContainerStyle={s.scrollContent}
                    onContentSizeChange={scroll}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >

                    {/* Welcome card */}
                    <View style={s.welcomeCard}>
                        <View style={s.welcomeIconWrap}>
                            <Ionicons name="sparkles" size={20} color="#a78bfa" />
                        </View>
                        <Text style={s.welcomeTitle}>Field Assistant</Text>
                        <Text style={s.welcomeBody}>{WELCOME_TEXT}</Text>
                    </View>

                    {/* AI hub shortcuts — quick access to the two non-chat AI flows
                        (photo analysis with Gemini vision, and the streaming
                        inspection-report generator from voice notes). The chat
                        itself stays the default surface; these are side doors. */}
                    {suggestionsVisible && (
                        <View style={s.hubRow}>
                            <TouchableOpacity
                                style={s.hubCard}
                                onPress={() => navigation.navigate('PhotoReview')}
                                activeOpacity={0.8}
                            >
                                <View style={[s.hubIconWrap, { backgroundColor: 'rgba(52,211,153,0.12)', borderColor: 'rgba(52,211,153,0.3)' }]}>
                                    <Ionicons name="camera" size={18} color="#34d399" />
                                </View>
                                <Text style={s.hubCardTitle}>Analyze a Photo</Text>
                                <Text style={s.hubCardBody}>
                                    Run Gemini vision on a ticket photo for safety + OSHA concerns.
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={s.hubCard}
                                onPress={() => navigation.navigate('InspectionAssist')}
                                activeOpacity={0.8}
                            >
                                <View style={[s.hubIconWrap, { backgroundColor: 'rgba(167,139,250,0.12)', borderColor: 'rgba(167,139,250,0.3)' }]}>
                                    <Ionicons name="document-text" size={18} color="#a78bfa" />
                                </View>
                                <Text style={s.hubCardTitle}>Inspection Report</Text>
                                <Text style={s.hubCardBody}>
                                    Turn voice notes into a structured report with citations.
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={s.hubCard}
                                onPress={() => navigation.navigate('IncidentReport')}
                                activeOpacity={0.8}
                            >
                                <View style={[s.hubIconWrap, { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.3)' }]}>
                                    <Ionicons name="warning" size={18} color="#ef4444" />
                                </View>
                                <Text style={s.hubCardTitle}>Report Incident</Text>
                                <Text style={s.hubCardBody}>
                                    Capture a hazard, get OSHA-cited recommendations, save + share PDF.
                                </Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* OSHA-citation template chips — rotate every few seconds with a
                        fade animation so contractors see fresh starter prompts. */}
                    {suggestionsVisible && <RotatingTemplates onPick={send} />}

                    {/* Divider once conversation starts */}
                    {bubbles.length > 0 && <View style={s.divider} />}

                    {/* Message thread */}
                    {bubbles.map(b =>
                        b.role === 'assistant'
                            ? <AssistantBubble key={b.id} text={b.text} time={b.timeStamp} />
                            : <UserBubble      key={b.id} text={b.text} time={b.timeStamp} />
                    )}

                    {/* Typing indicator */}
                    {loading && <TypingIndicator />}

                </ScrollView>

                {/* ── Save / share modal ───────────────────────────────────
                    Builds a markdown transcript of the conversation and
                    hands it to the system share sheet. Optional photo
                    attachment so the contractor can save the chat with the
                    job-site image that prompted the question. */}
                <Modal
                    visible={saveModalOpen}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setSaveModalOpen(false)}
                >
                    <View style={s.modalOverlay}>
                        <View style={s.saveModal}>
                            <View style={s.saveHeader}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <Ionicons name="bookmark" size={16} color="#a78bfa" />
                                    <Text style={s.saveTitle}>Save this conversation</Text>
                                </View>
                                <TouchableOpacity
                                    onPress={() => setSaveModalOpen(false)}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    <Ionicons name="close" size={22} color="#9ca3af" />
                                </TouchableOpacity>
                            </View>

                            <Text style={s.saveBody}>
                                Saves the conversation to your account and exports a branded
                                PDF you can email, drop into Notes, or attach to a ticket
                                comment. Optionally attach a photo for context — it'll
                                appear inside the PDF.
                            </Text>

                            <View style={s.saveStats}>
                                <Ionicons name="chatbubbles-outline" size={14} color="#a78bfa" />
                                <Text style={s.saveStatsText}>
                                    {bubbles.filter(b => b.role === 'user').length} questions ·{' '}
                                    {bubbles.filter(b => b.role === 'assistant').length} answers
                                </Text>
                            </View>

                            {/* Photo attachment slot */}
                            <View style={s.attachRow}>
                                {attachedPhotoUri ? (
                                    <View style={s.attachedPhotoWrap}>
                                        <View style={s.attachedPhotoBadge}>
                                            <Ionicons name="checkmark-circle" size={14} color="#34d399" />
                                            <Text style={s.attachedPhotoText}>Photo attached</Text>
                                        </View>
                                        <TouchableOpacity
                                            onPress={() => setAttachedPhotoUri(null)}
                                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                        >
                                            <Ionicons name="close-circle" size={18} color="#ef4444" />
                                        </TouchableOpacity>
                                    </View>
                                ) : (
                                    <View style={s.attachActions}>
                                        <TouchableOpacity
                                            style={s.attachBtn}
                                            onPress={takePhotoForChat}
                                            activeOpacity={0.8}
                                        >
                                            <Ionicons name="camera" size={14} color="#a78bfa" />
                                            <Text style={s.attachBtnText}>Take Photo</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={s.attachBtn}
                                            onPress={pickPhotoForChat}
                                            activeOpacity={0.8}
                                        >
                                            <Ionicons name="images" size={14} color="#a78bfa" />
                                            <Text style={s.attachBtnText}>From Library</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>

                            {savedAt && (
                                <View style={s.savedAtBanner}>
                                    <Ionicons name="checkmark-circle" size={14} color="#34d399" />
                                    <Text style={s.savedAtText}>
                                        Saved at {savedAt} — find it in Saved Reports
                                    </Text>
                                </View>
                            )}

                            <View style={s.saveActions}>
                                <TouchableOpacity
                                    style={[s.savePrimaryBtn, savingChat && { opacity: 0.6 }]}
                                    onPress={saveAndShare}
                                    disabled={savingChat}
                                    activeOpacity={0.85}
                                >
                                    {savingChat ? (
                                        <Ionicons name="cloud-upload-outline" size={18} color="#0f172a" />
                                    ) : (
                                        <Ionicons name="save-outline" size={18} color="#0f172a" />
                                    )}
                                    <Text style={s.savePrimaryBtnText}>
                                        {savingChat ? 'Saving…' : 'Save & Share'}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={s.saveCancelBtn}
                                    onPress={() => setSaveModalOpen(false)}
                                    activeOpacity={0.85}
                                >
                                    <Text style={s.saveCancelBtnText}>Cancel</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Modal>
            </MainFrame>
        </>
    )
}

export default ChatAssistantScreen

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({

    scroll:        { flex: 1, width: '100%' },
    scrollContent: { padding: 16, paddingBottom: 24, gap: 12 },

    welcomeCard: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth:     1,
        borderColor:     'rgba(255,255,255,0.08)',
        borderRadius:    16,
        padding:         20,
        alignItems:      'center',
        gap:             10,
        marginBottom:    4,
    },
    welcomeIconWrap: {
        width:           44,
        height:          44,
        borderRadius:    22,
        backgroundColor: 'rgba(167,139,250,0.12)',
        borderWidth:     1,
        borderColor:     'rgba(167,139,250,0.25)',
        alignItems:      'center',
        justifyContent:  'center',
    },
    welcomeTitle: {
        fontFamily:    'poppins-bold',
        fontSize:      16,
        color:         '#ffffff',
        letterSpacing: 0.3,
    },
    welcomeBody: {
        fontFamily: 'poppins-regular',
        fontSize:   13,
        color:      'rgba(255,255,255,0.55)',
        textAlign:  'center',
        lineHeight: 20,
    },

    hubRow: {
        flexDirection: 'row',
        gap:           10,
        marginTop:     6,
        marginBottom:  4,
    },
    hubCard: {
        flex:            1,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth:     1,
        borderColor:     'rgba(255,255,255,0.08)',
        borderRadius:    14,
        padding:         12,
        gap:             8,
    },
    hubIconWrap: {
        width:          32,
        height:         32,
        borderRadius:   16,
        borderWidth:    1,
        alignItems:     'center',
        justifyContent: 'center',
    },
    hubCardTitle: {
        fontFamily: 'poppins-bold',
        fontSize:   13,
        color:      '#ffffff',
    },
    hubCardBody: {
        fontFamily: 'poppins-regular',
        fontSize:   11,
        color:      'rgba(255,255,255,0.55)',
        lineHeight: 15,
    },

    chipsRow:        { gap: 6, marginTop: 4 },
    chipsHeader:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
    chipsHeaderText: {
        fontFamily:    'poppins-bold',
        fontSize:      11,
        color:         '#a78bfa',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    chips: { gap: 8 },
    chip: {
        flexDirection:     'row',
        alignItems:        'center',
        gap:               8,
        alignSelf:         'flex-start',
        backgroundColor:   'rgba(167,139,250,0.08)',
        borderWidth:       1,
        borderColor:       'rgba(167,139,250,0.2)',
        borderRadius:      20,
        paddingVertical:   9,
        paddingHorizontal: 14,
        maxWidth:          '100%',
    },
    chipText: {
        flexShrink: 1,
        fontFamily: 'poppins-regular',
        fontSize:   13,
        color:      '#a78bfa',
    },

    divider: {
        height:          1,
        backgroundColor: 'rgba(255,255,255,0.06)',
        marginVertical:  4,
    },

    rowReceived: {
        flexDirection:  'row',
        alignItems:     'flex-start',
        gap:            10,
        marginVertical: 4,
    },
    aiAvatar: {
        width:           28,
        height:          28,
        borderRadius:    14,
        backgroundColor: 'rgba(167,139,250,0.12)',
        borderWidth:     1,
        borderColor:     'rgba(167,139,250,0.25)',
        alignItems:      'center',
        justifyContent:  'center',
        marginTop:       2,
    },
    aiBubble: {
        backgroundColor:     'rgba(255,255,255,0.05)',
        borderWidth:         1,
        borderColor:         'rgba(255,255,255,0.09)',
        borderRadius:        16,
        borderTopLeftRadius: 4,
        paddingVertical:     12,
        paddingHorizontal:   14,
    },
    aiText: {
        fontFamily: 'poppins-regular',
        fontSize:   14,
        color:      'rgba(255,255,255,0.88)',
        lineHeight: 22,
    },

    rowSent: {
        flexDirection:  'row',
        justifyContent: 'flex-end',
        marginVertical: 4,
    },
    userColumn: {
        alignItems: 'flex-end',
        maxWidth:   '80%',
        flexShrink: 1,
    },
    userBubble: {
        backgroundColor:         '#ffffff',
        borderRadius:            16,
        borderBottomRightRadius: 4,
        paddingVertical:         12,
        paddingHorizontal:       14,
    },
    userText: {
        fontFamily: 'poppins-regular',
        fontSize:   14,
        color:      '#0a0a0a',
        lineHeight: 22,
    },

    timeLabel: {
        fontFamily: 'poppins-regular',
        fontSize:   10,
        color:      'rgba(255,255,255,0.25)',
        marginTop:  4,
        marginLeft: 2,
    },

    typingBubble: {
        flexDirection:       'row',
        alignItems:          'center',
        gap:                 5,
        backgroundColor:     'rgba(255,255,255,0.05)',
        borderWidth:         1,
        borderColor:         'rgba(255,255,255,0.09)',
        borderRadius:        16,
        borderTopLeftRadius: 4,
        paddingVertical:     14,
        paddingHorizontal:   18,
    },
    typingDot: {
        width:           6,
        height:          6,
        borderRadius:    3,
        backgroundColor: 'rgba(255,255,255,0.7)',
    },

    // ── Action row above the welcome card (Save / New Chat) ─────────────
    actionRow: {
        flexDirection:     'row',
        gap:               8,
        paddingHorizontal: 16,
        paddingTop:        10,
        paddingBottom:     2,
        justifyContent:    'flex-end',
    },
    actionBtn: {
        flexDirection:     'row',
        alignItems:        'center',
        gap:               6,
        paddingVertical:   6,
        paddingHorizontal: 12,
        borderRadius:      999,
        backgroundColor:   'rgba(167,139,250,0.10)',
        borderWidth:       1,
        borderColor:       'rgba(167,139,250,0.25)',
    },
    actionBtnDisabled: { opacity: 0.4 },
    actionBtnText: {
        fontFamily: 'poppins-bold',
        fontSize:   11,
        color:      '#a78bfa',
        letterSpacing: 0.3,
    },

    // ── Save / share modal ──────────────────────────────────────────────
    modalOverlay: {
        flex:            1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        alignItems:      'center',
        justifyContent:  'center',
        padding:         16,
    },
    saveModal: {
        width:           '92%',
        backgroundColor: '#0f172a',
        borderWidth:     1,
        borderColor:     'rgba(167,139,250,0.25)',
        borderRadius:    16,
        padding:         18,
        gap:             14,
    },
    saveHeader: {
        flexDirection:  'row',
        alignItems:     'center',
        justifyContent: 'space-between',
    },
    saveTitle: {
        fontFamily:    'poppins-bold',
        fontSize:      14,
        color:         '#ffffff',
        letterSpacing: 0.3,
    },
    saveBody: {
        fontFamily: 'poppins-regular',
        fontSize:   12,
        color:      'rgba(255,255,255,0.65)',
        lineHeight: 17,
    },
    saveStats: {
        flexDirection: 'row',
        alignItems:    'center',
        gap:           6,
        paddingVertical:   6,
        paddingHorizontal: 10,
        borderRadius:      8,
        backgroundColor:   'rgba(167,139,250,0.08)',
        alignSelf:         'flex-start',
    },
    saveStatsText: {
        fontFamily: 'poppins-regular',
        fontSize:   11,
        color:      '#a78bfa',
    },
    attachRow: { gap: 8 },
    attachActions: { flexDirection: 'row', gap: 8 },
    attachBtn: {
        flex:              1,
        flexDirection:     'row',
        alignItems:        'center',
        justifyContent:    'center',
        gap:               6,
        paddingVertical:   10,
        borderRadius:      10,
        backgroundColor:   'rgba(255,255,255,0.04)',
        borderWidth:       1,
        borderColor:       'rgba(167,139,250,0.25)',
    },
    attachBtnText: {
        fontFamily: 'poppins-bold',
        fontSize:   12,
        color:      '#a78bfa',
    },
    attachedPhotoWrap: {
        flexDirection:     'row',
        alignItems:        'center',
        justifyContent:    'space-between',
        paddingVertical:   10,
        paddingHorizontal: 12,
        borderRadius:      10,
        backgroundColor:   'rgba(52,211,153,0.08)',
        borderWidth:       1,
        borderColor:       'rgba(52,211,153,0.25)',
    },
    attachedPhotoBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    attachedPhotoText: {
        fontFamily: 'poppins-bold',
        fontSize:   12,
        color:      '#34d399',
    },
    savedAtBanner: {
        flexDirection:     'row',
        alignItems:        'center',
        gap:               6,
        paddingVertical:   6,
        paddingHorizontal: 10,
        borderRadius:      8,
        backgroundColor:   'rgba(52,211,153,0.12)',
        borderWidth:       1,
        borderColor:       'rgba(52,211,153,0.25)',
    },
    savedAtText: {
        fontFamily: 'poppins-bold',
        fontSize:   11,
        color:      '#34d399',
    },
    saveActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    savePrimaryBtn: {
        flex:            2,
        flexDirection:   'row',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             8,
        backgroundColor: '#a78bfa',
        borderRadius:    12,
        paddingVertical: 14,
    },
    savePrimaryBtnText: {
        fontFamily:    'poppins-bold',
        fontSize:      14,
        color:         '#0f172a',
        letterSpacing: 0.3,
    },
    saveCancelBtn: {
        flex:            1,
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth:     1,
        borderColor:     'rgba(255,255,255,0.15)',
        borderRadius:    12,
        paddingVertical: 14,
    },
    saveCancelBtnText: {
        fontFamily: 'poppins-bold',
        fontSize:   13,
        color:      'rgba(255,255,255,0.75)',
    },
})
