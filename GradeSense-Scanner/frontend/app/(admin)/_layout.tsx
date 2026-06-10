import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/config';
import { createFloatingTabBarOptions } from '../../src/components/navigation/floatingTabBar';

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
        ...createFloatingTabBarOptions(11),
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
