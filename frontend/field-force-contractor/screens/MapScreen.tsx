// MapScreen — assigned-tickets plotted on a map.
//
// Pulls /contractors/assigned-tickets and drops a status-coloured pin per
// ticket whose `work_order` carries lat/lng. Tap a pin -> callout with
// service title, location label, and a Navigate button that hands off to
// Apple/Google Maps via the same Linking pattern used in TicketDetailScreen.
//
// Tickets without work_order coordinates are silently filtered out of the
// pins list and surfaced in a footer pill ("3 tickets without location") so
// the contractor knows the map is incomplete instead of wondering where a
// ticket went.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import MapView, { Callout, Marker, PROVIDER_DEFAULT } from 'react-native-maps';

import { SubHeader } from '../components/MainFrame';
import { api } from '../utils/api';
import { ticketDisplayTitle } from '../utils/ticketLabels';

interface WorkOrderLite {
  id: string;
  latitude: string | number | null;
  longitude: string | number | null;
  location: string | null;
  location_type: string | null;
}

interface BackendTicket {
  id: string;
  description: string | null;
  status: string;
  service_type: string | null;
  due_date: string | null;
  work_order: WorkOrderLite | null;
}

interface PinTicket extends BackendTicket {
  lat: number;
  lng: number;
  locationLabel: string;
}

const STATUS_PIN: Record<string, string> = {
  ASSIGNED: '#f59e0b',         // amber
  IN_PROGRESS: '#3b82f6',      // blue
  PENDING_APPROVAL: '#a78bfa', // violet
  COMPLETED: '#22c55e',        // green
  APPROVED: '#22c55e',
};

// Fallback region (Austin, TX) for when there are zero pins to fit.
const FALLBACK_REGION = {
  latitude: 30.2672,
  longitude: -97.7431,
  latitudeDelta: 0.4,
  longitudeDelta: 0.4,
};

function toPin(t: BackendTicket): PinTicket | null {
  const wo = t.work_order;
  if (!wo) return null;
  const lat = wo.latitude == null ? NaN : Number(wo.latitude);
  const lng = wo.longitude == null ? NaN : Number(wo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    ...t,
    lat,
    lng,
    locationLabel: wo.location?.trim() || 'Job site',
  };
}

function pinColor(status: string): string {
  return STATUS_PIN[(status || '').toUpperCase()] ?? '#9ca3af';
}

export default function MapScreen() {
  const navigation = useNavigation<any>();
  const mapRef = useRef<MapView | null>(null);
  const [tickets, setTickets] = useState<BackendTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    setError(null);
    try {
      const rows = await api.authGet<BackendTicket[]>('/contractors/assigned-tickets');
      setTickets(rows ?? []);
    } catch {
      setError("Couldn't load tickets. Pull down to refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    fetchTickets().catch(() => {});
  }, [fetchTickets]));

  const pins = tickets.map(toPin).filter((p): p is PinTicket => p !== null);
  const missingLocationCount = tickets.length - pins.length;

  // Fit-to-pins after data lands.
  useEffect(() => {
    if (!mapRef.current || pins.length === 0) return;
    mapRef.current.fitToCoordinates(
      pins.map(p => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: { top: 80, right: 60, bottom: 120, left: 60 }, animated: true },
    );
  }, [pins.length]);

  const handleNavigate = (p: PinTicket) => {
    const url = `https://maps.google.com/?q=${p.lat},${p.lng}`;
    Linking.openURL(url);
  };

  const handleOpenTicket = (p: PinTicket) => {
    navigation.navigate('TicketDetail' as never, { taskId: p.id, assigned: true } as never);
  };

  return (
    <View style={styles.root}>
      <SubHeader title="Tickets map" />

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFill}
          initialRegion={FALLBACK_REGION}
          showsUserLocation
          showsMyLocationButton
        >
          {pins.map(p => (
            <Marker
              key={p.id}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              pinColor={pinColor(p.status)}
            >
              <Callout tooltip={false} onPress={() => handleOpenTicket(p)}>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle} numberOfLines={2}>
                    {ticketDisplayTitle(p)}
                  </Text>
                  <Text style={styles.calloutMeta}>
                    {p.locationLabel} · {(p.status || '').replace('_', ' ')}
                  </Text>
                  <View style={styles.calloutRow}>
                    <TouchableOpacity
                      style={[styles.calloutBtn, styles.calloutBtnPrimary]}
                      onPress={() => handleNavigate(p)}
                    >
                      <Ionicons name="navigate" size={14} color="white" />
                      <Text style={styles.calloutBtnText}>Navigate</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.calloutBtn, styles.calloutBtnGhost]}
                      onPress={() => handleOpenTicket(p)}
                    >
                      <Text style={[styles.calloutBtnText, { color: '#0f172a' }]}>
                        Open
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>

        {loading && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#9ca3af" />
          </View>
        )}

        {error && (
          <View style={styles.errorPill}>
            <Ionicons name="alert-circle-outline" size={14} color="#fca5a5" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && pins.length === 0 && !error && (
          <View style={styles.emptyOverlay}>
            <Ionicons name="map-outline" size={32} color="rgba(255,255,255,0.6)" />
            <Text style={styles.emptyText}>No tickets with location data yet.</Text>
          </View>
        )}

        {missingLocationCount > 0 && (
          <View style={styles.missingPill}>
            <Ionicons name="information-circle-outline" size={14} color="#cbd5e1" />
            <Text style={styles.missingText}>
              {missingLocationCount} ticket{missingLocationCount === 1 ? '' : 's'} without location
            </Text>
          </View>
        )}

        {/* Status legend */}
        <View style={styles.legend}>
          <LegendDot color={STATUS_PIN.ASSIGNED} label="Assigned" />
          <LegendDot color={STATUS_PIN.IN_PROGRESS} label="In progress" />
          <LegendDot color={STATUS_PIN.COMPLETED} label="Done" />
        </View>
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0e1a' },
  mapWrap: { flex: 1, position: 'relative' },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,14,26,0.6)',
    gap: 8,
  },
  emptyText: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },

  errorPill: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(127,29,29,0.85)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  errorText: { color: '#fecaca', fontSize: 12 },

  missingPill: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15,23,42,0.85)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  missingText: { color: '#e2e8f0', fontSize: 12 },

  legend: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { color: 'white', fontSize: 11 },

  callout: { width: 220, gap: 6 },
  calloutTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  calloutMeta: { fontSize: 11, color: '#475569' },
  calloutRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  calloutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  calloutBtnPrimary: { backgroundColor: '#2563eb' },
  calloutBtnGhost: { backgroundColor: '#e2e8f0' },
  calloutBtnText: { fontSize: 12, fontWeight: '600', color: 'white' },
});
