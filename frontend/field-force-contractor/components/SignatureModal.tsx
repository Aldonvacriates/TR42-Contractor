// SignatureModal — full-screen capture for the contractor's "proof of work"
// signature. Built on react-native-signature-canvas (a thin WebView around
// signature_pad). Returns a base64-encoded PNG via onConfirm, or null via
// onCancel.
//
// Why a modal: the signature is only collected at Complete Task and never
// edited from the gallery. Keeping it modal avoids cluttering the existing
// TicketDetailScreen layout and lets the canvas use the full viewport on
// the small phones used in the field.
//
// Output format:
//   Whatever signature-canvas returns, which is the data URL form
//   "data:image/png;base64,iVBORw0KGgo..." — the consumer strips the
//   prefix and writes the base64 payload to a .png file.

import { useRef } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';

interface Props {
  visible: boolean;
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
  signerName?: string;
}

// signature-canvas exposes its own toolbar but ours doesn't match the dark
// theme, so suppress it with this CSS override and provide custom buttons
// in the modal chrome.
const WEBSTYLE = `
  body, html { background: #ffffff; }
  .m-signature-pad { box-shadow: none; border: none; }
  .m-signature-pad--body { border: none; }
  .m-signature-pad--footer { display: none; }
`;

export function SignatureModal({ visible, onConfirm, onCancel, signerName }: Props) {
  const ref = useRef<SignatureViewRef>(null);

  const handleSave = () => {
    ref.current?.readSignature();
  };

  const handleClear = () => {
    ref.current?.clearSignature();
  };

  // signature-canvas fires onOK with the data URL whenever readSignature()
  // is called and the pad is non-empty. onEmpty fires if the pad has no
  // strokes — we treat that as a no-op and prompt the user to draw first.
  const handleOK = (dataUrl: string) => {
    onConfirm(dataUrl);
  };

  const handleEmpty = () => {
    // No strokes — ignore. The Save button stays available so the user can
    // try again after drawing.
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} style={styles.headerBtn}>
            <Ionicons name="close" size={22} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.title}>Sign to complete</Text>
            {signerName ? <Text style={styles.subtitle}>{signerName}</Text> : null}
          </View>
          <View style={styles.headerBtn} />
        </View>

        <View style={styles.canvasWrap}>
          <SignatureScreen
            ref={ref}
            webStyle={WEBSTYLE}
            onOK={handleOK}
            onEmpty={handleEmpty}
            descriptionText=""
            penColor="#0f172a"
            backgroundColor="#ffffff"
            imageType="image/png"
          />
        </View>

        <View style={styles.footer}>
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={handleClear}>
            <Ionicons name="refresh" size={16} color="#0f172a" />
            <Text style={[styles.btnText, { color: '#0f172a' }]}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleSave}>
            <Ionicons name="checkmark" size={16} color="white" />
            <Text style={styles.btnText}>Save signature</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0e1a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: 'white', fontSize: 16, fontFamily: 'poppins-bold' },
  subtitle: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  canvasWrap: { flex: 1, backgroundColor: 'white', margin: 16, borderRadius: 12, overflow: 'hidden' },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
  },
  btnPrimary: { backgroundColor: '#2563eb' },
  btnGhost: { backgroundColor: '#e2e8f0' },
  btnText: { color: 'white', fontSize: 14, fontFamily: 'poppins-bold' },
});
