import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AlertTriangle, Camera, CheckCircle2, ChevronRight, CloudUpload, Smartphone, WifiOff } from 'lucide-react-native';
import React, { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { EngineSnapshot } from '../../delivery/engine';
import type { LocalReport } from '../../delivery/types';
import { api, engine, outbox } from '../../services';
import { Button, ProgressBar, Section, StatePill } from '../components';
import { confirm } from '../confirm';
import { describeOutbox, describeReport, formatBytes } from '../describe';
import { useDraft, useEngine, useNow, useOutbox } from '../hooks';
import type { RootStack } from '../navigation';
import { font, makeStyles, radius, space, useTheme } from '../theme';

export function OutboxScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { color, state, type } = useTheme();
  const reports = useOutbox();
  const snap = useEngine();
  const draft = useDraft();
  const now = useNow();

  const headline = describeOutbox(reports, snap, now);
  const tone = state[headline.tone];
  const groups = useMemo(() => {
    const newestFirst = (a: LocalReport, b: LocalReport) => b.createdAt - a.createdAt;
    return {
      blocked: reports.filter(r => r.status === 'blocked').sort(newestFirst),
      // Oldest first: that is the order they will send in.
      waiting: reports.filter(r => r.status === 'waiting'),
      delivered: reports.filter(r => r.status === 'delivered').sort((a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0)),
    };
  }, [reports]);

  const draftInProgress = draft.images.length > 0 || draft.description.trim().length > 0;
  const HeadIcon = { needs: AlertTriangle, phone: snap.online ? Smartphone : WifiOff, moving: CloudUpload, server: CheckCircle2 }[headline.tone];
  const open = (id: string) => nav.navigate('Report', { id });

  async function clearDelivered(delivered: LocalReport[]) {
    const count = delivered.length === 1 ? 'this report' : `these ${delivered.length} reports`;
    const ok = await confirm({
      title: 'Clear confirmed reports?',
      message: `The server already has ${count}. Clearing only removes them from this list and frees space on the phone.`,
      confirmLabel: 'Clear',
    });
    if (ok) await Promise.all(delivered.map(r => outbox.remove(r.id)));
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.top}>
          <Text style={type.display}>Reports</Text>
          <ConnectionTag online={snap.online} />
        </View>

        <View style={[styles.headline, { backgroundColor: tone.bg }]} accessibilityLiveRegion="polite">
          <View style={styles.headlineRow}>
            <HeadIcon size={22} color={tone.fg} strokeWidth={2.2} />
            <Text style={[type.title, styles.headlineTitle, { color: tone.fg }]}>{headline.title}</Text>
          </View>
          <Text style={[type.small, styles.headlineBody]}>{headline.body}</Text>
          {headline.progress !== undefined && (
            <View style={styles.headlineProgress}>
              <ProgressBar value={headline.progress} tone={headline.tone} height={6} />
            </View>
          )}
          {headline.canRetryNow && <Button label="Try now" onPress={() => engine.retryNow()} style={styles.headlineAction} />}
        </View>

        {groups.blocked.length > 0 && (
          <Section title="Needs you">
            <List reports={groups.blocked} snap={snap} now={now} onOpen={open} />
          </Section>
        )}
        {groups.waiting.length > 0 && (
          <Section title="On this phone" aside={<Text style={type.caption}>Sends in this order</Text>}>
            <List reports={groups.waiting} snap={snap} now={now} onOpen={open} />
          </Section>
        )}
        {groups.delivered.length > 0 && (
          <Section
            title="Recently confirmed"
            aside={
              <Pressable hitSlop={12} onPress={() => clearDelivered(groups.delivered)} accessibilityRole="button" accessibilityLabel="Clear confirmed reports">
                <Text style={styles.link}>Clear</Text>
              </Pressable>
            }>
            <List reports={groups.delivered} snap={snap} now={now} onOpen={open} />
          </Section>
        )}
        {reports.length === 0 && (
          <Text style={[type.small, styles.firstRun]}>
            Each report needs a short description and one to five photos. Save it here with or without signal. It will
            send by itself, and this screen will tell you when the server has it.
          </Text>
        )}
      </ScrollView>

      <View style={styles.dock}>
        <Button
          kind="primary"
          label={draftInProgress ? `Continue draft (${draft.images.length} of 5 photos)` : 'New report'}
          icon={<Camera size={20} color={color.onAccent} strokeWidth={2.2} />}
          onPress={() => nav.navigate('Compose')}
          style={styles.dockButton}
        />
      </View>
    </View>
  );
}

