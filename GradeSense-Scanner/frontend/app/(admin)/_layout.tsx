import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/config';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function TabIcon({ name, color, focused }: { name: IconName; color: string; focused: boolean }) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Ionicons name={name} size={22} color={color} />
    </View>
  );
}

export default function AdminTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          paddingBottom: Platform.OS === 'ios' ? 24 : 8,
          paddingTop: 8,
          height: Platform.OS === 'ios' ? 90 : 66,
          elevation: 10,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 1 },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Admin', tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'people' : 'people-outline'} color={color} focused={focused} /> }} />
      <Tabs.Screen name="feedback" options={{ title: 'Feedback', tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'chatbox-ellipses' : 'chatbox-ellipses-outline'} color={color} focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'person-circle' : 'person-circle-outline'} color={color} focused={focused} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: { width: 40, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  iconWrapActive: { backgroundColor: `${COLORS.primary}18` },
});
