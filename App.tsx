import React, { useEffect, useState } from 'react';
import { Appearance, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { boot } from './src/services';
import { useSettings } from './src/ui/hooks';
import { Navigation } from './src/ui/navigation';
import { brand, font, space, ThemeProvider, useTheme } from './src/ui/theme';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { appearance } = useSettings();

  useEffect(() => {
    boot()
      .then(() => setReady(true))
      .catch(e => setError((e as Error).message));
  }, []);

  // Overriding at the OS level also themes native UI (alerts, pickers), not just our screens.
  useEffect(() => {
    Appearance.setColorScheme(appearance === 'system' ? 'unspecified' : appearance);
  }, [appearance]);

  return (
    <SafeAreaProvider>
      <ThemeProvider>{ready ? <Main /> : <Launch error={error} />}</ThemeProvider>
    </SafeAreaProvider>
  );
}

function Main() {
  const { scheme } = useTheme();
  return (
    <>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <Navigation />
    </>
  );
}

/** Shown for the half second it takes to load the outbox from disk. */
function Launch({ error }: { error: string | null }) {
  return (
    <View style={styles.launch}>
      <StatusBar barStyle="light-content" />
      <View style={styles.below}>
        <Text style={styles.name}>FieldSync</Text>
        {error && (
          <View style={styles.error}>
            <Text style={styles.errorTitle}>Couldn’t open the reports stored on this phone</Text>
            <Text style={styles.errorBody}>{error}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  launch: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: brand.ink },
  below: { alignItems: 'center' },
  name: { fontFamily: font.semibold, fontSize: 22, letterSpacing: -0.2, color: brand.paper },
  error: { marginTop: space.xl, alignItems: 'center', gap: space.xs },
  errorTitle: { fontFamily: font.semibold, fontSize: 16, color: brand.greenBright, textAlign: 'center' },
  errorBody: { fontFamily: font.regular, fontSize: 14, color: brand.paper, textAlign: 'center' },
});