function ConnectionTag({ online }: { online: boolean }) {
  const styles = useStyles();
  const { color } = useTheme();
  return (
    <View style={[styles.conn, !online && styles.connOff]}>
      {!online && <WifiOff size={14} color={color.bg} strokeWidth={2.4} />}
      <Text style={[styles.connText, !online && styles.connTextOff]}>{online ? 'Connected' : 'No signal'}</Text>
    </View>
  );
}

function List({ reports, snap, now, onOpen }: { reports: LocalReport[]; snap: EngineSnapshot; now: number; onOpen: (id: string) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.list}>
      {reports.map((r, i) => (
        <ReportRow key={r.id} report={r} snap={snap} now={now} onPress={() => onOpen(r.id)} last={i === reports.length - 1} />
      ))}
    </View>
  );
}

function ReportRow({ report, snap, now, onPress, last }: { report: LocalReport; snap: EngineSnapshot; now: number; onPress: () => void; last: boolean }) {
  const styles = useStyles();
  const { color, type } = useTheme();
  const view = describeReport(report, snap, now);
  const first = report.images[0];
  // Delivered reports have no local files left, so their thumbnail comes from the server.
  const uri =
    report.status === 'delivered'
      ? snap.online
        ? api.imageUrl(report.id, 0)
        : undefined
      : `file://${(first?.prepared ?? first?.source)?.path}`;
  const bytes = report.images.reduce((s, i) => s + (i.prepared?.bytes ?? i.source.bytes), 0);

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: color.ripple }}
      style={[styles.row, !last && styles.rowDivider]}
      accessibilityRole="button"
      accessibilityLabel={`${report.description}. ${view.label}. ${view.detail}`}>
      <View style={styles.thumb}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMethod="resize" resizeMode="cover" /> : null}
        <View style={styles.thumbCount}>
          <Text style={styles.thumbCountText}>{report.images.length}</Text>
        </View>
      </View>
      <View style={styles.rowBody}>
        <Text style={type.bodyStrong} numberOfLines={1}>
          {report.description}
        </Text>
        <View style={styles.rowMeta}>
          <StatePill tone={view.tone} label={view.label} />
          <Text style={type.data}>{formatBytes(bytes)}</Text>
        </View>
        <Text style={type.caption} numberOfLines={2}>
          {view.detail}
        </Text>
        {view.progress !== undefined && report.status === 'waiting' && (
          <View style={styles.rowProgress}>
            <ProgressBar value={view.progress} tone={view.tone} />
          </View>
        )}
      </View>
      <ChevronRight size={20} color={color.textFaint} />
    </Pressable>
  );
}

const useStyles = makeStyles(({ color }) => ({
  screen: { flex: 1, backgroundColor: color.bg },
  scroll: { paddingBottom: 120 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
  conn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: color.sunken },
  connOff: { backgroundColor: color.text },
  connText: { fontFamily: font.medium, fontSize: 13, color: color.textMuted },
  connTextOff: { color: color.bg },
  headline: { marginHorizontal: space.lg, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 2 },
  headlineTitle: { flex: 1 },
  headlineBody: { color: color.text },
  headlineProgress: { marginTop: space.md },
  headlineAction: { alignSelf: 'flex-start', marginTop: space.md, minHeight: 40 },
  list: { marginHorizontal: space.lg, backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 88 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: color.border },
  rowBody: { flex: 1, gap: space.xs },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowProgress: { marginTop: space.xs },
  thumb: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: color.sunken, overflow: 'hidden' },
  thumbCount: { position: 'absolute', right: 4, bottom: 4, minWidth: 20, paddingHorizontal: 5, height: 20, borderRadius: 10, backgroundColor: color.overlay, alignItems: 'center', justifyContent: 'center' },
  thumbCountText: { fontFamily: font.monoMedium, fontSize: 11, color: color.onOverlay },
  link: { fontFamily: font.medium, fontSize: 14, color: color.link },
  firstRun: { marginHorizontal: space.lg, marginTop: space.lg, maxWidth: 520 },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: color.bg, borderTopWidth: 1, borderTopColor: color.border },
  dockButton: { minHeight: 56 },
}));
