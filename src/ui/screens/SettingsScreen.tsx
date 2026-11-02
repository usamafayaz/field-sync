import React, { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, resetDevice, settings } from '../../services';
import type { Appearance } from '../../settings';
import { Button, Card } from '../components';
import { confirm } from '../confirm';
import { useDraft, useOutbox, useSettings } from '../hooks';
import { font, makeStyles, radius, space, useTheme } from '../theme';

const APPEARANCES: Array<{ value: Appearance; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const RESET_EFFECTS = [
  'Deletes every report on this phone, sent or not',
  'Deletes the draft and all photos the app has stored',
  'Stops any upload in progress',
  'Keeps everything already on the server, and these settings',
];

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { color, state, type } = useTheme();
  const current = useSettings();
  const reports = useOutbox();
  const draft = useDraft();
  const [url, setUrl] = useState(current.serverUrl);
  const [check, setCheck] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'fail'; text?: string }>({ kind: 'idle' });
  const [resetting, setResetting] = useState(false);

  const unsent = reports.filter(r => r.status !== 'delivered').length;
  const hasDraft = draft.images.length > 0 || draft.description.trim().length > 0;

  async function saveAndCheck() {
    await settings.setServerUrl(url);
    setCheck({ kind: 'busy' });
    try {
      const list = await api.listReports();
      setCheck({ kind: 'ok', text: `Connected. The server holds ${list.length} ${list.length === 1 ? 'report' : 'reports'}.` });
    } catch (e) {
      setCheck({ kind: 'fail', text: (e as Error).message });
    }
  }

  async function confirmReset() {
    const losing = [
      unsent > 0 ? `${unsent} ${unsent === 1 ? 'report that hasn’t' : 'reports that haven’t'} reached the server` : null,
      hasDraft ? 'the report you’re writing' : null,
    ].filter(Boolean);
    const ok = await confirm({
      title: 'Start over on this phone?',
      message:
        (losing.length ? `This permanently deletes ${losing.join(' and ')}. ` : 'Nothing unsent will be lost. ') +
        'Reports already on the server stay there.',
      confirmLabel: losing.length ? 'Delete and start over' : 'Start over',
      destructive: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      await resetDevice();
    } finally {
      setResetting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top }]} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          <Text style={type.display}>Settings</Text>
        </View>

        <Text style={[type.heading, styles.h]}>Appearance</Text>
        <Card style={styles.card}>
          <View style={styles.segmented} accessibilityRole="radiogroup">
            {APPEARANCES.map(option => {
              const selected = current.appearance === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => settings.setAppearance(option.value)}
                  style={[styles.segment, selected && styles.segmentOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}>
                  <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={type.small}>Light reads best in sunlight. Dark is easier in stairwells and at night.</Text>
        </Card>

        <Text style={[type.heading, styles.h]}>Server</Text>
        <Card style={styles.card}>
          <Text style={type.small}>Address of the FieldSync server. On the Android emulator, 10.0.2.2 is your computer.</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            selectionColor={state.moving.dot}
            placeholderTextColor={color.textFaint}
            style={styles.input}
            accessibilityLabel="Server address"
          />
          <Button label="Save and check connection" onPress={saveAndCheck} busy={check.kind === 'busy'} />
          {check.text && <Text style={[type.small, check.kind === 'ok' ? styles.ok : styles.fail]}>{check.text}</Text>}
        </Card>

        <Text style={[type.heading, styles.h]}>Start over</Text>
        <Card style={styles.card}>
          <Text style={type.body}>Clears this phone back to a fresh install.</Text>
          <View style={styles.effects}>
            {RESET_EFFECTS.map(effect => (
              <View key={effect} style={styles.effect}>
                <Text style={type.small}>•</Text>
                <Text style={[type.small, styles.effectText]}>{effect}</Text>
              </View>
            ))}
          </View>
          {unsent > 0 && (
            <Text style={[type.smallStrong, styles.fail]}>
              {unsent} {unsent === 1 ? 'report hasn’t' : 'reports haven’t'} reached the server yet and would be lost.
            </Text>
          )}
          <Button label="Start over on this phone" kind="danger" onPress={confirmReset} busy={resetting} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(({ color, state }) => ({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xxl },
  top: { paddingHorizontal: space.lg, paddingTop: space.lg },
  h: { marginTop: space.xl, marginBottom: space.sm, paddingHorizontal: space.lg },
  card: { marginHorizontal: space.lg, padding: space.lg, gap: space.md },
  segmented: { flexDirection: 'row', backgroundColor: color.sunken, borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm + 1 },
  segmentOn: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderStrong },
  segmentText: { fontFamily: font.medium, fontSize: 14, color: color.textMuted },
  segmentTextOn: { fontFamily: font.semibold, color: color.text },
  input: {
    backgroundColor: color.field,
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 48,
    fontFamily: font.mono,
    fontSize: 15,
    color: color.text,
  },
  ok: { color: state.server.fg },
  fail: { color: state.needs.fg },
  effects: { gap: space.xs },
  effect: { flexDirection: 'row', gap: space.sm },
  effectText: { flex: 1 },
}));
