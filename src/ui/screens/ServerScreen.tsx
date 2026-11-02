import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight, ServerOff } from 'lucide-react-native';
import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ServerReport } from '../../delivery/types';
import { api } from '../../services';
import { Button, Notice } from '../components';
import { formatBytes, timeAgo } from '../describe';
import { useNow, useServerReports, useSettings } from '../hooks';
import type { RootStack } from '../navigation';
import { makeStyles, radius, space, useTheme } from '../theme';

export function ServerScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { color, type } = useTheme();
  const { state: list, reload } = useServerReports();
  const { serverUrl } = useSettings();
  const now = useNow(15_000);

  // Every visit asks the server again; this tab never shows the phone's own idea of what was sent.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const header = (
    <View style={styles.top}>
      <Text style={type.display}>On the server</Text>
      <Text style={[type.small, styles.source]}>
        Fetched live from <Text style={type.data}>{serverUrl.replace(/^https?:\/\//, '')}</Text>
      </Text>
      {list.kind === 'loaded' && list.error && (
        <View style={styles.stale}>
          <Text style={[type.small, styles.staleText]}>
            Couldn’t refresh: {list.error} Showing what the server returned {timeAgo(list.at, now)}.
          </Text>
        </View>
      )}
    </View>
  );

  if (list.kind === 'loading') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={color.textMuted} />
          <Text style={type.small}>Asking the server…</Text>
        </View>
      </View>
    );
  }

  if (list.kind === 'failed') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {header}
        <Notice
          icon={<ServerOff size={32} color={color.textMuted} />}
          title="Can’t reach the server"
          body={`${list.error} This list only shows what the server confirms, so there’s nothing to show until it answers. Reports on this phone are unaffected.`}
          action={<Button label="Try again" onPress={reload} />}
        />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <FlatList
        data={list.reports}
        keyExtractor={r => r.id}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={reload} colors={[color.text]} progressBackgroundColor={color.surface} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Notice title="The server has no reports yet" body="Reports appear here once the server has confirmed every photo in them." />}
        renderItem={({ item, index }) => (
          <ServerRow report={item} now={now} first={index === 0} last={index === list.reports.length - 1} onPress={() => nav.navigate('ServerReport', { report: item })} />
        )}
      />
    </View>
  );
}

function ServerRow({ report, now, first, last, onPress }: { report: ServerReport; now: number; first: boolean; last: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { color, type } = useTheme();
  const bytes = report.images.reduce((s, i) => s + i.size, 0);
  const photos = `${report.images.length} ${report.images.length === 1 ? 'photo' : 'photos'}`;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: color.ripple }}
      style={[styles.row, first && styles.rowFirst, last && styles.rowLast, !last && styles.rowDivider]}>
      <Image source={{ uri: api.imageUrl(report.id, 0) }} style={styles.thumb} resizeMethod="resize" />
      <View style={styles.rowBody}>
        <Text style={type.bodyStrong} numberOfLines={2}>
          {report.description}
        </Text>
        <Text style={type.caption}>
          {photos} · received {timeAgo(Date.parse(report.receivedAt), now)}
        </Text>
        <Text style={type.data}>
          {formatBytes(bytes)} total, largest {formatBytes(Math.max(...report.images.map(i => i.size)))}
        </Text>
      </View>
      <ChevronRight size={20} color={color.textFaint} />
    </Pressable>
  );
}

const useStyles = makeStyles(({ color, state }) => ({
  screen: { flex: 1, backgroundColor: color.bg },
  top: { padding: space.lg },
  source: { marginTop: 2 },
  stale: { marginTop: space.md, backgroundColor: state.phone.bg, borderRadius: radius.md, padding: space.md },
  staleText: { color: state.phone.fg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  listContent: { paddingBottom: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, marginHorizontal: space.lg, backgroundColor: color.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: color.border },
  rowFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: color.border },
  rowBody: { flex: 1, gap: 2 },
  thumb: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: color.sunken },
}));
