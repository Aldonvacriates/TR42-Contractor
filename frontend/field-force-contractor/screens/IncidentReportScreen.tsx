// IncidentReportScreen.tsx
//
// Standalone "Report a Safety Incident" flow that stitches together pieces
// the app already has:
//   - PhotoReviewScreen's analyze-photo pipeline (Gemini vision via
//     /api/ai/analyze-photo)
//   - ChatAssistantScreen's OSHA citation suggestions
//   - SavedReports persistence (POST /api/ai/save-report)
//   - pdfExport.exportReportPdf for an on-device share-sheet PDF
//
// Flow:
//   1. Pick an active ticket (auto-selects if only one IN_PROGRESS/ASSIGNED).
//      Incident must attach to a ticket because the photo upload endpoint
//      requires ticket_id.
//   2. Capture or pick a photo. Uploads via uploadPhotoOrEnqueue so the
//      offline outbox + retry works the same as a regular ticket photo.
//   3. Server-side analyze-photo runs Gemini against the uploaded photo
//      and returns severity, concerns, recommendations.
//   4. Suggested OSHA citations are inferred client-side from concern
//      keywords. The contractor can toggle which to include.
//   5. Notes (free text). On Save: POST to /api/ai/save-report so it
//      shows up alongside other saved reports. On Export: render PDF
//      via expo-print and open share sheet.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import { MainFrame, SubHeader } from '../components/MainFrame';
import {
  analyzePhoto,
  friendlyAIError,
  listAssignedTickets,
  saveReport,
  AssignedTicketSummary,
  InspectionReport,
  PhotoAnalysis,
} from '../utils/aiClient';
import { uploadPhotoOrEnqueue } from '../utils/photoOutbox';
import { exportReportPdf } from '../utils/pdfExport';

// ── OSHA citation suggestions ───────────────────────────────────────────────
// Hardcoded keyword -> citation map. Showcase-grade: covers the common
// hazards Gemini surfaces in the field (falls, spills, ladders, electrical,
// confined space, PPE). Each entry is { keywords, label } where any keyword
// match triggers the suggestion. Multiple matches collapse to a unique set.
interface OshaSuggestion { id: string; label: string; keywords: string[] }
const OSHA_LIBRARY: OshaSuggestion[] = [
  {
    id: 'osha-1926-501',
    label: '29 CFR 1926.501 — Fall protection (unguarded edges, openings, leading edges).',
    keywords: ['fall', 'edge', 'rooftop', 'open hole', 'unguarded', 'height'],
  },
  {
    id: 'osha-1910-23',
    label: '29 CFR 1910.23 — Ladders (damaged rails, broken rungs, improper use).',
    keywords: ['ladder', 'rung', 'rail'],
  },
  {
    id: 'osha-1910-132',
    label: '29 CFR 1910.132 — Personal protective equipment (PPE not in use or missing).',
    keywords: ['ppe', 'helmet', 'hard hat', 'glove', 'goggle', 'eye protection', 'boot'],
  },
  {
    id: 'osha-1910-146',
    label: '29 CFR 1910.146 — Permit-required confined spaces.',
    keywords: ['confined space', 'manhole', 'tank entry', 'vault'],
  },
  {
    id: 'osha-1910-147',
    label: '29 CFR 1910.147 — Lockout/tagout (energy isolation before service).',
    keywords: ['lockout', 'tagout', 'energy isolation', 'live equipment'],
  },
  {
    id: 'osha-1910-120',
    label: '29 CFR 1910.120 — Hazardous waste / spill response.',
    keywords: ['spill', 'leak', 'hazardous', 'chemical release', 'contamination'],
  },
  {
    id: 'osha-1910-1200',
    label: '29 CFR 1910.1200 — Hazard Communication / SDS requirements.',
    keywords: ['unlabeled', 'sds', 'safety data sheet', 'unknown chemical'],
  },
  {
    id: 'osha-1910-303',
    label: '29 CFR 1910.303 — Electrical safety, general requirements.',
    keywords: ['electrical', 'exposed wire', 'arc', 'shock', 'live circuit'],
  },
  {
    id: 'osha-1910-178',
    label: '29 CFR 1910.178 — Powered industrial trucks (forklift safety).',
    keywords: ['forklift', 'industrial truck', 'pallet jack'],
  },
];

function suggestCitations(analysis: PhotoAnalysis | null): OshaSuggestion[] {
  if (!analysis) return [];
  const haystack = [
    analysis.summary,
    ...(analysis.concerns ?? []),
    ...(analysis.recommendations ?? []),
  ].join(' ').toLowerCase();
  const hits = OSHA_LIBRARY.filter(s => s.keywords.some(k => haystack.includes(k)));
  // Cap at 4 to keep the UI tight; if zero, fall back to the top three
  // generic citations so the report is never empty for the demo.
  if (hits.length === 0) return OSHA_LIBRARY.slice(0, 3);
  return hits.slice(0, 4);
}

