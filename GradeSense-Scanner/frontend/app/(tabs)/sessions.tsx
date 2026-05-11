import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';
import { useScanStore } from '../../src/store/scanStore';
import { ScanSession } from '../../src/types';

export default function SessionsScreen() {
  const router = useRouter();
  const { savedSessions, deleteSession, fetchSessions } = useScanStore();
  const [refreshing, setRefreshing] = React.useState(false);

  React.useEffect(() => {
    fetchSessions().catch(err => console.error('Initial fetch failed:', err));
  }, []);

  // Ensure savedSessions is always an array to avoid crashes
  const sessions = Array.isArray(savedSessions) ? savedSessions : [];

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchSessions();
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteSession = (session: ScanSession) => {
    Alert.alert(
      'Delete Session',
      `Are you sure you want to delete "${session.session_name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteSession(session.session_id),
        },
      ]
    );
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'uploaded':
        return { icon: 'checkmark-circle', color: COLORS.success, text: 'Uploaded' };
      case 'ready':
        return { icon: 'time', color: COLORS.warning, text: 'Pending Upload' };
      case 'uploading':
        return { icon: 'cloud-upload', color: COLORS.primary, text: 'Uploading...' };
      case 'failed':
        return { icon: 'alert-circle', color: COLORS.error, text: 'Upload Failed' };
      default:
        return { icon: 'document', color: COLORS.textMuted, text: 'Scanning' };
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const renderSession = ({ item }: { item: ScanSession }) => {
    const statusInfo = getStatusInfo(item.status);
    
    return (
      <TouchableOpacity
        style={styles.sessionCard}
        onPress={() => router.push({
          pathname: '/review',
          params: { sessionId: item.session_id }
        })}
        activeOpacity={0.7}
      >
        <View style={styles.sessionHeader}>
          <View style={styles.sessionIcon}>
            <Ionicons name="document-text" size={24} color={COLORS.primary} />
          </View>
          <View style={styles.sessionInfo}>
            <Text style={styles.sessionName}>{item.session_name}</Text>
            <Text style={styles.sessionDate}>{formatDate(item.created_at)}</Text>
          </View>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteSession(item)}
          >
            <Ionicons name="trash-outline" size={20} color={COLORS.error} />
          </TouchableOpacity>
        </View>

        <View style={styles.sessionStats}>
          <View style={styles.statItem}>
            <Ionicons name="people" size={16} color={COLORS.textMuted} />
            <Text style={styles.statText}>{(item.stats?.total_students || 0)} students</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="documents" size={16} color={COLORS.textMuted} />
            <Text style={styles.statText}>{(item.stats?.total_pages || 0)} pages</Text>
          </View>
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.statusBadge, { backgroundColor: `${statusInfo.color}20` }]}>
            <Ionicons name={statusInfo.icon as any} size={16} color={statusInfo.color} />
            <Text style={[styles.statusText, { color: statusInfo.color }]}>
              {statusInfo.text}
            </Text>
          </View>
          
          {(item.status === 'ready' || item.status === 'failed') && (
            <TouchableOpacity
              style={styles.uploadButton}
              onPress={() => router.push({
                pathname: '/upload',
                params: { sessionId: item.session_id }
              })}
            >
              <Ionicons name="cloud-upload" size={16} color="#fff" />
              <Text style={styles.uploadButtonText}>Upload</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Saved Sessions</Text>
        <Text style={styles.headerSubtitle}>{sessions.length} sessions</Text>
      </View>

      {sessions.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="folder-open-outline" size={64} color={COLORS.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No Sessions Yet</Text>
          <Text style={styles.emptySubtitle}>
            Start a new scan session to see it here
          </Text>
          <TouchableOpacity
            style={styles.newScanButton}
            onPress={() => router.push('/session-setup')}
          >
            <Ionicons name="camera" size={20} color="#fff" />
            <Text style={styles.newScanButtonText}>New Scan Session</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.session_id}
          renderItem={renderSession}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={onRefresh} 
              tintColor={COLORS.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  header: {
    padding: 20,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  sessionCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sessionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionName: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  sessionDate: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  deleteButton: {
    padding: 8,
  },
  sessionStats: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 12,
    paddingLeft: 60,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 60,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 24,
  },
  newScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  newScanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
