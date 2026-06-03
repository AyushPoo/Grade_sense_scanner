import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../src/config';
import { fetchAdminFeedback, resolveAdminFeedback } from '../../src/api/adminPortal';
import { AdminProductFeedback } from '../../src/utils/adminPortalData';
import { useAuthStore } from '../../src/store/authStore';
import { PortalActionButton, PortalCard, PortalScreen, PortalState, SectionTitle, StatusPill } from '../../src/components/portal/PortalKit';

export default function AdminFeedbackScreen() {
  const token = useAuthStore(state => state.sessionToken);
  const [items, setItems] = useState<AdminProductFeedback[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setIsLoading(true);
      setItems(await fetchAdminFeedback({ token }));
    } catch (err: any) {
      setError(err.message || 'Feedback could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (item: AdminProductFeedback, status: string) => {
    if (!token) return;
    try {
      setSavingId(item.id);
      setError(null);
      await resolveAdminFeedback({ token }, item.id, status);
      await load();
    } catch (err: any) {
      setError(err.message || 'Unable to update feedback status.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <PortalScreen title="Feedback" subtitle="Product feedback from users" onRefresh={load} refreshing={isLoading}>
      {isLoading && !items.length ? (
        <PortalState title="Loading feedback..." loading />
      ) : error ? (
        <PortalState title="Feedback unavailable" message={error} onRetry={load} />
      ) : null}

      <SectionTitle title="Feedback Queue" />
      {items.length ? items.map(item => (
        <PortalCard key={item.id} style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.meta}>{item.type} - {item.userLabel}</Text>
            </View>
            <StatusPill label={item.status} tone={item.status === 'resolved' ? 'success' : 'warning'} />
          </View>
          <Text style={styles.body}>{item.body}</Text>
          <View style={styles.actions}>
            <PortalActionButton label="Mark Reviewing" icon="time-outline" onPress={() => resolve(item, 'reviewing')} tone="secondary" disabled={savingId === item.id} />
            <PortalActionButton label="Resolve" icon="checkmark-circle-outline" onPress={() => resolve(item, 'resolved')} disabled={savingId === item.id} />
          </View>
        </PortalCard>
      )) : (
        <PortalState title="No feedback found" message="Feedback submitted from the product will appear here." />
      )}
    </PortalScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  meta: { fontSize: 12, color: COLORS.textMuted, marginTop: 3 },
  body: { fontSize: 14, color: COLORS.textLight, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10 },
});
