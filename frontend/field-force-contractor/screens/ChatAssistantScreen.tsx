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

const SUGGESTIONS = [
    { label: 'What PPE do I need for high-pressure lines?', icon: 'shield-checkmark-outline' },
    { label: "How do I document a near miss?",              icon: 'document-text-outline' },
    { label: 'OSHA confined space entry checklist',          icon: 'list-outline' },
    { label: "Explain my ticket's anomaly flag",             icon: 'help-circle-outline' },
]

const WELCOME_TEXT =
    "Hi! I'm your field assistant.\n\nAsk me about procedures, safety, OSHA references, or troubleshooting equipment. Tap a suggestion below to start."

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

                    {/* Suggestion chips */}
                    {suggestionsVisible && (
                        <View style={s.chips}>
                            {SUGGESTIONS.map(({ label, icon }) => (
                                <TouchableOpacity
                                    key={label}
                                    style={s.chip}
                                    onPress={() => send(label)}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name={icon as any} size={14} color="#a78bfa" />
                                    <Text style={s.chipText}>{label}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}

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
    },
    chipText: {
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
