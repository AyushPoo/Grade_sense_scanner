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
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS } from '../../src/config';
import { useAuthStore } from '../../src/store/authStore';
import { useScanStore } from '../../src/store/scanStore';

type SettingRowProps = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sublabel?: string;
  onPress?: () => void;
  iconBg?: string;
  iconColor?: string;
  rightElement?: React.ReactNode;
  isDestructive?: boolean;
};

function SettingRow({ icon, label, sublabel, onPress, iconBg, iconColor, rightElement, isDestructive }: SettingRowProps) {
  return (
    <TouchableOpacity
      style={rowStyles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.75 : 1}
      disabled={!onPress}
    >
      <View style={[rowStyles.iconWrap, { backgroundColor: iconBg ?? COLORS.surfaceElevated }]}>
        <Ionicons name={icon} size={18} color={iconColor ?? (isDestructive ? COLORS.error : COLORS.text)} />
      </View>
      <View style={rowStyles.labelWrap}>
        <Text style={[rowStyles.label, isDestructive && { color: COLORS.error }]}>{label}</Text>
        {sublabel ? <Text style={rowStyles.sublabel}>{sublabel}</Text> : null}
      </View>
      {rightElement ?? (
        onPress && <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
      )}
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  labelWrap: { flex: 1 },
  label: { fontSize: 15, fontWeight: '500', color: COLORS.text },
  sublabel: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
});

