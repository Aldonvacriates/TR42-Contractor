import { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Modal, Alert, ActivityIndicator, Linking, Image } from 'react-native';
import { uploadPhotoOrEnqueue } from '../utils/photoOutbox';
import { useNetwork } from '../contexts/NetworkContext';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MainFrame } from '../components/MainFrame';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_BIOMETRIC_KEY } from './ProfileScreen';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { verifyOfflinePin } from '../utils/secureStorage';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { api } from '../utils/api';

function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const acceptLocationKey = (id: number) => `accept_location_${id}`;
const notesKey = (id: number) => `notes_${id}`;

export default function TicketDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { taskId, assigned } = route.params;

  const [taskStatus, setTaskStatus] = useState<'to_do' | 'in_progress' | 'completed'>('to_do');
  const [notes, setNotes] = useState('');
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [verificationStep, setVerificationStep] = useState<'initial' | 'biometric' | 'pin' | 'location' | 'success' | 'error'>('initial');
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [selectedMethod, setSelectedMethod] = useState<'face' | 'fingerprint'>('fingerprint');
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [inspectionDone, setInspectionDone] = useState(false);
  // Real backend ticket data, fetched on mount. Falls back to the
  // hardcoded placeholder below when null (still loading or fetch failed).
  const [ticketData, setTicketData] = useState<any | null>(null);
  const pinRefs = useRef<(TextInput | null)[]>([null, null, null, null, null, null]);

  // ── Load saved biometric preference ────────────────────────────────────────
  // Reads the preference the user set in ProfileScreen → Settings so the
  // correct method is pre-selected when the verification modal opens.
  useEffect(() => {
    const loadPreference = async () => {
      try {
        const saved = await AsyncStorage.getItem(SETTINGS_BIOMETRIC_KEY);
        if (saved === 'face' || saved === 'fingerprint') {
          setSelectedMethod(saved);
        }
        const savedNotes = await AsyncStorage.getItem(notesKey(taskId));
        if (savedNotes) setNotes(savedNotes);
      } catch {
        // Fall back to fingerprint default if read fails
      }
    };
    loadPreference();
  }, []);

  // ── Fetch real ticket data ─────────────────────────────────────────────────
  // The backend doesn't currently expose GET /tickets/<id>, so we pull the
  // contractor's full assigned-tickets list and find ours by id. Cheap
  // enough for a 3-ticket demo, would need a dedicated endpoint at scale.
  useEffect(() => {
    let cancelled = false;
    api.authGet<any[]>('/contractors/assigned-tickets')
      .then(rows => {
        if (cancelled) return;
        const t = (rows ?? []).find((r: any) => r.id === String(taskId));
        if (t) {
          setTicketData(t);
          // Reflect the server-side status into the local UI state so the
          // primary-action button shows Start vs Complete correctly when
          // the user reopens a ticket they already started.
          const s = (t.status || '').toUpperCase();
          if (s === 'IN_PROGRESS')          setTaskStatus('in_progress');
          else if (s === 'PENDING_APPROVAL' || s === 'COMPLETED' || s === 'APPROVED') setTaskStatus('completed');
          else                              setTaskStatus('to_do');
          if (t.notes && !notes)            setNotes(t.notes);
        }
      })
      .catch(() => { /* keep placeholder data on fetch failure */ });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);


  // Auto-close modal after success + persist start to backend
  useEffect(() => {
    if (verificationStep !== 'success') return;

    // Fire-and-forget the real status change to the backend. The schema
    // requires start_time + lat/lng when transitioning to IN_PROGRESS, so
    // we read the location captured during the verification step. UI
    // continues regardless of the API result so a transient network blip
    // doesn't strand the contractor on the success screen.
    (async () => {
      try {
        const acceptRaw = await AsyncStorage.getItem(acceptLocationKey(taskId));
        const accept    = acceptRaw ? JSON.parse(acceptRaw) : null;
        const lat       = accept?.coords?.latitude;
        const lng       = accept?.coords?.longitude;
        if (lat == null || lng == null) return;

        await api.authPut(`/tickets/${taskId}`, {
          status:                       'IN_PROGRESS',
          start_time:                   new Date().toISOString(),
          contractor_start_latitude:    lat,
          contractor_start_longitude:   lng,
        });
      } catch {
        // Non-blocking: backend may already have started this ticket on a
        // previous attempt, or the network is flaky. Either way, the UI
        // moves on; the next page reload will reflect server state.
      }
    })();

    const t = setTimeout(() => {
      setShowVerificationModal(false);
      setTaskStatus('in_progress');
      setScanState('idle');
      setPin(['', '', '', '', '', '']);
    }, 2000);
    return () => clearTimeout(t);
  }, [verificationStep]);

  useEffect(() => {
    if (verificationStep !== 'location') return;
    (async () => {
      try {
        const DEV_SKIP_LOCATION = false; 

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setErrorMessage('Location permission is required to start a task.');
          setVerificationStep('error');
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

        if (!DEV_SKIP_LOCATION) {
          const distance = getDistanceMeters(
            loc.coords.latitude,
            loc.coords.longitude,
            task.locationCoords.lat,
            task.locationCoords.lng
          );
          // Cory's stakeholder ask (3/24): "within 100 ft he wants bio
          // authentication when arriving and leaving. He likes the
          // simplicity of it." Tightening the start-task proximity check to
          // 100ft as a first step. Full geofence-triggered biometric
          // (fires automatically on arrival / leaving) is roadmapped for v2.
          const METERS_PER_FOOT  = 0.3048;
          const THRESHOLD_FEET   = 100;
          const THRESHOLD_METERS = THRESHOLD_FEET * METERS_PER_FOOT; // ~30.5m
          if (distance > THRESHOLD_METERS) {
            const feetAway = Math.round(distance / METERS_PER_FOOT);
            setErrorMessage(
              `You must be within ${THRESHOLD_FEET} feet of the site. You are currently ${feetAway} feet away.`
            );
            setVerificationStep('error');
            return;
          }
        }

        setVerificationStep('success');
      } catch {
        setErrorMessage('Could not verify your location. Please try again.');
        setVerificationStep('error');
      }
    })();
  }, [verificationStep]);

  useEffect(() => {
    if (route.params?.inspectionDone) setInspectionDone(true);
  }, [route.params?.inspectionDone]);


  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    if (event.results[0]?.transcript) {
      setNotes(prev => (prev ? prev + ' ' : '') + event.results[0].transcript);
    }
  });
  useSpeechRecognitionEvent('error', (event) => {
    console.warn('Speech error:', event.error, event.message);
    setListening(false);
  });

  // Build the displayed task object from real backend data when available,
  // falling back to the demo placeholders for fields the ticket schema
  // doesn't currently surface (point of contact, work order location).
  // Once /tickets/<id> exposes a JOIN with work_order, locationCoords and
  // location can come from there too.
  const fmtDeadline = (iso: string | null | undefined) => {
    if (!iso) return 'No deadline set';
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
    } catch { return iso ?? 'No deadline set'; }
  };
  const titleFromTicket = (t: any) => {
    const desc = (t?.description || '').trim();
    if (t?.service_type) return t.service_type;
    if (desc) return desc.length > 60 ? `${desc.slice(0, 60)}...` : desc;
    return `Ticket ${String(t?.id ?? '').slice(0, 8)}`;
  };
  const task = {
    id:          ticketData?.id ?? taskId,
    title:       ticketData ? titleFromTicket(ticketData) : 'Loading task...',
    deadline:    ticketData ? fmtDeadline(ticketData.due_date) : '',
    // Backend schema doesn't currently surface a human-readable address.
    // The `route` field on the ticket is a free-text description used by
    // the dispatcher; we show it in the location slot for now and fall
    // back to a placeholder if absent. work_order.location would be the
    // proper source once the schema is extended.
    location:        ticketData?.route || '1234 Main Street, San Francisco, CA 94102',
    locationCoords:  { lat: 37.7749, lng: -122.4194 },
    inspectionRequired: false,
    description:     ticketData?.description || 'Loading task description...',
    // pointOfContact is not yet a backend field on `ticket`. Placeholder
    // keeps the UI populated; a future ticket↔auth_user POC join will
    // replace this.
    pointOfContact:  { name: 'John Martinez', phone: '+1 (555) 012-3456' },
    photosRequired:  1,
    photosMax:       5,
    photosSubmitted: photoUris.length,
    priority:        (ticketData?.priority || '').toUpperCase(),
    serverStatus:    (ticketData?.status || '').toUpperCase(),
  };

  // ── TODO: Real data integration ─────────────────────────────────────────────
  //  delete placeholder above and use this:
  //
  // 1. Add near other useState declarations:
  //   const [taskData, setTaskData] = useState<any | null>(null);
  //
  // 2. Add after existing useEffects:
  //   useEffect(() => {
  //     api.get(`/tickets/${taskId}`).then(data => {
  //       setTaskData(data);
  //       setTaskStatus(data.status);   // backend values: 'to_do' | 'in_progress' | 'completed'
  //       setNotes(data.notes ?? '');
  //     });
  //   }, [taskId]);
  //
  // 3. Replace placeholder task object with:
  //   const task = {
  //     id:            taskData.id,
  //     title:         taskData.service_type ?? taskData.description.slice(0, 60),
  //     deadline:      taskData.due_date,
  //     location:      taskData.route,
  //     description:   taskData.description,
  //     pointOfContact: { name: taskData.poc_name, phone: taskData.poc_phone },  // confirm field names with backend team — no poc field exists yet
  //     photosRequired: 1,             // frontend-only — no backend field
  //     photosMax:      5,             // frontend-only — no backend field
  //     photosSubmitted: photoUris.length,
  //   };
  // ─────────────────────────────────────────────────────────────────────────────

  const toggleListening = async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission Required', 'Microphone and speech recognition access is needed.');
      return;
    }
    ExpoSpeechRecognitionModule.start({ lang: 'en-US', continuous: false });
  };

  const handleOpenMaps = () => {
    const encoded = encodeURIComponent(task.location);
    const url = `https://maps.google.com/?q=${encoded}`;
    Linking.openURL(url);
  };

  const handlePinInput = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newPin = [...pin];
    newPin[index] = value.slice(-1);
    setPin(newPin);
    if (value && index < 5) {
      pinRefs.current[index + 1]?.focus();
    }
  };

  const handlePinKeyDown = (index: number, key: string) => {
    if (key === 'Backspace' && !pin[index] && index > 0) {
      pinRefs.current[index - 1]?.focus();
    }
  };

  const handleStartTask = () => {
    // Reset everything so a previous failed attempt doesn't leak state into
    // this fresh verification flow.
    setShowVerificationModal(true);
    setVerificationStep('initial');
    setErrorMessage('');
    setScanState('idle');
    setPin(['', '', '', '', '', '']);
  };

  // Shared post-pick logic: append to photo state and capture a geotag
  // alongside the URI so the upload can include lat/lng even after a long
  // offline window.
  const recordPhoto = async (uri: string) => {
    setPhotoUris(prev => [...prev, uri]);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const geoTag = { lat: loc.coords.latitude, lng: loc.coords.longitude, timestamp: loc.timestamp, uri };
      const existing = await AsyncStorage.getItem(`photo_log_${task.id}`) ?? '[]';
      const log = JSON.parse(existing);
      log.push(geoTag);
      await AsyncStorage.setItem(`photo_log_${task.id}`, JSON.stringify(log));
    } catch {
      // Non-blocking — don't prevent photo if GPS fails
    }
  };

  const handleTakePhoto = async () => {
    if (photoUris.length >= task.photosMax) return;
    try {
      // Explicitly request camera permission before launching. Without this
      // the picker silently fails on iOS / Android when the OS-level
      // permission is denied — which made the button feel like a no-op.
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Camera permission needed',
          'Field Force needs camera access to capture job site photos. Enable it in Settings.',
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality:    0.7,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        await recordPhoto(result.assets[0].uri);
      }
    } catch (err: any) {
      Alert.alert('Camera error', err?.message ?? 'Could not open the camera.');
    }
  };

  const handleUploadPhoto = async () => {
    if (photoUris.length >= task.photosMax) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photo library permission needed',
          'Field Force needs photo library access to attach existing photos. Enable it in Settings.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality:    0.7,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        await recordPhoto(result.assets[0].uri);
      }
    } catch (err: any) {
      Alert.alert('Photo library error', err?.message ?? 'Could not open the photo library.');
    }
  };

  const uploadPhotos = async (
    ticketId: string | number,
    uris: string[],
  ): Promise<{ sent: number; queued: number }> => {
    if (uris.length === 0) return { sent: 0, queued: 0 };
    let sent = 0, queued = 0;
    for (const uri of uris) {
      // Pull the geotag we captured at photo-pick time so the upload can
      // include lat/lng even after a long offline window.
      let lat: number | null = null, lng: number | null = null;
      try {
        const log = JSON.parse(await AsyncStorage.getItem(`photo_log_${task.id}`) ?? '[]');
        const entry = log.find((g: { uri: string }) => g.uri === uri);
        if (entry) { lat = entry.lat ?? null; lng = entry.lng ?? null; }
      } catch { /* fall through with null lat/lng */ }

      const result = await uploadPhotoOrEnqueue({
        ticketId,
        fileUri: uri,
        latitude:  lat,
        longitude: lng,
      });
      if (result.status === 'sent') sent += 1; else queued += 1;
    }
    return { sent, queued };
  };

  const handleCompleteTask = async () => {
    try {
      const savedAccept = await AsyncStorage.getItem(`accept_location_${taskId}`);
      const acceptLoc = savedAccept ? JSON.parse(savedAccept) : null;

      let endCoords = null;
      try {
        const endLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        endCoords = endLoc.coords;
      } catch {
        // Non-blocking — submit without end location if GPS fails
      }

      // Backend schema: status enum is uppercase, lat/lng are separate
      // numeric fields. The route requires end_time + end lat/lng when
      // transitioning to PENDING_APPROVAL. start_time + start lat/lng
      // were already persisted on Start Task; no need to resend.
      const payload: Record<string, unknown> = {
        status:    'PENDING_APPROVAL',
        notes,
        end_time:  new Date().toISOString(),
      };
      if (endCoords) {
        payload.contractor_end_latitude  = endCoords.latitude;
        payload.contractor_end_longitude = endCoords.longitude;
      }
      await api.authPut(`/tickets/${taskId}`, payload);

      await AsyncStorage.removeItem(notesKey(taskId));
      await AsyncStorage.removeItem(acceptLocationKey(taskId));
    } catch {
      // TODO: queue for offline retry when sync manager is built
    }

    if (photoUris.length > 0) {
      const { sent, queued } = await uploadPhotos(task.id, photoUris);
      if (queued > 0) {
        Alert.alert(
          'Photos queued',
          `${sent} uploaded, ${queued} saved offline. They'll send automatically when you're back online.`,
        );
      }
    }

    // No dedicated TaskConfirmation screen exists in the navigator yet, so
    // bounce the user back to the Tickets list. The list re-fetches on focus
    // and the just-completed ticket will surface in the Pending Approval
    // group.
    Alert.alert(
      'Submitted for approval',
      'Your task has been sent to your supervisor for review.',
      [{ text: 'OK', onPress: () => navigation.navigate('Tickets' as never) }],
    );
  };

  const handleRemovePhoto = (index: number) => {
    setPhotoUris(prev => prev.filter((_, i) => i !== index));
  };

  const closeModal = () => {
    setShowVerificationModal(false);
    setVerificationStep('initial');
    setPin(['', '', '', '', '', '']);
    setErrorMessage('');
    setScanState('idle');
  };

  // Helper that switches the verification modal to the error step with a
  // specific message. Centralised so we always set the message BEFORE the
  // step (avoiding a render frame where the error UI shows but the message
  // hasn't landed yet).
  const showVerificationError = (message: string) => {
    setErrorMessage(message);
    setScanState('idle');
    setVerificationStep('error');
  };

  const handleBiometricAuth = async () => {
    if (scanState === 'scanning') return;
    setScanState('scanning');

    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled    = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware) {
        showVerificationError('This device has no biometric hardware. Please use PIN.');
        return;
      }
      if (!enrolled) {
        showVerificationError('No fingerprint or face is enrolled on this device. Please use PIN.');
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage:         'Verify identity to start task',
        cancelLabel:           'Cancel',
        disableDeviceFallback: false,
      });

      if (result.success) {
        setScanState('idle');
        setVerificationStep('location');
        return;
      }

      // expo-local-authentication returns an error code we can use to give
      // the user a more specific reason for the failure.
      const code = (result as any)?.error as string | undefined;
      if (code === 'user_cancel' || code === 'app_cancel' || code === 'system_cancel') {
        showVerificationError('Scan cancelled. Try again or use PIN.');
      } else if (code === 'lockout' || code === 'lockout_permanent') {
        showVerificationError('Too many failed attempts. Use your PIN to continue.');
      } else if (code === 'not_enrolled') {
        showVerificationError('No fingerprint or face is enrolled on this device. Please use PIN.');
      } else {
        showVerificationError('Biometric scan failed. Try again or use PIN.');
      }
    } catch (err: any) {
      showVerificationError(err?.message ?? 'Biometric scan failed. Try again or use PIN.');
    }
  };

  const handlePinAuth = async () => {
    const pinString = pin.join('');
    if (pinString.length !== 6) {
      setErrorMessage('Please enter a complete 6-digit PIN');
      return;
    }
    // Source of truth lives in secureStorage.verifyOfflinePin so the
    // OfflineLogin screen and this in-task verification stay in sync.
    const ok = await verifyOfflinePin(pinString);
    if (!ok) {
      setVerificationStep('error');
      setErrorMessage('Invalid PIN. Please try again.');
      setPin(['', '', '', '', '', '']);
      return;
    }
    setErrorMessage('');
    setVerificationStep('location');
  };

  const handleAcceptTask = async () => {
    if (task.inspectionRequired && !inspectionDone) {
      navigation.navigate('Inspection' as never, { bypassGate: true, taskId } as never);
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await AsyncStorage.setItem(acceptLocationKey(taskId),
          JSON.stringify({ coords: loc.coords, timestamp: loc.timestamp })
        );
      }
    } catch {
      // Non-blocking — proceed with accept even if GPS fails
    }
    // TODO: API call to accept task
    navigation.goBack();
  };

  const handleDeclineTask = () => {
    // TODO: API call to decline task
    navigation.goBack();
  };

  return (
    <MainFrame header='home'>

      {/* ── Task Title + Status ── */}
      <View style={styles.section}>
        <Text style={styles.taskTitle}>{task.title}</Text>
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, {
            backgroundColor:
              taskStatus === 'to_do' ? '#6b7280' :
              taskStatus === 'in_progress' ? '#f97316' : '#22c55e'
          }]} />
          <Text style={styles.statusText}>
            {taskStatus === 'to_do' ? 'Not Started' :
             taskStatus === 'in_progress' ? 'In Progress' : 'Ready to Submit'}
          </Text>
        </View>
      </View>

      {/* ── Accept and Decline Buttons ── */}
      {!assigned && (
        <View style={styles.assignRow}>
          <TouchableOpacity style={styles.acceptBtn} onPress={handleAcceptTask}>
            <Ionicons name="checkmark" size={12} color="white" />
            <Text style={styles.btnText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.declineBtn} onPress={handleDeclineTask}>
            <Ionicons name="close" size={12} color="white" />
            <Text style={styles.btnText}>Decline</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Location ── */}
      <TouchableOpacity style={styles.infoCard} onPress={handleOpenMaps}>
        <View style={styles.infoIcon}>
          <Ionicons name="location" size={18} color="#ff8c00" />
        </View>
        <View style={styles.infoText}>
          <Text style={styles.infoLabel}>Location</Text>
          <Text style={styles.infoValue}>{task.location}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
      </TouchableOpacity>

      {/* ── Deadline ── */}
      <View style={styles.infoCard}>
        <View style={styles.infoIconAlt}>
          <Ionicons name="time" size={18} color="#f59e0b" />
        </View>
        <View style={styles.infoText}>
          <Text style={styles.infoLabel}>Deadline</Text>
          <Text style={styles.infoValue}>{task.deadline}</Text>
        </View>
      </View>

      {/* ── Point of Contact ── */}
      <TouchableOpacity style={styles.infoCard} onPress={() => navigation.navigate('Contacts')}>
        <View style={styles.infoIcon}>
          <Ionicons name="person" size={18} color="#ff8c00" />
        </View>
        <View style={styles.infoText}>
          <Text style={styles.infoLabel}>Point of Contact</Text>
          <Text style={styles.infoValue}>{task.pointOfContact.name}</Text>
          <Text style={styles.taskDetail}>{task.pointOfContact.phone}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
      </TouchableOpacity>

      {/* ── Description ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Description</Text>
        <Text style={styles.cardBody}>{task.description}</Text>
      </View>

      {/* ── Notes — only when in progress ── */}
      {taskStatus !== 'to_do' && (
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardTitle}>Notes & Issues</Text>
            <TouchableOpacity
              style={[styles.micBtn, listening && { backgroundColor: '#ff8c00', borderRadius: 8, padding: 8 }]}
              onPress={toggleListening}
            >
              <Ionicons name={listening ? 'stop-circle' : 'mic'} size={18} color={listening ? '#fff' : '#ff8c00'} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={(text) => {
              setNotes(text);
              AsyncStorage.setItem(notesKey(taskId), text);
            }}
            placeholder="Add notes, observations, or issues..."
            placeholderTextColor="#6b7280"
            multiline
            numberOfLines={4}
          />
          <Text style={styles.notesHint}>These notes will be submitted with your task completion</Text>
        </View>
      )}

      {/* ── Photos ── */}
      {taskStatus !== 'to_do' && (
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardTitle}>Photos</Text>
            <Text style={styles.photoCount}>{photoUris.length}/{task.photosRequired}</Text>
          </View>
          <View style={styles.photoRow}>
            {photoUris.map((uri, i) => (
              <View key={`p-${i}`} style={[styles.photoSlot, styles.photoSlotDone]}>
                <Image source={{ uri }} style={styles.photoPreview} />
                <TouchableOpacity
                  style={styles.photoRemoveBtn}
                  onPress={() => handleRemovePhoto(i)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="close-circle" size={18} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ))}
            {photoUris.length < task.photosRequired &&
              [...Array(task.photosRequired - photoUris.length)].map((_, i) => (
                <View key={`empty-${i}`} style={styles.photoSlot}>
                  <Ionicons name="camera" size={24} color="#6b7280" />
                </View>
              ))}
          </View>
            {photoUris.length < task.photosMax && (
              <View style={styles.photoActions}>
                <TouchableOpacity style={styles.photoBtn} onPress={handleTakePhoto}>
                  <Ionicons name="camera" size={16} color="#ff8c00" />
                  <Text style={styles.photoBtnText}>Take Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.photoBtn} onPress={handleUploadPhoto}>
                  <Ionicons name="images" size={16} color="#ff8c00" />
                  <Text style={styles.photoBtnText}>Upload Photo</Text>
                </TouchableOpacity>
              </View>
            )}
            </View>
          )}

      {/* ── Actions ── */}
      <View style={styles.actions}>
        {taskStatus === 'to_do' && assigned && (
          <TouchableOpacity style={styles.btnPrimary} onPress={handleStartTask}>
            <Ionicons name="play-circle" size={20} color="white" />
            <Text style={styles.btnText}>Start Task</Text>
          </TouchableOpacity>
        )}
        {taskStatus === 'in_progress' && (
            <TouchableOpacity
              style={task.photosSubmitted >= task.photosRequired ? styles.btnSuccess : styles.btnOutline}
              onPress={handleCompleteTask}
              disabled={task.photosSubmitted < task.photosRequired}
            >
              <Ionicons name="checkmark-circle" size={20} color={task.photosSubmitted >= task.photosRequired ? 'white' : '#ff8c00'} />
              <Text style={task.photosSubmitted >= task.photosRequired ? styles.btnText : styles.btnOutlineText}>
                {task.photosSubmitted >= task.photosRequired ? 'Complete Task' : `Need ${task.photosRequired - task.photosSubmitted} more photo(s)`}
              </Text>
            </TouchableOpacity>
        )}
      </View>

      {/* ── Verification Modal ── */}
      <Modal
        visible={showVerificationModal}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Identity Verification</Text>

            {(verificationStep === 'initial' || verificationStep === 'biometric') && (
              <View style={styles.modalBody}>
                <Text style={styles.modalText}>Verify your identity to start this task.</Text>

                {/* Face ID / Fingerprint toggle */}
                <View style={styles.methodRow}>
                  <TouchableOpacity
                    style={[styles.methodBtn, selectedMethod === 'face' && styles.methodBtnActive]}
                    onPress={() => { setSelectedMethod('face'); setScanState('idle'); }}
                  >
                    <Ionicons name="scan-outline" size={20} color={selectedMethod === 'face' ? '#ff8c00' : '#9ca3af'} />
                    <Text style={[styles.methodLabel, selectedMethod === 'face' && styles.methodLabelActive]}>Face ID</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.methodBtn, selectedMethod === 'fingerprint' && styles.methodBtnActive]}
                    onPress={() => { setSelectedMethod('fingerprint'); setScanState('idle'); }}
                  >
                    <Ionicons name="finger-print" size={20} color={selectedMethod === 'fingerprint' ? '#ff8c00' : '#9ca3af'} />
                    <Text style={[styles.methodLabel, selectedMethod === 'fingerprint' && styles.methodLabelActive]}>Fingerprint</Text>
                  </TouchableOpacity>
                </View>

                {/* Scan button */}
                <TouchableOpacity
                  style={[
                    styles.scanButton,
                    scanState === 'scanning' && styles.scanButtonScanning,
                    scanState === 'failed'   && styles.scanButtonFailed,
                  ]}
                  onPress={handleBiometricAuth}
                  disabled={scanState === 'scanning'}
                >
                  {scanState === 'scanning' ? (
                    <ActivityIndicator size={64} color="white" />
                  ) : (
                    <Ionicons
                      name={selectedMethod === 'face' ? 'scan' : 'finger-print'}
                      size={80}
                      color={scanState === 'failed' ? '#ef4444' : '#ff8c00'}
                    />
                  )}
                </TouchableOpacity>

                {scanState === 'idle'     && <Text style={styles.hintText}>{selectedMethod === 'face' ? 'Tap to scan your face' : 'Tap to scan fingerprint'}</Text>}
                {scanState === 'scanning' && <Text style={styles.hintText}>Scanning…</Text>}

                {/* ── Failed state: retry + PIN fallback ──────────────────────
                    "Use PIN instead" only appears after a scan fails — it is a
                    fallback, not a first option. This matches the login biometric
                    screen behaviour and prevents contractors bypassing biometrics. */}
                {scanState === 'failed' && (
                  <>
                    <Text style={styles.errorText}>Scan failed — please try again.</Text>
                    <TouchableOpacity style={styles.btnPrimary} onPress={() => setScanState('idle')}>
                      <Text style={styles.btnText}>Retry</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.pinLink} onPress={() => setVerificationStep('pin')}>
                      <Ionicons name="keypad-outline" size={16} color="#ff8c00" />
                      <Text style={styles.pinLinkText}>Use PIN instead</Text>
                    </TouchableOpacity>
                  </>
                )}

              </View>
            )}

            {verificationStep === 'pin' && (
              <View style={styles.modalBody}>
                <Text style={styles.modalText}>Please enter your 6-digit PIN.</Text>
                <View style={styles.pinRow}>
                  {[...Array(6)].map((_, index) => (
                    <TextInput
                      key={index}
                      ref={el => { pinRefs.current[index] = el; }}
                      style={styles.pinInput}
                      value={pin[index]}
                      onChangeText={value => handlePinInput(index, value)}
                      onKeyPress={({ nativeEvent }) => handlePinKeyDown(index, nativeEvent.key)}
                      keyboardType="numeric"
                      maxLength={1}
                      secureTextEntry
                    />
                  ))}
                </View>
                {errorMessage !== '' && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={16} color="#ef4444" />
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  </View>
                )}
                <TouchableOpacity style={styles.btnPrimary} onPress={handlePinAuth}>
                  <Text style={styles.btnText}>Verify PIN</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setVerificationStep('initial')}>
                  <Text style={styles.backLink}>Back</Text>
                </TouchableOpacity>
              </View>
            )}

            {verificationStep === 'location' && (
              <View style={styles.modalBody}>
                <Text style={styles.modalText}>Checking your location...</Text>
                <Ionicons name="location" size={48} color="#ff8c00" style={styles.modalIcon} />
              </View>
            )}

            {verificationStep === 'success' && (
              <View style={styles.modalBody}>
                <Text style={styles.modalText}>Verification successful. Starting task...</Text>
                <Ionicons name="checkmark-circle" size={48} color="#22c55e" style={styles.modalIcon} />
              </View>
            )}

            {verificationStep === 'error' && (
              <View style={styles.modalBody}>
                <Text style={styles.modalText}>Verification failed.</Text>
                <Ionicons name="alert-circle" size={48} color="#ef4444" style={styles.modalIcon} />
                <Text style={styles.errorText}>
                  {errorMessage || 'Please try again or use your PIN.'}
                </Text>
                <TouchableOpacity
                  style={styles.btnPrimary}
                  onPress={() => {
                    // Send the user back to the biometric scan UI for another
                    // try without closing the modal.
                    setErrorMessage('');
                    setScanState('idle');
                    setVerificationStep('initial');
                  }}
                >
                  <Ionicons name="refresh" size={20} color="white" />
                  <Text style={styles.btnText}>Try Again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pinLink}
                  onPress={() => {
                    setErrorMessage('');
                    setScanState('idle');
                    setVerificationStep('pin');
                  }}
                >
                  <Ionicons name="keypad-outline" size={16} color="#ff8c00" />
                  <Text style={styles.pinLinkText}>Use PIN instead</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={closeModal}>
                  <Text style={styles.backLink}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}

          </View>
        </View>
      </Modal>

    </MainFrame>
  );
}

