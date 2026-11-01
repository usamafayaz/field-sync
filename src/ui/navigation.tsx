import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Database, Inbox, SlidersHorizontal } from 'lucide-react-native';
import React, { useMemo } from 'react';
import { useOutbox } from './hooks';
import { ComposeScreen } from './screens/ComposeScreen';
import { OutboxScreen } from './screens/OutboxScreen';
import { ReportScreen } from './screens/ReportScreen';
import { ServerScreen } from './screens/ServerScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { font, useTheme } from './theme';

export type RootStack = {
  Tabs: undefined;
  Compose: undefined;
  Report: { id: string };
};

const Stack = createNativeStackNavigator<RootStack>();
const Tab = createBottomTabNavigator();

type TabIconProps = { color: string; size: number };
const ReportsIcon = ({ color, size }: TabIconProps) => <Inbox color={color} size={size} />;
const ServerIcon = ({ color, size }: TabIconProps) => <Database color={color} size={size} />;
const SettingsIcon = ({ color, size }: TabIconProps) => <SlidersHorizontal color={color} size={size} />;

function Tabs() {
  const { color, state } = useTheme();
  const reports = useOutbox();
  const unsent = reports.filter(r => r.status !== 'delivered').length;
  const needsYou = reports.some(r => r.status === 'blocked');
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.text,
        tabBarInactiveTintColor: color.textFaint,
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 12 },
      }}>
      <Tab.Screen
        name="Outbox"
        component={OutboxScreen}
        options={{
          title: 'Reports',
          tabBarIcon: ReportsIcon,
          tabBarBadge: unsent > 0 ? unsent : undefined,
          tabBarBadgeStyle: {
            backgroundColor: needsYou ? state.needs.dot : state.phone.dot,
            color: color.onBadge,
            fontFamily: font.semibold,
            fontSize: 11,
          },
        }}
      />
      <Tab.Screen name="Server" component={ServerScreen} options={{ title: 'On server', tabBarIcon: ServerIcon }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarIcon: SettingsIcon }} />
    </Tab.Navigator>
  );
}

export function Navigation() {
  const { scheme, color } = useTheme();
  const navTheme = useMemo<NavTheme>(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, background: color.bg, card: color.surface, text: color.text, border: color.border, primary: color.text },
    };
  }, [scheme, color]);

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: color.bg },
          headerShadowVisible: false,
          headerTintColor: color.text,
          headerTitleStyle: { fontFamily: font.semibold, fontSize: 17 },
          contentStyle: { backgroundColor: color.bg },
        }}>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Compose" component={ComposeScreen} options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="Report" component={ReportScreen} options={{ title: 'Report' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
