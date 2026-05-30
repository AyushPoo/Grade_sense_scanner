import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { useScanStore } from '../../src/store/scanStore';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout, updateUserOrgName } = useAuthStore();
  const { savedSessions } = useScanStore();
  
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [orgInput, setOrgInput] = useState(user?.org_name || '');

  const totalPages = savedSessions.reduce((sum, s) => sum + s.stats.total_pages, 0);
  const totalStudents = savedSessions.reduce((sum, s) => sum + s.stats.total_students, 0);
  const uploadedSessions = savedSessions.filter(s => s.status === 'uploaded').length;

  const handleSaveOrg = () => {
    if (!orgInput.trim()) {
      Alert.alert('Error', 'Institute name cannot be empty');
      return;
    }
    updateUserOrgName(orgInput.trim());
    setShowOrgModal(false);
    Alert.alert('Success', 'Institute name updated successfully');
  };

  const handleLogout = () => {
    logout();
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.userName}>{user?.name || 'Teacher'}</Text>
          <Text style={styles.userEmail}>{user?.email || 'email@example.com'}</Text>
          <TouchableOpacity 
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}
            onPress={() => {
              setOrgInput(user?.org_name || '');
              setShowOrgModal(true);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.orgName}>{user?.org_name || 'Set Institute Name'}</Text>
            <Ionicons name="create-outline" size={14} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{savedSessions.length}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{totalStudents}</Text>
            <Text style={styles.statLabel}>Students</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{totalPages}</Text>
            <Text style={styles.statLabel}>Pages</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Activity</Text>
          
          <View style={styles.activityCard}>
            <View style={styles.activityItem}>
              <View style={[styles.activityIcon, { backgroundColor: `${COLORS.success}20` }]}>
                <Ionicons name="checkmark-circle" size={24} color={COLORS.success} />
              </View>
              <View style={styles.activityInfo}>
                <Text style={styles.activityLabel}>Uploaded Sessions</Text>
                <Text style={styles.activityValue}>{uploadedSessions}</Text>
              </View>
            </View>

            <View style={styles.activityItem}>
              <View style={[styles.activityIcon, { backgroundColor: `${COLORS.warning}20` }]}>
                <Ionicons name="time" size={24} color={COLORS.warning} />
              </View>
              <View style={styles.activityInfo}>
                <Text style={styles.activityLabel}>Pending Uploads</Text>
                <Text style={styles.activityValue}>
                  {savedSessions.filter(s => s.status === 'ready').length}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          
          <View style={styles.settingsCard}>
            <TouchableOpacity 
              style={styles.settingItem}
              onPress={() => {
                setOrgInput(user?.org_name || '');
                setShowOrgModal(true);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.settingLeft}>
                <Ionicons name="business-outline" size={22} color={COLORS.text} />
                <Text style={styles.settingLabel}>Edit Institute Name</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Ionicons name="notifications-outline" size={22} color={COLORS.text} />
                <Text style={styles.settingLabel}>Notifications</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Ionicons name="camera-outline" size={22} color={COLORS.text} />
                <Text style={styles.settingLabel}>Scan Settings</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Ionicons name="help-circle-outline" size={22} color={COLORS.text} />
                <Text style={styles.settingLabel}>Help & Support</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Ionicons name="information-circle-outline" size={22} color={COLORS.text} />
                <Text style={styles.settingLabel}>About</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={22} color={COLORS.error} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>GradeSense Scanner v1.0.0</Text>
        
        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal
        visible={showOrgModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowOrgModal(false)}
      >
        <View style={modalStyles.overlay}>
          <View style={modalStyles.content}>
            <View style={modalStyles.header}>
              <Text style={modalStyles.title}>Edit Institute Name</Text>
              <TouchableOpacity onPress={() => setShowOrgModal(false)} style={modalStyles.closeBtn}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={modalStyles.body}>
              <Text style={modalStyles.subtitle}>
                Update the name of the school or institute you are associated with.
              </Text>
              <TextInput
                style={modalStyles.input}
                value={orgInput}
                onChangeText={setOrgInput}
                placeholder="e.g. Greenwood High School"
                placeholderTextColor={COLORS.textMuted}
                autoFocus={true}
              />
              <View style={modalStyles.buttonRow}>
                <TouchableOpacity 
                  style={[modalStyles.button, modalStyles.cancelBtn]} 
                  onPress={() => setShowOrgModal(false)}
                >
                  <Text style={modalStyles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[modalStyles.button, modalStyles.saveBtn]} 
                  onPress={handleSaveOrg}
                >
                  <Text style={modalStyles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: COLORS.background,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 40,
    fontWeight: '700',
    color: '#fff',
  },
  userName: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  userEmail: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  orgName: {
    fontSize: 14,
    color: COLORS.primary,
    marginTop: 4,
    fontWeight: '500',
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.background,
    marginTop: 1,
    paddingVertical: 20,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: COLORS.border,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  activityCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    overflow: 'hidden',
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  activityIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityInfo: {
    flex: 1,
  },
  activityLabel: {
    fontSize: 15,
    color: COLORS.text,
  },
  activityValue: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 2,
  },
  settingsCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingLabel: {
    fontSize: 16,
    color: COLORS.text,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 32,
    marginHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.error,
  },
  version: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 24,
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    padding: 20,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
  },
  input: {
    backgroundColor: COLORS.backgroundDark || '#F5F5F5',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: COLORS.backgroundDark || '#F5F5F5',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelBtnText: {
    color: COLORS.text,
    fontWeight: '600',
    fontSize: 16,
  },
  saveBtn: {
    backgroundColor: COLORS.primary,
  },
  saveBtnText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 16,
  },
});