const CARD_BG = 'rgba(255,255,255,0.1)';
const BORDER  = 'rgba(255,255,255,0.15)';

const styles = StyleSheet.create({
  section: { width: '90%', marginBottom: 12, marginTop: 16 },
  taskTitle: { fontSize: 20, fontFamily: 'poppins-bold', color: 'white', marginBottom: 8 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255,140,0,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,140,0,0.3)',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, fontFamily: 'poppins-bold', color: 'white' },

  infoCard: {
    width: '90%',
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 12,
    backgroundColor: CARD_BG,
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 12,
    marginBottom: 8,
  },
  infoIcon: {
    width: 40, height: 40, borderRadius: 8,
    backgroundColor: 'rgba(255,140,0,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  infoIconAlt: {
    width: 40, height: 40, borderRadius: 8,
    backgroundColor: 'rgba(245,158,11,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  infoText: { flex: 1 },
  infoLabel: { fontSize: 11, color: '#9ca3af', marginBottom: 2 },
  infoValue: { fontSize: 13, fontFamily: 'poppins-bold', color: 'white' },

  card: {
    width: '90%',
    backgroundColor: CARD_BG,
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, padding: 16,
    marginBottom: 12,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { fontSize: 13, fontFamily: 'poppins-bold', color: 'white' },
  cardBody: { fontSize: 13, color: '#d1d5db', lineHeight: 20 },

  micBtn: {
    padding: 8, borderRadius: 8,
    backgroundColor: 'rgba(255,140,0,0.1)',
  },
  notesInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 8, padding: 10,
    color: 'white', fontSize: 13,
    minHeight: 100, textAlignVertical: 'top',
  },
  notesHint: { fontSize: 11, color: '#6b7280', marginTop: 6 },

  photoCount: { fontSize: 13, fontFamily: 'poppins-bold', color: '#ff8c00' },
  photoRow: { flexDirection: 'row', gap: 8 },
  photoSlot: {
    flex: 1, aspectRatio: 1,
    borderRadius: 8, borderWidth: 2,
    borderStyle: 'dashed', borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  photoSlotDone: { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', borderStyle: 'solid', overflow: 'hidden' },
  photoPreview: { width: '100%', height: '100%', borderRadius: 6 },
  photoRemoveBtn: {
    position: 'absolute', top: 2, right: 2,
    backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 10,
  },

  actions: { width: '90%', gap: 10, marginBottom: 32 },
  btnPrimary: {
    backgroundColor: '#ff8c00',
    borderRadius: 12, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
  },
  btnOutline: {
    backgroundColor: CARD_BG,
    borderWidth: 2, borderColor: '#ff8c00',
    borderRadius: 12, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
  },
  btnSuccess: {
    backgroundColor: '#16a34a',
    borderRadius: 12, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
  },
  btnText: { fontSize: 14, fontFamily: 'poppins-bold', color: 'white' },
  btnOutlineText: { fontSize: 14, fontFamily: 'poppins-bold', color: '#ff8c00' },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#1c2330',
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 16, padding: 20,
  },
  modalTitle: { fontSize: 17, fontFamily: 'poppins-bold', color: 'white' },
  modalBody: { gap: 16, marginTop: 12 },
  modalText: { fontSize: 13, color: '#d1d5db' },
  modalIcon: { alignSelf: 'center' },

  pinRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  pinInput: {
    width: 44, height: 44,
    textAlign: 'center', fontSize: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 8, color: 'white',
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: 8,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
  },
  errorText: { fontSize: 11, color: '#f87171', flex: 1 },
  backLink: { textAlign: 'center', color: '#9ca3af', fontSize: 13, paddingVertical: 8 },

  methodRow:       { flexDirection: 'row', gap: 8 },
  methodBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'rgba(26,43,66,0.85)',
  },
  methodBtnActive:   { borderColor: '#ff8c00', backgroundColor: 'rgba(255,140,0,0.15)' },
  methodLabel:       { fontSize: 12, color: '#9ca3af' },
  methodLabelActive: { fontFamily: 'poppins-bold', color: '#ff8c00' },
  scanButton: {
    width: 140, height: 140, borderRadius: 20, borderWidth: 3,
    borderColor: '#ff8c00', alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', backgroundColor: 'rgba(255,140,0,0.08)',
  },
  scanButtonScanning: { borderColor: '#9ca3af', backgroundColor: 'rgba(255,255,255,0.03)' },
  scanButtonFailed:   { borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)' },
  hintText:    { fontSize: 12, color: '#9ca3af', textAlign: 'center' },
  pinLink:     { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' },
  pinLinkText: { fontSize: 13, fontFamily: 'poppins-bold', color: '#ff8c00', textDecorationLine: 'underline' },
  photoActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  photoBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,140,0,0.4)',
    backgroundColor: 'rgba(255,140,0,0.08)',
  },
  photoBtnText: { fontSize: 12, fontFamily: 'poppins-bold', color: '#ff8c00' },

  taskDetail: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  assignRow: {
    width: '90%',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 8,
  },
  acceptBtn: {
    backgroundColor: '#ff8c00',
    borderRadius: 8, paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
  },
  declineBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 8, paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
  },
});