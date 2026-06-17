import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const NOTIFIED_KEY = 'gradesense.notifiedCompletedExamIds';
const ACTIVE_PROGRESS_KEY = 'gradesense.activeGradingProgressNotifications';
const GRADING_PROGRESS_CHANNEL_ID = 'grading-progress';
const GRADING_COMPLETE_CHANNEL_ID = 'grading-complete';
const completionNotificationInFlight = new Set<string>();

type ActiveProgressNotifications = Record<string, string>;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
  } as Notifications.NotificationBehavior),
});

async function readNotifiedExamIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(NOTIFIED_KEY);
  if (!raw) return new Set();

  try {
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

async function markNotified(examId: string) {
  const ids = await readNotifiedExamIds();
  ids.add(examId);
  await AsyncStorage.setItem(NOTIFIED_KEY, JSON.stringify(Array.from(ids)));
}

async function readActiveProgressNotifications(): Promise<ActiveProgressNotifications> {
  const raw = await AsyncStorage.getItem(ACTIVE_PROGRESS_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function rememberActiveProgressNotification(examId: string, notificationId: string) {
  const active = await readActiveProgressNotifications();
  active[examId] = notificationId;
  await AsyncStorage.setItem(ACTIVE_PROGRESS_KEY, JSON.stringify(active));
}

async function forgetActiveProgressNotification(examId: string) {
  const active = await readActiveProgressNotifications();
  if (!active[examId]) return;

  delete active[examId];
  await AsyncStorage.setItem(ACTIVE_PROGRESS_KEY, JSON.stringify(active));
}

function progressNotificationId(examId: string) {
  return `gradesense-grading-progress-${examId}`;
}

function completionNotificationId(examId: string) {
  return `gradesense-grading-complete-${examId}`;
}

function normalizeProgress(processed: number, total: number, percent?: number) {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.round(total) : 0;
  const safeProcessed = Number.isFinite(processed)
    ? Math.max(0, Math.min(Math.round(processed), safeTotal || Math.round(processed)))
    : 0;
  const calculatedPercent = safeTotal > 0 ? Math.round((safeProcessed / safeTotal) * 100) : 0;
  const safePercent = Number.isFinite(percent ?? NaN)
    ? Math.max(0, Math.min(100, Math.round(percent ?? calculatedPercent)))
    : calculatedPercent;

  return { processed: safeProcessed, total: safeTotal, percent: safePercent };
}

async function hasNotificationPermission() {
  await ensureGradingNotificationReady();
  const permissions = await Notifications.getPermissionsAsync();
  return permissions.granted;
}

export async function clearGradingProgressNotification(examId: string): Promise<void> {
  const normalizedExamId = String(examId);
  const active = await readActiveProgressNotifications();
  const notificationIds = new Set([
    active[normalizedExamId],
    progressNotificationId(normalizedExamId),
  ].filter(Boolean) as string[]);

  await Promise.all(
    Array.from(notificationIds).map(notificationId =>
      Notifications.dismissNotificationAsync(notificationId).catch(() => {})
    )
  );
  await forgetActiveProgressNotification(normalizedExamId);
}

export async function ensureGradingNotificationReady(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(GRADING_PROGRESS_CHANNEL_ID, {
      name: 'Grading progress',
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: [0],
      lightColor: '#FF6B35',
      sound: null,
    });

    await Notifications.setNotificationChannelAsync(GRADING_COMPLETE_CHANNEL_ID, {
      name: 'Grading complete',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF6B35',
      sound: 'default',
    });
  }

  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.granted) return;

  await Notifications.requestPermissionsAsync();
}

export async function notifyGradingProgress(
  examId: string,
  examName: string,
  processed: number,
  total: number,
  percent?: number,
): Promise<void> {
  const normalizedExamId = String(examId);
  const progress = normalizeProgress(processed, total, percent);
  if (progress.total > 0 && progress.processed >= progress.total) {
    await clearGradingProgressNotification(normalizedExamId);
    return;
  }

  const granted = await hasNotificationPermission();
  if (!granted) return;

  const notificationId = progressNotificationId(normalizedExamId);
  await Notifications.scheduleNotificationAsync({
    identifier: notificationId,
    content: {
      title: 'GradeSense is grading',
      body: `${examName || 'Your exam'}: ${progress.processed}/${progress.total || '?'} papers checked (${progress.percent}%).`,
      data: { examId: normalizedExamId, type: 'grading-progress' },
      color: '#FF6B35',
      autoDismiss: false,
      sticky: true,
      sound: false,
    },
    trigger: Platform.OS === 'android' ? { channelId: GRADING_PROGRESS_CHANNEL_ID } : null,
  });
  await rememberActiveProgressNotification(normalizedExamId, notificationId);
}

export async function notifyGradingCompleteOnce(examId: string, examName: string): Promise<void> {
  const normalizedExamId = String(examId);
  if (completionNotificationInFlight.has(normalizedExamId)) return;

  completionNotificationInFlight.add(normalizedExamId);
  try {
    await clearGradingProgressNotification(normalizedExamId);

    const notified = await readNotifiedExamIds();
    if (notified.has(normalizedExamId)) return;

    const granted = await hasNotificationPermission();
    if (!granted) return;

    await markNotified(normalizedExamId);
    await Notifications.scheduleNotificationAsync({
      identifier: completionNotificationId(normalizedExamId),
      content: {
        title: 'GradeSense grading is complete',
        body: `${examName || 'Your exam'} is ready to review.`,
        data: { examId: normalizedExamId, type: 'grading-complete' },
        color: '#FF6B35',
        sound: 'default',
      },
      trigger: Platform.OS === 'android' ? { channelId: GRADING_COMPLETE_CHANNEL_ID } : null,
    });
  } finally {
    completionNotificationInFlight.delete(normalizedExamId);
  }
}
