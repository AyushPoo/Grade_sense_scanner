import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { COLORS, getBackendUrl } from '../../config';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ExportModalProps {
  visible: boolean;
  onClose: () => void;
  examId: string;
  examName: string;
  token: string | null;
}

type TabType = 'zip' | 'email' | 'whatsapp';

export function ExportModal({ visible, onClose, examId, examName, token }: ExportModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('zip');
  
  // Loading & Progress states
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  // Email SMTP States
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [emailSubject, setEmailSubject] = useState(`Graded Exam Results for ${examName}`);
  const [emailBody, setEmailBody] = useState(
    'Hello {student_name},\n\nYour graded paper for {exam_name} is attached.\n\nScore: {score}\n\nRegards,\nGradeSense'
  );

  // WhatsApp Connection & Sending States
  const [waStatus, setWaStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [waQrCode, setWaQrCode] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [waPairCode, setWaPairCode] = useState<string | null>(null);
  const [isPairingLoading, setIsPairingLoading] = useState(false);
  const [waTemplate, setWaTemplate] = useState(
    'Hello {student_name}, your results for {exam_name} are ready. Score: {score}. View report: {report_link}'
  );

  const statusIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load saved SMTP settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const savedHost = await AsyncStorage.getItem('gradesense.smtp.host');
        const savedPort = await AsyncStorage.getItem('gradesense.smtp.port');
        const savedUser = await AsyncStorage.getItem('gradesense.smtp.user');
        const savedPass = await AsyncStorage.getItem('gradesense.smtp.password');
        const savedSubject = await AsyncStorage.getItem(`gradesense.smtp.subject.${examId}`);
        const savedBody = await AsyncStorage.getItem('gradesense.smtp.body');
        
        if (savedHost) setSmtpHost(savedHost);
        if (savedPort) setSmtpPort(savedPort);
        if (savedUser) setSmtpUser(savedUser);
        if (savedPass) setSmtpPassword(savedPass);
        if (savedSubject) setEmailSubject(savedSubject);
        if (savedBody) setEmailBody(savedBody);
      } catch (err) {
        console.error('Failed to load SMTP settings:', err);
      }
    };
    if (visible) {
      loadSettings();
      checkWhatsAppStatus();
      // Poll WhatsApp status while modal is open
      statusIntervalRef.current = setInterval(checkWhatsAppStatus, 4000);
    } else {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
      // Clear sensitive info on close
      setWaQrCode(null);
      setWaPairCode(null);
      setPhoneNumber('');
    }
    return () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
      }
    };
  }, [visible, examId]);

  // Dynamic WhatsApp QR Polling
  useEffect(() => {
    if (visible && activeTab === 'whatsapp' && waStatus === 'disconnected') {
      fetchWhatsAppQR();
    }
  }, [activeTab, waStatus, visible]);

  const checkWhatsAppStatus = async () => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/v1/whatsapp/status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setWaStatus(data.status);
      }
    } catch (err) {
      console.warn('Failed to check WhatsApp status:', err);
    }
  };

  const fetchWhatsAppQR = async () => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/v1/whatsapp/qr`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.qr) {
          setWaQrCode(data.qr);
        } else if (data.status === 'connected') {
          setWaStatus('connected');
          setWaQrCode(null);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch WhatsApp QR:', err);
    }
  };

  const generatePairingCode = async () => {
    if (!phoneNumber.trim()) {
      Alert.alert('Phone Required', 'Please enter your mobile number with country code (e.g. 919876543210)');
      return;
    }
    setIsPairingLoading(true);
    setWaPairCode(null);
    try {
      const res = await fetch(`${getBackendUrl()}/api/v1/whatsapp/pair-code?phone=${encodeURIComponent(phoneNumber.trim())}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (res.ok && data.code) {
        setWaPairCode(data.code);
        Alert.alert(
          'Pairing Code Generated',
          `Enter this code in your phone's WhatsApp: ${data.code}\n\nTo enter, open WhatsApp, tap Settings > Linked Devices > Link a Device > Link with phone number instead.`
        );
      } else {
        Alert.alert('Pairing Failed', data.error || 'Failed to request pairing code.');
      }
    } catch (err) {
      Alert.alert('Error', 'Network request failed. Ensure your backend is online.');
    } finally {
      setIsPairingLoading(false);
    }
  };

  const handleWhatsAppLogout = async () => {
    Alert.alert('Disconnect WhatsApp', 'Are you sure you want to log out and unlink your account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await fetch(`${getBackendUrl()}/api/v1/whatsapp/logout`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });
            if (res.ok) {
              setWaStatus('disconnected');
              setWaQrCode(null);
              setWaPairCode(null);
              Alert.alert('Logged Out', 'WhatsApp device unlinked successfully.');
            }
          } catch (err) {
            Alert.alert('Error', 'Failed to logout WhatsApp device.');
          }
        }
      }
    ]);
  };

  const handleDownloadZip = async () => {
    setIsExporting(true);
    setExportProgress('Downloading ZIP...');
    try {
      const localUri = `${FileSystem.documentDirectory}${examName.replace(/\s+/g, '_')}_Reports.zip`;
      const downloadRes = await FileSystem.downloadAsync(
        `${getBackendUrl()}/api/v1/exams/${examId}/export/zip`,
        localUri,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (downloadRes.status !== 200) {
        throw new Error('Download failed. Ensure results are graded and online.');
      }

      setExportProgress('Opening share sheet...');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloadRes.uri);
      } else {
        Alert.alert('Export Complete', `Saved to documents: ${downloadRes.uri}`);
      }
    } catch (err: any) {
      Alert.alert('ZIP Download Failed', err.message || 'Could not compile reports ZIP.');
    } finally {
      setIsExporting(false);
      setExportProgress('');
    }
  };

  const handleSendEmails = async () => {
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
      Alert.alert('Missing SMTP settings', 'Please fill in all SMTP credentials.');
      return;
    }
    
    // Save SMTP credentials locally (except password if user prefers, but we save it locally for convenience)
    try {
      await AsyncStorage.setItem('gradesense.smtp.host', smtpHost);
      await AsyncStorage.setItem('gradesense.smtp.port', smtpPort);
      await AsyncStorage.setItem('gradesense.smtp.user', smtpUser);
      await AsyncStorage.setItem('gradesense.smtp.password', smtpPassword);
      await AsyncStorage.setItem(`gradesense.smtp.subject.${examId}`, emailSubject);
      await AsyncStorage.setItem('gradesense.smtp.body', emailBody);
    } catch (err) {
      console.warn('Failed to persist SMTP settings:', err);
    }

    setIsExporting(true);
    setExportProgress('Queueing emails on backend...');
    try {
      const res = await fetch(`${getBackendUrl()}/api/v1/exams/${examId}/export/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          smtp_host: smtpHost,
          smtp_port: parseInt(smtpPort),
          smtp_username: smtpUser,
          smtp_password: smtpPassword,
          subject: emailSubject,
          body: emailBody
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        Alert.alert('Success', data.message || 'Emails queued successfully.');
      } else {
        Alert.alert('Failed', data.message || 'Failed to dispatch emails.');
      }
    } catch (err: any) {
      Alert.alert('Error', 'Network request failed. Make sure your server is online.');
    } finally {
      setIsExporting(false);
      setExportProgress('');
    }
  };

  const handleSendWhatsApp = async () => {
    if (waStatus !== 'connected') {
      Alert.alert('Not Linked', 'Please link your WhatsApp account before broadcasting.');
      return;
    }

    setIsExporting(true);
    setExportProgress('Broadcasting messages...');
    try {
      const res = await fetch(`${getBackendUrl()}/api/v1/exams/${examId}/export/whatsapp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message_template: waTemplate
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        Alert.alert('Broadcast Queued', data.message || 'WhatsApp reports are sending in the background.');
      } else {
        Alert.alert('Broadcast Failed', data.message || 'Could not queue WhatsApp dispatch.');
      }
    } catch (err) {
      Alert.alert('Error', 'Network request failed.');
    } finally {
      setIsExporting(false);
      setExportProgress('');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>Export Results</Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>{examName}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>

          {/* Navigation Tabs */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'zip' && styles.activeTab]}
              onPress={() => setActiveTab('zip')}
            >
              <Ionicons name="folder-zip-outline" size={16} color={activeTab === 'zip' ? COLORS.primary : COLORS.textLight} />
              <Text style={[styles.tabText, activeTab === 'zip' && styles.activeTabText]}>ZIP File</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tab, activeTab === 'email' && styles.activeTab]}
              onPress={() => setActiveTab('email')}
            >
              <Ionicons name="mail-outline" size={16} color={activeTab === 'email' ? COLORS.primary : COLORS.textLight} />
              <Text style={[styles.tabText, activeTab === 'email' && styles.activeTabText]}>Email (BCC)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tab, activeTab === 'whatsapp' && styles.activeTab]}
              onPress={() => setActiveTab('whatsapp')}
            >
              <Ionicons name="logo-whatsapp" size={16} color={activeTab === 'whatsapp' ? COLORS.primary : COLORS.textLight} />
              <Text style={[styles.tabText, activeTab === 'whatsapp' && styles.activeTabText]}>WhatsApp</Text>
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView style={styles.contentScroll} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
            {isExporting && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.loadingText}>{exportProgress}</Text>
              </View>
            )}

            {!isExporting && activeTab === 'zip' && (
              <View style={styles.tabContent}>
                <View style={styles.infoCard}>
                  <Ionicons name="cloud-download-outline" size={32} color={COLORS.primary} />
                  <Text style={styles.infoTitle}>Compile Graded ZIP Package</Text>
                  <Text style={styles.infoDesc}>
                    This compiles all graded student papers with their score breakdowns and AI/teacher comments into separate PDFs, and packs them into a single ZIP file.
                  </Text>
                </View>

                <TouchableOpacity style={styles.submitButton} onPress={handleDownloadZip}>
                  <Ionicons name="download-outline" size={20} color={COLORS.textInverse} />
                  <Text style={styles.submitBtnText}>Download ZIP & Share</Text>
                </TouchableOpacity>
              </View>
            )}

            {!isExporting && activeTab === 'email' && (
              <View style={styles.tabContent}>
                <Text style={styles.sectionHeading}>SMTP Configuration</Text>
                <Text style={styles.sectionDesc}>Emails are sent directly from your own email account. Your credentials are saved locally on this device only.</Text>
                
                <Text style={styles.label}>SMTP Server Host</Text>
                <TextInput
                  style={styles.input}
                  value={smtpHost}
                  onChangeText={setSmtpHost}
                  placeholder="e.g. smtp.gmail.com"
                />

                <Text style={styles.label}>SMTP Port</Text>
                <TextInput
                  style={styles.input}
                  value={smtpPort}
                  onChangeText={setSmtpPort}
                  keyboardType="numeric"
                  placeholder="e.g. 587 or 465"
                />

                <Text style={styles.label}>Username / Email Address</Text>
                <TextInput
                  style={styles.input}
                  value={smtpUser}
                  onChangeText={setSmtpUser}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="e.g. teacher@gmail.com"
                />

                <Text style={styles.label}>Password / App Password</Text>
                <TextInput
                  style={styles.input}
                  value={smtpPassword}
                  onChangeText={setSmtpPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  placeholder="Google App Password (recommended)"
                />

                <Text style={styles.sectionHeading}>Message Template</Text>
                <Text style={styles.label}>Email Subject</Text>
                <TextInput
                  style={styles.input}
                  value={emailSubject}
                  onChangeText={setEmailSubject}
                  placeholder="Subject line"
                />

                <Text style={styles.label}>Email Body</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={emailBody}
                  onChangeText={setEmailBody}
                  multiline
                  numberOfLines={5}
                  placeholder="Supports placeholders: {student_name}, {exam_name}, {score}"
                />

                <TouchableOpacity style={styles.submitButton} onPress={handleSendEmails}>
                  <Ionicons name="send-outline" size={20} color={COLORS.textInverse} />
                  <Text style={styles.submitBtnText}>Send to All (BCC Teacher)</Text>
                </TouchableOpacity>
              </View>
            )}

            {!isExporting && activeTab === 'whatsapp' && (
              <View style={styles.tabContent}>
                {/* Connection Box */}
                <View style={[styles.statusBox, waStatus === 'connected' ? styles.statusBoxConnected : styles.statusBoxDisconnected]}>
                  <View style={styles.statusHeader}>
                    <Ionicons 
                      name={waStatus === 'connected' ? 'checkmark-circle' : 'alert-circle'} 
                      size={24} 
                      color={waStatus === 'connected' ? COLORS.success : COLORS.danger} 
                    />
                    <Text style={styles.statusTitle}>
                      WhatsApp: {waStatus === 'connected' ? 'Connected' : waStatus === 'connecting' ? 'Connecting...' : 'Not Linked'}
                    </Text>
                  </View>
                  <Text style={styles.statusDesc}>
                    {waStatus === 'connected' 
                      ? 'GradeSense is linked to your WhatsApp Web session. Messages will be sent from your number.'
                      : 'You must link your WhatsApp account before you can broadcast student reports.'}
                  </Text>
                </View>

                {waStatus !== 'connected' && (
                  <View style={styles.pairingContainer}>
                    <Text style={styles.sectionHeading}>Link Device</Text>
                    
                    {/* Method 1: Phone Pairing */}
                    <View style={styles.pairMethodCard}>
                      <Text style={styles.pairMethodTitle}>Method 1: Pairing Code (No scan needed)</Text>
                      <Text style={styles.pairMethodDesc}>Enter your WhatsApp number to request an 8-character verification code to enter in your phone.</Text>
                      <View style={styles.row}>
                        <TextInput
                          style={[styles.input, styles.phoneInput]}
                          value={phoneNumber}
                          onChangeText={setPhoneNumber}
                          keyboardType="phone-pad"
                          placeholder="e.g. 919876543210 (with country code)"
                        />
                        <TouchableOpacity style={[styles.smallBtn, isPairingLoading && styles.disabledBtn]} onPress={generatePairingCode} disabled={isPairingLoading}>
                          {isPairingLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.smallBtnText}>Get Code</Text>}
                        </TouchableOpacity>
                      </View>
                      {waPairCode && (
                        <View style={styles.codeDisplay}>
                          <Text style={styles.codeText}>{waPairCode}</Text>
                        </View>
                      )}
                    </View>

                    {/* Method 2: QR Code */}
                    <View style={styles.pairMethodCard}>
                      <Text style={styles.pairMethodTitle}>Method 2: Scan QR Code</Text>
                      <Text style={styles.pairMethodDesc}>If viewing this on a tablet or computer, scan this code with your WhatsApp Link Device camera.</Text>
                      {waQrCode ? (
                        <View style={styles.qrContainer}>
                          <Image source={{ uri: waQrCode }} style={styles.qrImage} />
                          <TouchableOpacity style={styles.refreshBtn} onPress={fetchWhatsAppQR}>
                            <Ionicons name="refresh" size={16} color={COLORS.primary} />
                            <Text style={styles.refreshBtnText}>Refresh Code</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={styles.qrLoader}>
                          <ActivityIndicator size="small" color={COLORS.primary} />
                          <Text style={styles.qrLoaderText}>Waiting for QR code generation...</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}

                {waStatus === 'connected' && (
                  <View style={styles.broadcastContainer}>
                    <Text style={styles.sectionHeading}>Broadcast Messages</Text>
                    <Text style={styles.label}>Message Template</Text>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      value={waTemplate}
                      onChangeText={setWaTemplate}
                      multiline
                      numberOfLines={4}
                      placeholder="Template message"
                    />
                    <Text style={styles.hint}>Placeholders: {`{student_name}, {exam_name}, {score}, {report_link}`}</Text>

                    <TouchableOpacity style={[styles.submitButton, styles.whatsappBtn]} onPress={handleSendWhatsApp}>
                      <Ionicons name="logo-whatsapp" size={20} color={COLORS.textInverse} />
                      <Text style={styles.submitBtnText}>Broadcast results to all</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.logoutBtn} onPress={handleWhatsAppLogout}>
                      <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
                      <Text style={styles.logoutBtnText}>Logout WhatsApp Account</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: SCREEN_HEIGHT * 0.85,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
    maxWidth: SCREEN_WIDTH * 0.7,
  },
  closeBtn: {
    padding: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 10,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    gap: 6,
  },
  activeTab: {
    borderBottomColor: COLORS.primary,
  },
  tabText: {
    fontSize: 13,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  activeTabText: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  contentScroll: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  loadingContainer: {
    paddingVertical: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 15,
  },
  loadingText: {
    color: COLORS.textLight,
    fontSize: 14,
  },
  tabContent: {
    width: '100%',
  },
  infoCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 24,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 12,
    marginBottom: 8,
  },
  infoDesc: {
    fontSize: 13,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 18,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  whatsappBtn: {
    backgroundColor: '#25D366',
    marginTop: 10,
  },
  submitBtnText: {
    color: COLORS.textInverse,
    fontSize: 15,
    fontWeight: '600',
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
    marginTop: 15,
  },
  sectionDesc: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 15,
    lineHeight: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textLight,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 6,
    marginBottom: 15,
  },
  statusBox: {
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 20,
  },
  statusBoxConnected: {
    backgroundColor: COLORS.successLight,
    borderColor: COLORS.success,
  },
  statusBoxDisconnected: {
    backgroundColor: COLORS.errorLight,
    borderColor: COLORS.error,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  statusDesc: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  pairingContainer: {
    width: '100%',
  },
  pairMethodCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    padding: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 15,
  },
  pairMethodTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  pairMethodDesc: {
    fontSize: 11,
    color: COLORS.textLight,
    marginBottom: 12,
    lineHeight: 15,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  phoneInput: {
    flex: 1,
  },
  smallBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  smallBtnText: {
    color: COLORS.textInverse,
    fontSize: 13,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  codeDisplay: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  codeText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
    color: COLORS.primary,
  },
  qrContainer: {
    alignItems: 'center',
    marginTop: 10,
  },
  qrImage: {
    width: 180,
    height: 180,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
  },
  refreshBtnText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '500',
  },
  qrLoader: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 8,
  },
  qrLoaderText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  broadcastContainer: {
    width: '100%',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 30,
    paddingVertical: 10,
    gap: 6,
  },
  logoutBtnText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: '600',
  },
});
