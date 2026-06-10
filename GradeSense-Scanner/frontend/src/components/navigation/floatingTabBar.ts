import { Platform } from 'react-native';
import { COLORS } from '../../config';
import { hardwareAwareBottomInset } from '../../utils/safeArea';

export function createFloatingTabBarOptions(labelFontSize: number, bottomInset = 0) {
  const tabBottom = Platform.OS === 'ios'
    ? Math.max(bottomInset, 14)
    : hardwareAwareBottomInset(bottomInset, 14);
  const tabHeight = Platform.OS === 'ios' ? 78 : 66;

  return {
    tabBarStyle: {
      position: 'absolute' as const,
      left: 14,
      right: 14,
      bottom: tabBottom,
      height: tabHeight,
      paddingBottom: Platform.OS === 'ios' ? 18 : 10,
      paddingTop: 8,
      backgroundColor: COLORS.surface,
      borderColor: COLORS.borderLight,
      borderRadius: 24,
      borderTopWidth: 0,
      borderWidth: 1,
      elevation: 14,
      shadowColor: '#111827',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.12,
      shadowRadius: 18,
    },
    tabBarLabelStyle: {
      fontSize: labelFontSize,
      fontWeight: '700' as const,
      marginTop: 1,
    },
    tabBarIconStyle: {
      marginTop: 2,
    },
    sceneStyle: {
      paddingBottom: tabBottom + tabHeight + 14,
    },
  };
}