function severityToPriority(s: PhotoAnalysis['severity']): 'low' | 'medium' | 'high' {
  if (s === 'high')   return 'high';
  if (s === 'medium') return 'medium';
  return 'low';
}

function severityColor(s: PhotoAnalysis['severity']) {
  switch (s) {
    case 'high':   return { fg: '#ef4444', bg: 'rgba(239,68,68,0.12)' };
    case 'medium': return { fg: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
    case 'low':    return { fg: '#facc15', bg: 'rgba(250,204,21,0.12)' };
    case 'none':
    default:       return { fg: '#34d399', bg: 'rgba(52,211,153,0.12)' };
  }
}

export default function IncidentReportScreen() {
  const navigation = useNavigation<any>();

  // Ticket selection
  const [tickets, setTickets] = useState<AssignedTicketSummary[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  // Photo + analysis
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Citations + notes
  const [selectedCitations, setSelectedCitations] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');

  // Save / export state
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    setTicketsLoading(true);
    try {
      const rows = await listAssignedTickets();
      // Only show tickets the contractor is actively working: in_progress
      // or assigned. Completed/approved tickets aren't a sensible attachment
      // point for a new incident.
      const active = (rows ?? []).filter(t => {
        const s = (t.status || '').toUpperCase();
        return s === 'IN_PROGRESS' || s === 'ASSIGNED';
      });
      setTickets(active);
      if (active.length === 1) setSelectedTicketId(active[0].id);
    } catch {
      // Non-blocking: fetch error renders an inline message in the picker.
    } finally {
      setTicketsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    fetchTickets().catch(() => {});
  }, [fetchTickets]));

  // Auto-suggest OSHA citations once the analysis comes back.
  useEffect(() => {
    if (!analysis) return;
    const suggested = suggestCitations(analysis);
    setSelectedCitations(new Set(suggested.map(s => s.id)));
  }, [analysis]);

  // ── Photo capture + analyze ────────────────────────────────────────────────

  const ensureCameraPermission = async (): Promise<boolean> => {
    const cur = await ImagePicker.getCameraPermissionsAsync();
    if (cur.granted) return true;
    const next = await ImagePicker.requestCameraPermissionsAsync();
    if (!next.granted) {
      Alert.alert('Camera permission needed', 'Allow camera access to capture an incident photo.');
      return false;
    }
    return true;
  };

  const ensureLibraryPermission = async (): Promise<boolean> => {
    const cur = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (cur.granted) return true;
    const next = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!next.granted) {
      Alert.alert('Photo library access needed', 'Allow photo library access to attach an incident photo.');
      return false;
    }
    return true;
  };

  const handleCapture = async (source: 'camera' | 'library') => {
    if (!selectedTicketId) {
      Alert.alert('Pick a ticket first', 'An incident report must attach to one of your active tickets.');
      return;
    }
    const ok = source === 'camera' ? await ensureCameraPermission() : await ensureLibraryPermission();
    if (!ok) return;

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });

    if (result.canceled) return;
    const uri = result.assets?.[0]?.uri;
    if (!uri) return;

    // Reset previous analysis so the contractor isn't looking at stale results.
    setPhotoUri(uri);
    setPhotoId(null);
    setAnalysis(null);
    setAnalysisError(null);
    setSelectedCitations(new Set());

    // Tag a best-effort GPS fix so the photo carries the same metadata as
    // a regular ticket photo. Permission may have been denied earlier; in
    // that case we just upload without coords.
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted) {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;
      }
    } catch { /* non-blocking */ }

    setUploading(true);
    try {
      const upload = await uploadPhotoOrEnqueue({
        ticketId:  selectedTicketId,
        fileUri:   uri,
        latitude:  lat,
        longitude: lng,
      });
      setUploading(false);

      if (upload.status !== 'sent') {
        // Queued offline: we can't analyze without a server photoId. The
        // outbox will drain on reconnect; the contractor can analyze later.
        Alert.alert(
          'Saved offline',
          "You're offline, so the photo will upload when you reconnect. AI analysis runs after upload.",
        );
        return;
      }

      setPhotoId(upload.photoId);
      setAnalyzing(true);
      try {
        const result = await analyzePhoto(upload.photoId);
        setAnalysis(result);
      } catch (e: any) {
        setAnalysisError(friendlyAIError(e));
      } finally {
        setAnalyzing(false);
      }
    } catch (e: any) {
      setUploading(false);
      Alert.alert('Upload failed', e?.message ?? 'Could not upload photo.');
    }
  };

  // ── Save / Export ──────────────────────────────────────────────────────────

  const buildReport = (): InspectionReport => {
    const cite = OSHA_LIBRARY.filter(s => selectedCitations.has(s.id));
    const description = [
      analysis ? `**Summary**\n${analysis.summary}` : '',
      analysis?.concerns?.length
        ? `**Observed concerns**\n${analysis.concerns.map(c => `- ${c}`).join('\n')}`
        : '',
      cite.length
        ? `**Applicable OSHA citations**\n${cite.map(c => `- ${c.label}`).join('\n')}`
        : '',
      notes.trim() ? `**Contractor notes**\n${notes.trim()}` : '',
    ].filter(Boolean).join('\n\n');

    return {
      title: analysis?.summary
        ? `Incident: ${analysis.summary.slice(0, 60)}${analysis.summary.length > 60 ? '...' : ''}`
        : 'Safety incident report',
      priority: severityToPriority(analysis?.severity ?? 'low'),
      category: 'Safety incident',
      description,
      recommended_actions: analysis?.recommendations ?? [],
    };
  };

  const handleSave = async () => {
    if (!analysis) {
      Alert.alert('Nothing to save', 'Capture a photo and let the AI analyze it first.');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveReport(buildReport(), notes.trim() || null);
      setSavedId(saved.id);
      Alert.alert('Saved', 'Incident report stored under Saved Reports.');
    } catch (e: any) {
      Alert.alert('Save failed', friendlyAIError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!analysis) {
      Alert.alert('Nothing to export', 'Capture a photo and let the AI analyze it first.');
      return;
    }
    try {
      await exportReportPdf({ ...buildReport(), raw_notes: notes.trim() || null });
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Could not export PDF.');
    }
  };

  const handleViewSaved = () => {
    navigation.navigate('SavedReports' as never);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const sevColor = severityColor(analysis?.severity ?? 'none');
  const allSuggestions = analysis ? suggestCitations(analysis) : [];

  return (
    <MainFrame header="home">
      <View style={{ alignSelf: 'stretch' }}>
        <SubHeader title="Report incident" />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Step 1: Ticket picker */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Active ticket</Text>
          {ticketsLoading ? (
            <ActivityIndicator size="small" color="#9ca3af" />
          ) : tickets.length === 0 ? (
            <Text style={styles.muted}>No active tickets. Start a ticket to attach an incident.</Text>
          ) : (
            tickets.map(t => {
              const selected = t.id === selectedTicketId;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.ticketRow, selected && styles.ticketRowActive]}
                  onPress={() => setSelectedTicketId(t.id)}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={selected ? '#3b82f6' : '#94a3b8'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ticketTitle} numberOfLines={2}>{t.description || 'Ticket'}</Text>
                    <Text style={styles.ticketMeta}>{t.status} · {t.priority}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Step 2: Photo */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. Photo evidence</Text>
          {photoUri ? (
            <View style={styles.photoCard}>
              <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
              {(uploading || analyzing) && (
                <View style={styles.photoOverlay}>
                  <ActivityIndicator size="small" color="white" />
                  <Text style={styles.photoOverlayText}>
                    {uploading ? 'Uploading...' : 'Analyzing...'}
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          <View style={styles.photoBtnRow}>
            <TouchableOpacity
              style={[styles.photoBtn, !selectedTicketId && styles.photoBtnDisabled]}
              onPress={() => handleCapture('camera')}
              disabled={!selectedTicketId || uploading || analyzing}
            >
              <Ionicons name="camera" size={16} color="white" />
              <Text style={styles.photoBtnText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.photoBtn, styles.photoBtnGhost, !selectedTicketId && styles.photoBtnDisabled]}
              onPress={() => handleCapture('library')}
              disabled={!selectedTicketId || uploading || analyzing}
            >
              <Ionicons name="image" size={16} color="#0f172a" />
              <Text style={[styles.photoBtnText, { color: '#0f172a' }]}>Library</Text>
            </TouchableOpacity>
          </View>

          {analysisError && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={14} color="#fca5a5" />
              <Text style={styles.errorText}>{analysisError}</Text>
            </View>
          )}
        </View>

        {/* Step 3: AI summary */}
        {analysis && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>3. AI assessment</Text>
            <View style={[styles.severityPill, { backgroundColor: sevColor.bg }]}>
              <Text style={[styles.severityText, { color: sevColor.fg }]}>
                {analysis.severity.toUpperCase()} severity
              </Text>
            </View>
            <Text style={styles.summary}>{analysis.summary}</Text>
            {analysis.concerns?.length > 0 && (
              <>
                <Text style={styles.subLabel}>Concerns</Text>
                {analysis.concerns.map((c, i) => (
                  <Text key={i} style={styles.bullet}>• {c}</Text>
                ))}
              </>
            )}
            {analysis.recommendations?.length > 0 && (
              <>
                <Text style={styles.subLabel}>Recommended actions</Text>
                {analysis.recommendations.map((r, i) => (
                  <Text key={i} style={styles.bullet}>• {r}</Text>
                ))}
              </>
            )}
          </View>
        )}

        {/* Step 4: OSHA citations */}
        {analysis && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>4. OSHA citations</Text>
            <Text style={styles.muted}>
              Suggestions inferred from the AI assessment. Toggle to include in the report.
            </Text>
            {allSuggestions.map(s => {
              const on = selectedCitations.has(s.id);
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.citation, on && styles.citationOn]}
                  onPress={() => {
                    setSelectedCitations(prev => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                      return next;
                    });
                  }}
                >
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={on ? '#3b82f6' : '#94a3b8'}
                  />
                  <Text style={[styles.citationText, on && { color: 'white' }]} numberOfLines={3}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Step 5: Notes */}
        {analysis && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>5. Contractor notes</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="What happened? Mitigations taken on site, witnesses, etc."
              placeholderTextColor="rgba(255,255,255,0.4)"
              multiline
              value={notes}
              onChangeText={setNotes}
            />
          </View>
        )}

        {/* Actions */}
        {analysis && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionPrimary]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="white" />
                : <Ionicons name="save" size={16} color="white" />}
              <Text style={styles.actionText}>{savedId ? 'Saved' : 'Save report'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionGhost]}
              onPress={handleExport}
            >
              <Ionicons name="document-text" size={16} color="#0f172a" />
              <Text style={[styles.actionText, { color: '#0f172a' }]}>Export PDF</Text>
            </TouchableOpacity>
          </View>
        )}

        {savedId && (
          <TouchableOpacity style={styles.viewSavedLink} onPress={handleViewSaved}>
            <Ionicons name="folder-open" size={14} color="#93c5fd" />
            <Text style={styles.viewSavedText}>View in Saved Reports</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </MainFrame>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const CARD_BG = 'rgba(255,255,255,0.08)';
const BORDER  = 'rgba(255,255,255,0.15)';

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40, alignSelf: 'stretch' },

  section: { marginBottom: 18 },
  sectionTitle: { color: 'white', fontSize: 14, fontFamily: 'poppins-bold', marginBottom: 8 },
  muted: { color: '#9ca3af', fontSize: 12, marginBottom: 8 },

  // Ticket picker
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  ticketRowActive: { borderColor: 'rgba(59,130,246,0.6)', backgroundColor: 'rgba(59,130,246,0.08)' },
  ticketTitle: { color: 'white', fontSize: 13, fontFamily: 'poppins-bold' },
  ticketMeta: { color: '#9ca3af', fontSize: 11, marginTop: 2 },

  // Photo
  photoCard: { borderRadius: 12, overflow: 'hidden', marginBottom: 10, position: 'relative' },
  photo: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#1f2937' },
  photoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoOverlayText: { color: 'white', fontSize: 12 },

  photoBtnRow: { flexDirection: 'row', gap: 10 },
  photoBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#2563eb',
  },
  photoBtnGhost:    { backgroundColor: '#e2e8f0' },
  photoBtnDisabled: { opacity: 0.5 },
  photoBtnText:     { color: 'white', fontSize: 13, fontFamily: 'poppins-bold' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(127,29,29,0.4)',
  },
  errorText: { color: '#fecaca', fontSize: 12, flex: 1 },

  // AI assessment
  severityPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginBottom: 8 },
  severityText: { fontSize: 11, fontFamily: 'poppins-bold', letterSpacing: 0.5 },
  summary:  { color: 'white', fontSize: 13, lineHeight: 19, marginBottom: 8 },
  subLabel: { color: '#9ca3af', fontSize: 11, fontFamily: 'poppins-bold', marginTop: 8, marginBottom: 4 },
  bullet:   { color: '#e5e7eb', fontSize: 12, lineHeight: 18, marginLeft: 6 },

  // OSHA citations
  citation: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 8,
  },
  citationOn:   { borderColor: 'rgba(59,130,246,0.6)', backgroundColor: 'rgba(59,130,246,0.10)' },
  citationText: { color: '#cbd5e1', fontSize: 12, flex: 1, lineHeight: 17 },

  // Notes
  notesInput: {
    minHeight: 100,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 12,
    color: 'white',
    fontSize: 13,
    textAlignVertical: 'top',
  },

  // Actions
  actionRow:    { flexDirection: 'row', gap: 10, marginTop: 8 },
  actionBtn:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 10 },
  actionPrimary:{ backgroundColor: '#2563eb' },
  actionGhost:  { backgroundColor: '#e2e8f0' },
  actionText:   { color: 'white', fontSize: 13, fontFamily: 'poppins-bold' },

  viewSavedLink: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 12, paddingVertical: 8 },
  viewSavedText: { color: '#93c5fd', fontSize: 12 },
});
