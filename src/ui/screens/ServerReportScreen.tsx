import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../services';
import { formatBytes } from '../describe';
import type { RootStack } from '../navigation';
import { makeStyles, radius, space, useTheme } from '../theme';

type Props = NativeStackScreenProps<RootStack, 'ServerReport'>;

/** Full-size photos, streamed from the server. What you see here is what was stored. */
export function ServerReportScreen({ route }: Props) {
  const { report } = route.params;
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { type } = useTheme();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}>
      <Text style={type.title}>{report.description}</Text>
      <Text style={[type.caption, styles.received]}>Received {new Date(report.receivedAt).toLocaleString()}</Text>
      {report.images.map(img => {
        const ratio = img.width && img.height ? img.width / img.height : 4 / 3;
        return (
          <View key={img.index} style={styles.photoBlock}>
            <Image source={{ uri: api.imageUrl(report.id, img.index) }} style={[styles.photo, { aspectRatio: ratio }]} resizeMode="cover" />
            <Text style={[type.data, styles.caption]}>
              Photo {img.index + 1} · {img.width ?? '?'} × {img.height ?? '?'} · {formatBytes(img.size)}
            </Text>
          </View>
        );
      })}
      <Text style={[type.data, styles.id]} selectable>
        ID {report.id}
      </Text>
    </ScrollView>
  );
}

const useStyles = makeStyles(({ color }) => ({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.lg },
  received: { marginTop: space.xs },
  photoBlock: { marginTop: space.lg },
  photo: { width: '100%', borderRadius: radius.md, backgroundColor: color.sunken },
  caption: { marginTop: space.xs },
  id: { marginTop: space.xl },
}));