export default function ProfileScreen() {
  const router = useRouter();
  const { 
    user, 
    logout, 
    updateUserOrgName,
    defaultGradingMode,
    cameraResolution,
    setDefaultGradingMode,
    setCameraResolution
  } = useAuthStore();
  const { savedSessions, deleteSession } = useScanStore();

  // Org modal
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [orgInput, setOrgInput] = useState(user?.org_name || '');

  // Scanner settings modal
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [selectedGradingMode, setSelectedGradingMode] = useState(defaultGradingMode);
  const [selectedResolution, setSelectedResolution] = useState(cameraResolution);

  const sessions = Array.isArray(savedSessions) ? savedSessions : [];
  const totalPages = sessions.reduce((sum, s) => sum + (s.stats?.total_pages || 0), 0);
  const totalStudents = sessions.reduce((sum, s) => sum + (s.stats?.total_students || 0), 0);
  const uploadedSessions = sessions.filter(s => s.status === 'uploaded').length;

  const handleSaveOrg = () => {
    if (!orgInput.trim()) { Alert.alert('Error', 'Institute name cannot be empty'); return; }
    updateUserOrgName(orgInput.trim());
    setShowOrgModal(false);
  };



  const handleSaveScannerSettings = () => {
    setDefaultGradingMode(selectedGradingMode);
    setCameraResolution(selectedResolution as any);
    setShowScannerModal(false);
    Alert.alert('Success', 'Scanner and grading options saved.');
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Local Cache?',
      'This will permanently delete all scanned pages and offline drafts stored locally. Graded cloud exams will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              for (const s of sessions) {
                await deleteSession(s.session_id);
              }
              Alert.alert('Success', 'Local drafts cache wiped successfully.');
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          }
        }
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { logout(); router.replace('/(auth)/login'); } },
    ]);
  };

  const initials = (user?.name ?? 'T').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <LinearGradient
          colors={[COLORS.backgroundDark, COLORS.background]}
          style={styles.hero}
        >
          <View style={styles.avatarContainer}>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={styles.avatar} />
            ) : (
              <LinearGradient
                colors={[COLORS.primary, COLORS.primaryDark]}
                style={styles.avatarGradient}
              >
                <Text style={styles.avatarText}>{initials}</Text>
              </LinearGradient>
            )}
            <View style={styles.avatarBadge}>
              <Ionicons name="checkmark" size={10} color="#fff" />
            </View>
          </View>

          <Text style={styles.userName}>{user?.name || 'Teacher'}</Text>
          <Text style={styles.userEmail}>{user?.email || ''}</Text>

          <TouchableOpacity
            style={styles.orgChip}
            onPress={() => { setOrgInput(user?.org_name || ''); setShowOrgModal(true); }}
            activeOpacity={0.78}
          >
            <Ionicons name="business" size={13} color={COLORS.primary} />
            <Text style={styles.orgChipText}>{user?.org_name || 'Set institute name'}</Text>
            <Ionicons name="create" size={12} color={COLORS.primary} />
          </TouchableOpacity>
        </LinearGradient>

        {/* Stats bar */}
        <View style={styles.statsBar}>
          {[
            { val: sessions.length, lbl: 'Sessions' },
            { val: uploadedSessions, lbl: 'Uploaded' },
            { val: totalStudents, lbl: 'Students' },
            { val: totalPages, lbl: 'Pages' },
          ].map((item, idx, arr) => (
            <React.Fragment key={item.lbl}>
              <View style={styles.stat}>
                <Text style={styles.statVal}>{item.val}</Text>
                <Text style={styles.statLbl}>{item.lbl}</Text>
              </View>
              {idx < arr.length - 1 && <View style={styles.statSep} />}
            </React.Fragment>
          ))}
        </View>

        {/* Account section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <View style={styles.card}>
            <SettingRow
              icon="business-outline"
              label="Edit Institute Name"
              sublabel={user?.org_name || 'Not set'}
              iconBg={COLORS.primaryXLight}
              iconColor={COLORS.primary}
              onPress={() => { setOrgInput(user?.org_name || ''); setShowOrgModal(true); }}
            />
            <SettingRow
              icon="mail-outline"
              label="Email Address"
              sublabel={user?.email || ''}
              iconBg={COLORS.infoLight}
              iconColor={COLORS.info}
            />
          </View>
        </View>

        {/* App configuration */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>APP CONFIGURATION</Text>
          <View style={styles.card}>
            <SettingRow
              icon="camera-outline"
              label="Scanner Preferences"
              sublabel={`Mode: ${defaultGradingMode.toUpperCase()} • Res: ${cameraResolution.toUpperCase()}`}
              iconBg={COLORS.primaryXLight}
              iconColor={COLORS.primary}
              onPress={() => {
                setSelectedGradingMode(defaultGradingMode);
                setSelectedResolution(cameraResolution);
                setShowScannerModal(true);
              }}
            />
            <SettingRow
              icon="trash-outline"
              label="Clear Local Cache"
              sublabel="Free up local space"
              iconBg={COLORS.errorLight}
              iconColor={COLORS.error}
              onPress={handleClearCache}
            />
          </View>
        </View>

        {/* Info Support */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SUPPORT</Text>
          <View style={styles.card}>
            <SettingRow
              icon="help-circle-outline"
              label="Help & Support"
              iconBg={COLORS.successLight}
              iconColor={COLORS.success}
              onPress={() => Alert.alert('Help', 'Contact our support team at support@gradesense.io')}
            />
            <SettingRow
              icon="information-circle-outline"
              label="About"
              sublabel="GradeSense Scanner v1.0.0"
              iconBg={COLORS.surfaceElevated}
              iconColor={COLORS.textLight}
            />
          </View>
        </View>

        {/* Sign out */}
        <View style={styles.section}>
          <View style={[styles.card, { overflow: 'hidden' }]}>
            <SettingRow
              icon="log-out-outline"
              label="Sign Out"
              isDestructive
              onPress={handleLogout}
              rightElement={<View />}
            />
          </View>
        </View>

        <Text style={styles.version}>GradeSense Scanner v1.0.0</Text>
        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Org Name Modal */}
      <Modal visible={showOrgModal} transparent animationType="slide" onRequestClose={() => setShowOrgModal(false)}>
        <View style={modalStyles.backdrop}>
          <View style={modalStyles.sheet}>
            <View style={modalStyles.handle} />
            <Text style={modalStyles.sheetTitle}>Institute Name</Text>
            <Text style={modalStyles.sheetSub}>Enter the name of your school or organisation.</Text>
            <TextInput
              style={modalStyles.input}
              value={orgInput}
              onChangeText={setOrgInput}
              placeholder="e.g. Greenwood High School"
              placeholderTextColor={COLORS.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveOrg}
            />
            <View style={modalStyles.buttons}>
              <TouchableOpacity style={[modalStyles.btn, modalStyles.cancelBtn]} onPress={() => setShowOrgModal(false)}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[modalStyles.btn, modalStyles.saveBtn]} onPress={handleSaveOrg}>
                <Text style={modalStyles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>


      {/* Scanner Preferences Modal */}
      <Modal visible={showScannerModal} transparent animationType="slide" onRequestClose={() => setShowScannerModal(false)}>
        <View style={modalStyles.backdrop}>
          <View style={modalStyles.sheet}>
            <View style={modalStyles.handle} />
            <Text style={modalStyles.sheetTitle}>Scanner Preferences</Text>
            <Text style={modalStyles.sheetSub}>Configure grading correction defaults and camera resolution values.</Text>
            
            <Text style={styles.fieldLabel}>DEFAULT AI GRADING MODE</Text>
            <View style={styles.selectOptions}>
              {['strict', 'balanced', 'conceptual', 'lenient'].map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.selectOption, selectedGradingMode === mode && styles.selectOptionActive]}
                  onPress={() => setSelectedGradingMode(mode)}
                >
                  <Text style={[styles.selectOptionText, selectedGradingMode === mode && styles.selectOptionTextActive]}>
                    {mode.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>CAMERA CAPTURE RESOLUTION</Text>
            <View style={styles.selectOptions}>
              {['low', 'medium', 'high'].map(res => (
                <TouchableOpacity
                  key={res}
                  style={[styles.selectOption, selectedResolution === res && styles.selectOptionActive]}
                  onPress={() => setSelectedResolution(res as any)}
                >
                  <Text style={[styles.selectOptionText, selectedResolution === res && styles.selectOptionTextActive]}>
                    {res.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={modalStyles.buttons}>
              <TouchableOpacity style={[modalStyles.btn, modalStyles.cancelBtn]} onPress={() => setShowScannerModal(false)}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[modalStyles.btn, modalStyles.saveBtn]} onPress={handleSaveScannerSettings}>
                <Text style={modalStyles.saveText}>Save Options</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.backgroundDark },

  // Hero
  hero: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  avatarContainer: { position: 'relative', marginBottom: 14 },
  avatar: { width: 90, height: 90, borderRadius: 45 },
  avatarGradient: {
    width: 90, height: 90, borderRadius: 45,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 34, fontWeight: '800', color: '#fff' },
  avatarBadge: {
    position: 'absolute', bottom: 2, right: 2,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.success,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: COLORS.background,
  },

  userName: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  userEmail: { fontSize: 13, color: COLORS.textMuted, marginTop: 3, marginBottom: 12 },

  orgChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primaryXLight,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
  },
  orgChipText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },

  // Stats bar
  statsBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.borderLight,
  },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 22, fontWeight: '800', color: COLORS.primary },
  statLbl: { fontSize: 11, color: COLORS.textMuted, marginTop: 3, fontWeight: '500' },
  statSep: { width: 1, backgroundColor: COLORS.border, marginVertical: 4 },

  // Sections
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 10,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },

  version: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 24,
  },

  // Input labels
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textLight,
    letterSpacing: 0.5,
    marginBottom: 6,
    marginLeft: 2,
  },

  // Options selectors
  selectOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  selectOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  selectOptionText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textLight,
  },
  selectOptionTextActive: {
    color: '#fff',
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 16,
  },
  handle: {
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 6 },
  sheetSub: { fontSize: 14, color: COLORS.textLight, lineHeight: 20, marginBottom: 20 },
  input: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 15,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    marginBottom: 20,
  },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  cancelBtn: { backgroundColor: COLORS.surfaceElevated, borderWidth: 1, borderColor: COLORS.border },
  saveBtn: { backgroundColor: COLORS.primary, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  cancelText: { fontSize: 15, fontWeight: '600', color: COLORS.textLight },
  saveText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
