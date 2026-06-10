import { Dimensions, Platform, StatusBar, useWindowDimensions } from 'react-native';

const ANDROID_NAV_BAR_THRESHOLD = 36;

function estimateAndroidNavigationInset(windowHeight: number): number {
  if (Platform.OS !== 'android') return 0;

  const screenHeight = Dimensions.get('screen').height;
  const systemBars = Math.max(0, screenHeight - windowHeight);
  const statusBar = StatusBar.currentHeight ?? 0;
  const possibleBottomBar = Math.max(0, systemBars - statusBar);

  return possibleBottomBar >= ANDROID_NAV_BAR_THRESHOLD ? possibleBottomBar : 0;
}

export function hardwareAwareBottomInset(
  bottomInset: number,
  minimum = 0,
  windowHeight = Dimensions.get('window').height
): number {
  const safeInset = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0;
  const estimatedSystemInset = safeInset > 0 ? safeInset : estimateAndroidNavigationInset(windowHeight);
  return Math.max(estimatedSystemInset, minimum);
}

export function useHardwareAwareBottomInset(bottomInset: number, minimum = 0): number {
  const window = useWindowDimensions();
  return hardwareAwareBottomInset(bottomInset, minimum, window.height);
}
