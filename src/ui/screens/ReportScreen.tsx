import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RotateCcw, Trash2 } from 'lucide-react-native';
import React from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, engine, outbox } from '../../services';
import { Button, Card, Notice, ProgressBar, StatePill, useButtonIconColor } from '../components';
import { confirm } from '../confirm';
import { describeReport, formatBytes, timeAgo } from '../describe';
import { useEngine, useNow, useOutbox } from '../hooks';
import type { RootStack } from '../navigation';
import { makeStyles, radius, space, useTheme } from '../theme';

type Props = NativeStackScreenProps<RootStack, 'Report'>;

export function ReportScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { state, type } = useTheme();
  const primaryIcon = useButtonIconColor('primary');
  const dangerIcon = useButtonIconColor('danger');
  const reports = useOutbox();
  const snap = useEngine();
  const now = useNow();
  const report = reports.find(r => r.id === route.params.id);

  if (!report) {
    return (
      <View style={styles.screen}>
        <Notice title="This report is no longer on this phone" body="It was removed, or the app was reset." action={<Button label="Back to reports" onPress={() => navigation.goBack()} />} />
      </View>
    );
  }

  const view = describeReport(report, snap, now);
  const delivered = report.status === 'delivered';

  async function confirmDelete(id: string) {
    const ok = await confirm({
      title: 'Delete this report from the phone?',
      message: 'It hasn’t reached the server. Deleting it here means it is gone for good.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      destructive: true,
    });
    if (!ok) return;
    navigation.goBack();
    await outbox.remove(id);
    api.discardPartial(id);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}>
      <View style={[styles.status, { backgroundColor: state[view.tone].bg }]}>
        <StatePill tone={view.tone} label={view.label} />
        <Text style={[type.body, styles.statusDetail]}>{view.detail}</Text>
        {view.progress !== undefined && !delivered && (
          <View style={styles.statusProgress}>
            <ProgressBar value={view.progress} tone={view.tone} height={6} />
          </View>
        )}
        {report.status === 'blocked' && (
          <View style={styles.actions}>
            <Button label="Try again" kind="primary" icon={<RotateCcw size={18} color={primaryIcon} />} onPress={() => engine.retryNow(report.id)} style={styles.action} />
            <Button label="Delete" kind="danger" icon={<Trash2 size={18} color={dangerIcon} />} onPress={() => confirmDelete(report.id)} style={styles.action} />
          </View>
        )}
        {report.status === 'waiting' && report.lastFailure && snap.online && (
          <Button label="Try now" onPress={() => engine.retryNow()} style={styles.tryNow} />
        )}
      </View>

      <Text style={[type.caption, styles.heading]}>Description</Text>
      <Text style={type.body}>{report.description}</Text>

      <Text style={[type.caption, styles.heading]}>Photos</Text>
      <Card>
        {report.images.map((img, i) => {
          const uri = delivered ? api.imageUrl(report.id, i) : `file://${(img.prepared ?? img.source).path}`;
          return (
            <View key={i} style={[styles.photo, i > 0 && styles.photoDivider]}>
              <Image source={{ uri }} style={styles.photoThumb} resizeMethod="resize" />
              <View style={styles.photoBody}>
                <Text style={type.smallStrong}>Photo {i + 1}</Text>
                <Text style={type.data}>
                  {img.prepared
                    ? `${formatBytes(img.source.bytes)} original → ${formatBytes(img.prepared.bytes)} to send`
                    : `${formatBytes(img.source.bytes)} original, not prepared yet`}
                </Text>
                {img.prepared && (
                  <Text style={type.data}>
                    {img.prepared.width} × {img.prepared.height}
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </Card>

      <Text style={[type.caption, styles.heading]}>History</Text>
      <Card style={styles.history}>
        <Row label="Saved on this phone" value={timeAgo(report.createdAt, now)} />
        <Row label="Attempts" value={String(report.attempts)} />
        {report.lastFailure && <Row label="Last problem" value={`${report.lastFailure.message} (${timeAgo(report.lastFailure.at, now)})`} />}
        {report.deliveredAt && <Row label="Confirmed by server" value={timeAgo(report.deliveredAt, now)} />}
        <Row label="Report ID" value={report.id} mono />
      </Card>
    </ScrollView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const styles = useStyles();
  const { type } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[type.small, styles.rowLabel]}>{label}</Text>
      <Text style={[mono ? type.data : type.smallStrong, styles.rowValue]} selectable={mono}>
        {value}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(({ color }) => ({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.lg },
  status: { borderRadius: radius.lg, padding: space.lg },
  statusDetail: { marginTop: space.sm },
  statusProgress: { marginTop: space.md },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  action: { flex: 1 },
  tryNow: { alignSelf: 'flex-start', marginTop: space.md, minHeight: 40 },
  heading: { marginTop: space.xl, marginBottom: space.sm },
  photo: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  photoDivider: { borderTopWidth: 1, borderTopColor: color.border },
  photoThumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: color.sunken },
  photoBody: { flex: 1 },
  history: { padding: space.md, gap: 6 },
  row: { flexDirection: 'row', gap: space.md },
  rowLabel: { width: 150 },
  rowValue: { flex: 1 },
}));
