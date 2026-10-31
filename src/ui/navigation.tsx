import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Database, Inbox, SlidersHorizontal } from 'lucide-react-native';
import React from 'react';
import { ComposeScreen } from './screens/ComposeScreen';
import { OutboxScreen } from './screens/OutboxScreen';
import { ReportScreen } from './screens/ReportScreen';
import { ServerScreen } from './screens/ServerScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export type RootStack = {
  Tabs: undefined;
  Compose: undefined;
  Report: { id: string };
};

const Stack = createNativeStackNavigator<RootStack>();
const Tab = createBottomTabNavigator();

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen
        name="Outbox"
        component={OutboxScreen}
        options={{ title: 'Reports', tabBarIcon: ({ color, size }) => <Inbox color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Server"
        component={ServerScreen}
        options={{ title: 'On server', tabBarIcon: ({ color, size }) => <Database color={color} size={size} /> }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarIcon: ({ color, size }) => <SlidersHorizontal color={color} size={size} /> }}
      />
    </Tab.Navigator>
  );
}

export function Navigation() {
  return (
    <NavigationContainer theme={DefaultTheme}>
      <Stack.Navigator>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Compose" component={ComposeScreen} options={{ title: 'New report', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="Report" component={ReportScreen} options={{ title: 'Report' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
