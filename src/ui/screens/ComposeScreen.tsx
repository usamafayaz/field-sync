import { useNavigation } from '@react-navigation/native';
import { Camera, ImagePlus, Settings as SettingsIcon, X } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { launchCamera, launchImageLibrary, type Asset, type ImagePickerResponse } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_DESCRIPTION_LENGTH, MAX_IMAGES } from '../../config';
import { validateDraft } from '../../delivery/drafts';
import type { SourceImage } from '../../delivery/types';
import { drafts, engine } from '../../services';
import { Button, useButtonIconColor } from '../components';
import { formatBytes } from '../describe';
import { useCameraPermission, useDraft } from '../hooks';
import { font, HIT, makeStyles, radius, space, useTheme } from '../theme';

const toSource = (a: Asset): SourceImage | null =>
  a.uri ? { path: a.uri, bytes: a.fileSize ?? 0, width: a.width ?? 0, height: a.height ?? 0, mime: a.type ?? 'image/jpeg' } : null;

export function ComposeScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { color, state, type } = useTheme();
  const iconColor = useButtonIconColor();
  const draft = useDraft();
  const camera = useCameraPermission();
  const [text, setText] = useState(draft.description);
  const { width } = useWindowDimensions();
  // Three tiles per row; explicit size because aspectRatio + % width collapses here.
  const side = Math.floor((width - space.lg * 2 - space.sm * 2) / 3);
  const tile = { width: side, height: side };
  const [adding, setAdding] = useState(false);
  const [incoming, setIncoming] = useState<SourceImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [triedToSave, setTriedToSave] = useState(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  // Typing is instant; the draft file is written a beat later, and always on leaving.
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => drafts.setDescription(text), 400);
  }, [text]);
  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      // After a successful save the draft is already fresh; don't write the old text back into it.
      if (!savedRef.current) drafts.setDescription(textRef.current);
    },
    [],
  );

  const room = MAX_IMAGES - draft.images.length;
  // Big photos take a moment to copy in; count them as soon as they're picked so errors clear instantly.
  const problems = validateDraft({ description: text, images: [...draft.images, ...incoming] });
  const ready = problems.length === 0;

  // The picker copies each photo into our cache before it returns, which takes a few seconds for
  // camera-size files. Mark busy before opening it, so the tiles show a spinner the moment it closes.
  async function add(pick: () => Promise<ImagePickerResponse>) {
    setMessage(null);
    setAdding(true);
    try {
      const result = await pick();
      if (result.didCancel) return;
      if (result.errorCode) {
        setMessage(result.errorCode === 'camera_unavailable' ? 'This device has no camera available.' : `Couldn’t get the photo: ${result.errorMessage ?? result.errorCode}`);
        return;
      }
      const picked = (result.assets ?? []).map(toSource).filter((x): x is SourceImage => x !== null);
      setIncoming(picked.slice(0, room));
      const added = await drafts.addImages(picked);
      setMessage(added < picked.length ? `Only ${MAX_IMAGES} photos fit in one report. ${picked.length - added} weren’t added.` : null);
    } catch (e) {
      setMessage(`Couldn’t save that photo on the phone: ${(e as Error).message}`);
    } finally {
      setIncoming([]);
      setAdding(false);
    }
  }

  async function takePhoto() {
    setMessage(null);
    if (camera.access !== 'granted' && !(await camera.request())) return;
    // quality 1 and no size limits: we want the original. Shrinking happens later, natively.
    add(() => launchCamera({ mediaType: 'photo', quality: 1, saveToPhotos: false, includeExtra: false }));
  }

  function pickPhotos() {
    // Android's system photo picker: no storage permission needed, nothing for the user to grant.
    add(() => launchImageLibrary({ mediaType: 'photo', quality: 1, selectionLimit: room, includeExtra: false }));
  }

  async function save() {
    setTriedToSave(true);
    if (!ready) return;
    setSaving(true);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    try {
      await drafts.setDescription(text);
      await drafts.submit(Date.now());
      savedRef.current = true;
      engine.wake();
      // Lets the background "waiting for signal" notification show on Android 13+. Asked once.
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
      }
      nav.goBack();
    } catch (e) {
      setMessage(`Couldn’t save the report on this phone: ${(e as Error).message}`);
      setSaving(false);
    }
  }

  const hint = problems.includes('description-blank')
    ? 'Add a short description.'
    : problems.includes('no-images')
      ? 'Add at least one photo.'
      : problems.includes('description-too-long')
        ? `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`
        : null;

  // Edge-to-edge Android no longer resizes for the keyboard, so pad on both platforms.
  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <View style={[styles.bar, { paddingTop: insets.top + space.sm }]}>
        <Pressable onPress={() => nav.goBack()} hitSlop={8} style={styles.close} accessibilityRole="button" accessibilityLabel="Close. Your draft is kept.">
          <X size={24} color={color.text} />
        </Pressable>
        <Text style={type.heading}>New report</Text>
        <View style={styles.barSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[type.label, styles.label]}>What did you find?</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="e.g. Hairline crack along north stairwell, level 3, about 40 cm"
          placeholderTextColor={color.textFaint}
          selectionColor={state.moving.dot}
          multiline
          maxLength={MAX_DESCRIPTION_LENGTH + 50}
          style={[styles.input, triedToSave && problems.includes('description-blank') && styles.inputError]}
          textAlignVertical="top"
          accessibilityLabel="Description"
        />
        <Text style={[type.caption, styles.counter]}>
          {text.length}/{MAX_DESCRIPTION_LENGTH}
        </Text>

        <View style={styles.photoHead}>
          <Text style={[type.label, styles.label]}>Photos</Text>
          <Text style={type.data}>
            {draft.images.length} of {MAX_IMAGES}
          </Text>
        </View>

        <View style={styles.grid}>
          {draft.images.map((img, i) => (
            <View key={img.path} style={[styles.tile, styles.tileLoading, tile]}>
              {/* Sits behind the photo; a big original takes a moment to decode, then covers it. */}
              <ActivityIndicator color={color.textFaint} />
              <Image source={{ uri: `file://${img.path}` }} style={StyleSheet.absoluteFill} resizeMethod="resize" resizeMode="cover" />
              <Pressable
                onPress={() => drafts.removeImage(i)}
                style={styles.remove}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${i + 1}`}>
                <X size={16} color={color.onOverlay} strokeWidth={2.6} />
              </Pressable>
              <Text style={styles.tileSize}>{formatBytes(img.bytes)}</Text>
            </View>
          ))}
          {incoming.map((_, i) => (
            <View key={`incoming-${i}`} style={[styles.tile, tile, styles.tileLoading]} accessibilityLabel="Adding photo">
              <ActivityIndicator color={color.textFaint} />
            </View>
          ))}
          {Array.from({ length: room - incoming.length }).map((_, i) => (
            <Pressable
              key={`empty-${i}`}
              onPress={pickPhotos}
              disabled={adding}
              style={({ pressed }) => [styles.tile, tile, styles.tileEmpty, pressed && styles.tilePressed, triedToSave && problems.includes('no-images') && i === 0 && styles.tileError]}
              accessibilityRole="button"
              accessibilityLabel="Add photos from gallery">
              <ImagePlus size={22} color={color.textFaint} strokeWidth={1.75} />
            </Pressable>
          ))}
        </View>

        <View style={styles.addRow}>
          <Button
            label="Take photo"
            icon={<Camera size={20} color={iconColor} />}
            onPress={takePhoto}
            disabled={room === 0 || adding || camera.access === 'blocked'}
            style={styles.addButton}
          />
          <Button label="Gallery" icon={<ImagePlus size={20} color={iconColor} />} onPress={pickPhotos} disabled={room === 0 || adding} busy={adding} style={styles.addButton} />
        </View>
        {/* The picker only says how many were picked once it has copied them all, so no count yet. */}
        {adding && incoming.length === 0 && <Text style={[type.caption, styles.full]}>Adding photos…</Text>}
        {room === 0 && <Text style={[type.caption, styles.full]}>That’s the maximum of {MAX_IMAGES}. Remove one to add another.</Text>}
        {camera.access === 'blocked' ? (
          <View style={styles.permission}>
            <Text style={type.smallStrong}>Camera access is off</Text>
            <Text style={type.small}>To take photos here, turn on Camera for FieldSync in Settings. You can still choose photos from the gallery.</Text>
            <Button label="Open Settings" icon={<SettingsIcon size={18} color={iconColor} />} onPress={() => Linking.openSettings()} style={styles.permissionButton} />
          </View>
        ) : null}
        {message && <Text style={[type.small, styles.message]}>{message}</Text>}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
        {triedToSave && hint ? <Text style={[type.small, styles.hint]}>{hint}</Text> : null}
        <Button kind="primary" label="Save report" onPress={save} busy={saving} disabled={adding} style={styles.saveButton} />
        <Text style={[type.caption, styles.footNote]}>Saves on this phone first. It sends by itself whenever there’s signal.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(({ color, state }) => ({
  screen: { flex: 1, backgroundColor: color.bg },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs, paddingBottom: space.sm },
  barSpacer: { width: HIT },
  close: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.lg, paddingBottom: space.xxl },
  label: { marginBottom: space.sm },
  input: {
    minHeight: 112,
    backgroundColor: color.field,
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    padding: space.md,
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 23,
    color: color.text,
  },
  inputError: { borderColor: state.needs.dot, borderWidth: 1.5 },
  counter: { textAlign: 'right', marginTop: space.xs },
  photoHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: color.sunken },
  tileEmpty: { backgroundColor: 'transparent', borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.borderStrong, alignItems: 'center', justifyContent: 'center' },
  tilePressed: { backgroundColor: color.sunken },
  tileLoading: { alignItems: 'center', justifyContent: 'center' },
  tileError: { borderColor: state.needs.dot },
  tileSize: { position: 'absolute', left: 6, bottom: 6, fontFamily: font.monoMedium, fontSize: 10.5, color: color.onOverlay, backgroundColor: color.overlay, paddingHorizontal: 5, borderRadius: 4, overflow: 'hidden' },
  remove: { position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: color.overlay, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  addButton: { flex: 1 },
  full: { marginTop: space.sm },
  permission: { marginTop: space.md, backgroundColor: state.phone.bg, borderRadius: radius.md, padding: space.md, gap: space.xs },
  permissionButton: { alignSelf: 'flex-start', marginTop: space.sm },
  message: { marginTop: space.md, color: state.needs.fg },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: 1, borderTopColor: color.border, backgroundColor: color.bg },
  hint: { color: state.needs.fg, marginBottom: space.sm },
  saveButton: { minHeight: 56 },
  footNote: { textAlign: 'center', marginTop: space.sm },
}));
