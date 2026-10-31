import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Temporary body for screens that aren't built yet. */
export function Placeholder({ title, children }: { title: string; children?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16, backgroundColor: '#ECEEEA' },
  title: { fontSize: 28, fontWeight: '600', color: '#1B2420', marginBottom: 16 },
});
