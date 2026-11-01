import React from 'react';
import { ActivityIndicator, Pressable, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { font, HIT, makeStyles, radius, space, useTheme, type StateTone } from './theme';

/* ------------------------------------------------------------------ Button */

type ButtonKind = 'primary' | 'secondary' | 'quiet' | 'danger';

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  kind?: ButtonKind;
  icon?: React.ReactNode;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, kind = 'secondary', icon, busy, disabled, style, ...rest }: ButtonProps) {
  const styles = useStyles();
  const { color } = useTheme();
  const off = disabled || busy;
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      android_ripple={{ color: color.ripple }}
      style={({ pressed }) => [
        styles.button,
        styles[kind],
        pressed && (primary ? styles.primaryPressed : styles.pressed),
        off && styles.buttonOff,
        style,
      ]}
      {...rest}>
      {busy ? <ActivityIndicator color={primary ? color.onAccent : color.text} size="small" /> : icon}
      <Text style={[styles.buttonLabel, primary && styles.primaryLabel, kind === 'danger' && styles.dangerLabel]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Icon colour that matches a Button of the given kind. */
export function useButtonIconColor(kind: ButtonKind = 'secondary') {
  const { color, state } = useTheme();
  return kind === 'primary' ? color.onAccent : kind === 'danger' ? state.needs.fg : color.text;
}

/* ------------------------------------------------------------------ State */

export function StatePill({ tone, label }: { tone: StateTone; label: string }) {
  const styles = useStyles();
  const s = useTheme().state[tone];
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <View style={[styles.dot, { backgroundColor: s.dot }]} />
      <Text style={[styles.pillText, { color: s.fg }]}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ value, tone = 'moving', height = 4 }: { value: number; tone?: StateTone; height?: number }) {
  const styles = useStyles();
  const { state } = useTheme();
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const shape = { height, borderRadius: height };
  return (
    <View style={[styles.track, shape]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
      <View style={[shape, { width: `${pct}%`, backgroundColor: state[tone].dot }]} />
    </View>
  );
}

/* ------------------------------------------------------------------ Layout */

export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  const styles = useStyles();
  const { type } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={type.heading}>{title}</Text>
        {aside}
      </View>
      {children}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

/** An empty or failed state. States what happened and what to do, never just a mood. */
export function Notice({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  const styles = useStyles();
  const { type } = useTheme();
  return (
    <View style={styles.notice}>
      {icon}
      <Text style={[type.heading, styles.center]}>{title}</Text>
      <Text style={[type.small, styles.center]}>{body}</Text>
      {action ? <View style={styles.noticeAction}>{action}</View> : null}
    </View>
  );
}

const useStyles = makeStyles(({ color, state }) => ({
  button: {
    minHeight: HIT,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    overflow: 'hidden',
  },
  primary: { backgroundColor: color.accent, borderColor: color.accentBorder },
  secondary: { backgroundColor: color.surface, borderColor: color.borderStrong },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  danger: { backgroundColor: color.surface, borderColor: color.dangerBorder },
  primaryPressed: { backgroundColor: color.accentPressed },
  pressed: { backgroundColor: color.sunken },
  buttonOff: { opacity: 0.45 },
  buttonLabel: { fontFamily: font.semibold, fontSize: 16, color: color.text },
  primaryLabel: { color: color.onAccent },
  dangerLabel: { color: state.needs.fg },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  track: { backgroundColor: color.sunken, overflow: 'hidden', width: '100%' },
  section: { marginTop: space.xl },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space.sm, paddingHorizontal: space.lg },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border },
  notice: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.xl, paddingVertical: space.xxl },
  noticeAction: { marginTop: space.md },
  center: { textAlign: 'center' },
}));
