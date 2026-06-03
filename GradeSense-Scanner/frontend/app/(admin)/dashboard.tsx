import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { COLORS } from '../../src/config';
import {
  cancelTeacherInvite,
  fetchAdminTeachers,
  fetchTeacherInvites,
  inviteTeachers,
  updateAdminTeacherLimit,
} from '../../src/api/adminPortal';
import { AdminTeacher, TeacherInvite } from '../../src/utils/adminPortalData';
import { useAuthStore } from '../../src/store/authStore';
import { PortalActionButton, PortalCard, PortalScreen, PortalState, SectionTitle, StatTile, StatusPill } from '../../src/components/portal/PortalKit';

export default function AdminDashboardScreen() {
  const token = useAuthStore(state => state.sessionToken);
  const [teachers, setTeachers] = useState<AdminTeacher[]>([]);
  const [invites, setInvites] = useState<TeacherInvite[]>([]);
  const [inviteEmails, setInviteEmails] = useState('');
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingInvites = useMemo(() => invites.filter(invite => invite.status === 'pending'), [invites]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setIsLoading(true);
      const [teacherRows, inviteRows] = await Promise.all([
        fetchAdminTeachers({ token }),
        fetchTeacherInvites({ token }),
      ]);
      setTeachers(teacherRows);
      setInvites(inviteRows);
      setLimitDrafts(Object.fromEntries(teacherRows.map(teacher => [teacher.id, String(teacher.paperLimit)])));
    } catch (err: any) {
      setError(err.message || 'Admin dashboard could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const submitInvites = async () => {
    if (!token) return;
    const emails = inviteEmails.split(/[,\n]/).map(email => email.trim()).filter(Boolean);
    if (!emails.length) {
      setError('Enter at least one teacher email.');
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      await inviteTeachers({ token }, { emails });
      setInviteEmails('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Unable to send teacher invites.');
    } finally {
      setIsSaving(false);
    }
  };

  const saveLimit = async (teacher: AdminTeacher) => {
    if (!token) return;
    const paperLimit = Number(limitDrafts[teacher.id]);
    if (!Number.isFinite(paperLimit) || paperLimit < 0) {
      setError('Paper limit must be a valid non-negative number.');
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      await updateAdminTeacherLimit({ token }, teacher.id, paperLimit);
      await load();
    } catch (err: any) {
      setError(err.message || 'Unable to update the teacher paper limit.');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelInvite = (invite: TeacherInvite) => {
    Alert.alert('Cancel invite?', `Cancel the invite for ${invite.email}?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Invite',
        style: 'destructive',
        onPress: async () => {
          if (!token) return;
          try {
            await cancelTeacherInvite({ token }, invite.id);
            await load();
          } catch (err: any) {
            setError(err.message || 'Unable to cancel invite.');
          }
        },
      },
    ]);
  };

  return (
    <PortalScreen title="Admin" subtitle="Teacher access and usage controls" onRefresh={load} refreshing={isLoading}>
      {isLoading && !teachers.length ? (
        <PortalState title="Loading admin data..." loading />
      ) : error ? (
        <PortalState title="Admin action needed" message={error} onRetry={load} />
      ) : null}

      <View style={styles.statsGrid}>
        <StatTile icon="people-outline" label="Teachers" value={teachers.length} />
        <StatTile icon="mail-outline" label="Pending" value={pendingInvites.length} />
      </View>

      <SectionTitle title="Invite Teachers" />
      <PortalCard style={styles.formCard}>
        <TextInput
          style={styles.input}
          value={inviteEmails}
          onChangeText={setInviteEmails}
          placeholder="teacher@school.com, second@school.com"
          placeholderTextColor={COLORS.textMuted}
          multiline
          autoCapitalize="none"
        />
        <PortalActionButton label="Send Invite" icon="send-outline" onPress={submitInvites} disabled={isSaving} />
      </PortalCard>

      <SectionTitle title="Pending Invites" />
      {pendingInvites.length ? pendingInvites.map(invite => (
        <PortalCard key={invite.id} style={styles.inviteCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{invite.email}</Text>
            <Text style={styles.meta}>{invite.name}</Text>
          </View>
          <PortalActionButton label="Cancel" icon="trash-outline" onPress={() => cancelInvite(invite)} tone="danger" />
        </PortalCard>
      )) : (
        <PortalState title="No pending invites" />
      )}

      <SectionTitle title="Teachers" />
      {teachers.length ? teachers.map(teacher => (
        <PortalCard key={teacher.id} style={styles.teacherCard}>
          <View style={styles.teacherHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{teacher.name}</Text>
              <Text style={styles.meta}>{teacher.email}</Text>
            </View>
            <StatusPill label={teacher.accountStatus} tone={teacher.accountStatus === 'active' ? 'success' : 'warning'} />
          </View>
          <View style={styles.limitRow}>
            <TextInput
              style={styles.limitInput}
              value={limitDrafts[teacher.id] ?? ''}
              onChangeText={value => setLimitDrafts(current => ({ ...current, [teacher.id]: value }))}
              keyboardType="number-pad"
            />
            <PortalActionButton label="Save Limit" icon="save-outline" onPress={() => saveLimit(teacher)} tone="secondary" disabled={isSaving} />
          </View>
        </PortalCard>
      )) : (
        <PortalState title="No teachers found" message="Teachers accepted through the webapp invite flow will appear here." />
      )}
    </PortalScreen>
  );
}

const styles = StyleSheet.create({
  statsGrid: { flexDirection: 'row', gap: 10 },
  formCard: { gap: 10 },
  input: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundDark,
  },
  inviteCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teacherCard: { gap: 12 },
  teacherHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  name: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  meta: { fontSize: 13, color: COLORS.textMuted, marginTop: 3 },
  limitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  limitInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundDark,
  },
});
