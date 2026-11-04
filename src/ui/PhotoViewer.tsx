import { X } from 'lucide-react-native';
import React, { useState } from 'react';
import { FlatList, Image, Modal, Pressable, StatusBar, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, HIT, makeStyles, space, useTheme } from './theme';

interface Props {
  uris: string[];
  /** Which photo to open on; null keeps the viewer closed. */
  start: number | null;
  onClose: () => void;
}

/** Full-screen photos: swipe between them, close with X or the back button. */
export function PhotoViewer({ uris, start, onClose }: Props) {
  return (
    <Modal visible={start !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {start !== null && <Pages uris={uris} start={start} onClose={onClose} />}
    </Modal>
  );
}

// Mounted fresh on every open, so the counter and scroll position start at the tapped photo.
function Pages({ uris, start, onClose }: { uris: string[]; start: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { color } = useTheme();
  const [index, setIndex] = useState(start);

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <FlatList
        data={uris}
        keyExtractor={uri => uri}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={start}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => <Image source={{ uri: item }} style={{ width, height }} resizeMode="contain" />}
      />
      <View style={[styles.bar, { top: insets.top + space.sm }]}>
        <Text style={styles.count}>
          {index + 1} of {uris.length}
        </Text>
        <Pressable onPress={onClose} hitSlop={8} style={styles.close} accessibilityRole="button" accessibilityLabel="Close photo">
          <X size={24} color={color.onOverlay} />
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ color }) => ({
  screen: { flex: 1, backgroundColor: '#000' },
  bar: { position: 'absolute', left: space.lg, right: space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontFamily: font.monoMedium, fontSize: 14, color: color.onOverlay },
  close: { width: HIT, height: HIT, borderRadius: HIT / 2, backgroundColor: color.overlay, alignItems: 'center', justifyContent: 'center' },
}));
