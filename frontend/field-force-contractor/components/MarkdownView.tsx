// MarkdownView.tsx
//
// Themed wrapper around react-native-markdown-display so every surface
// rendering Field Assistant output (chat bubbles, saved transcripts,
// inspection report bodies) shares the same look and feel. Bold, italics,
// inline code, lists, headings, and links all render through this single
// component.

import { FC } from 'react'
import { Linking, StyleSheet } from 'react-native'
import Markdown from 'react-native-markdown-display'

interface Props {
  /** The raw markdown string emitted by the model. */
  children: string
  /** Override the body text colour. Defaults to a high-contrast off-white
   *  appropriate for the dark chat background. Pass a brighter colour for
   *  surfaces with a lighter background. */
  color?: string
}

export const MarkdownView: FC<Props> = ({ children, color }) => {
  const text = color ?? 'rgba(255,255,255,0.88)'
  const muted = color ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)'
  const accent = '#a78bfa'
  const border = 'rgba(255,255,255,0.12)'
  const codeBg = 'rgba(167,139,250,0.10)'

  // The markdown library expects a plain object (not a StyleSheet) so we
  // build it inline. Keep the style names matching its public API.
  const styles = {
    body:        { color: text, fontFamily: 'poppins-regular', fontSize: 14, lineHeight: 22 },
    paragraph:   { marginTop: 0, marginBottom: 8 },
    strong:      { fontFamily: 'poppins-bold', color: text },
    em:          { fontStyle: 'italic' as const },
    bullet_list: { marginTop: 4, marginBottom: 8 },
    ordered_list:{ marginTop: 4, marginBottom: 8 },
    list_item:   { marginBottom: 4, color: text, fontSize: 14, lineHeight: 22 },
    heading1:    { fontFamily: 'poppins-bold', color: text, fontSize: 18, marginTop: 6, marginBottom: 6 },
    heading2:    { fontFamily: 'poppins-bold', color: text, fontSize: 16, marginTop: 6, marginBottom: 4 },
    heading3:    { fontFamily: 'poppins-bold', color: text, fontSize: 14, marginTop: 4, marginBottom: 4 },
    code_inline: {
      fontFamily:        'poppins-regular',
      backgroundColor:   codeBg,
      color:             accent,
      paddingHorizontal: 4,
      paddingVertical:   1,
      borderRadius:      4,
      fontSize:          13,
    },
    code_block: {
      backgroundColor: codeBg,
      color:           text,
      padding:         10,
      borderRadius:    8,
      fontFamily:      'poppins-regular',
      fontSize:        12,
      borderWidth:     1,
      borderColor:     border,
      marginVertical:  6,
    },
    fence: {
      backgroundColor: codeBg,
      color:           text,
      padding:         10,
      borderRadius:    8,
      fontFamily:      'poppins-regular',
      fontSize:        12,
      borderWidth:     1,
      borderColor:     border,
      marginVertical:  6,
    },
    blockquote: {
      backgroundColor: 'rgba(167,139,250,0.05)',
      borderLeftColor: accent,
      borderLeftWidth: 3,
      paddingLeft:     10,
      paddingVertical: 4,
      marginVertical:  4,
    },
    link: { color: accent, textDecorationLine: 'underline' as const },
    hr:   { backgroundColor: border, height: 1, marginVertical: 8 },
    table:{ borderWidth: 1, borderColor: border, marginVertical: 6 },
    th:   { fontFamily: 'poppins-bold', padding: 6, color: text },
    td:   { padding: 6, color: text },
    bullet_list_icon: { color: accent, marginRight: 6 },
    ordered_list_icon: { color: accent, marginRight: 6 },
  }

  return (
    <Markdown
      style={styles}
      onLinkPress={(url) => { Linking.openURL(url).catch(() => {}); return true }}
      mergeStyle={true}
    >
      {children}
    </Markdown>
  )
}

// Suppresses unused-default-export warnings while keeping the named export
// as the canonical import path everywhere else.
const _hairline = StyleSheet.hairlineWidth
export default MarkdownView
export const __MARKDOWN_HAIRLINE = _hairline
