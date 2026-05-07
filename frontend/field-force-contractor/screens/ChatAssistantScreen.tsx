// ChatAssistantScreen.tsx
// Field Force AI assistant. Stateless chat with Claude. The screen owns the
// conversation history and sends the whole array to /api/ai/chat each turn,
// so reloading the screen wipes the conversation (intentional for now).
// If we want persistence later we'll add an ai_chat_session table on the
// backend without changing this file's contract.

import { FC, useEffect, useRef, useState } from 'react'
import {
    Animated,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { MainFrame } from '@/components/MainFrame'
import { SearchBar } from '@/components/SearchBar'
import { InitID } from '@/utils/InitID'
import { TimeFormater } from '@/utils/timeFormater'
import { chat, ChatMessage as AIChatMessage, friendlyAIError } from '@/utils/aiClient'

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
                <Text style={s.aiText}>{text}</Text>
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
    const [bubbles, setBubbles]                = useState<Bubble[]>([])
    const [loading, setLoading]                = useState(false)
    const [suggestionsVisible, setSuggestions] = useState(true)
    const scrollRef                            = useRef<ScrollView>(null)

    const scroll = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80)

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

    const Footer: FC = () => (
        <SearchBar
            placeHolder="Ask the assistant..."
            buttonText="Send"
            onClick={(msg: string) => { if (msg) send(msg) }}
        />
    )

    return (
        <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <MainFrame headerMenu={['Menu2', ['Field Assistant']]} injectFooter={<Footer />}>
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
            </MainFrame>
        </KeyboardAvoidingView>
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
})
