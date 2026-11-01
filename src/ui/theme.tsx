import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Design tokens, in a light and a dark palette.
 *
 * Light is for daylight (dark text beats glare); dark is for stairwells and night, and its
 * ground is the app icon's ink, so the dark app continues straight on from the splash.
 * Colours are named by role (text, surface, accent…), never by hue, so screens don't care
 * which theme is active. Bright green is reserved for the one primary action on a screen;
 * the deeper, muted green of "On the server" is a state, not an action.
 */

export type Scheme = 'light' | 'dark';

/** Fixed brand colours, the same in both themes (icon, splash, primary button). */
export const brand = {
  ink: '#1B2420',
  green: '#1DB954',
  greenBright: '#1ED760',
  paper: '#ECEEEA',
} as const;

export interface Palette {
  bg: string;
  surface: string;
  sunken: string;
  field: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentPressed: string;
  accentBorder: string;
  onAccent: string;
  link: string;
  overlay: string;
  onOverlay: string;
  ripple: string;
  dangerBorder: string;
  onBadge: string;
}

export interface Tone {
  fg: string;
  bg: string;
  dot: string;
}
export type StateTone = 'phone' | 'moving' | 'server' | 'needs';

// Every text colour below passes WCAG AA (4.5:1) on bg and surface in its theme.
const palettes: Record<Scheme, { color: Palette; state: Record<StateTone, Tone> }> = {
  light: {
    color: {
      bg: brand.paper,
      surface: '#FAFBF9',
      sunken: '#E2E6E1',
      field: '#FFFFFF',
      text: '#1B2420',
      textMuted: '#4D5853',
      textFaint: '#626C67',
      border: '#D5DAD5',
      borderStrong: '#BCC3BD',
      accent: brand.green,
      accentPressed: '#19A04A',
      accentBorder: '#179C47',
      onAccent: brand.ink,
      link: '#1C5797',
      overlay: 'rgba(27,36,32,0.78)',
      onOverlay: '#FFFFFF',
      ripple: 'rgba(27,36,32,0.08)',
      dangerBorder: '#E3B7B2',
      onBadge: '#FFFFFF',
    },
    state: {
      phone: { fg: '#8A4210', bg: '#F8E6D8', dot: '#D9772B' },
      moving: { fg: '#1C5797', bg: '#E1EAF6', dot: '#2E74C4' },
      server: { fg: '#1F6843', bg: '#DCEEE2', dot: '#2E8A5A' },
      needs: { fg: '#A2322A', bg: '#F7E1DE', dot: '#C4453D' },
    },
  },
  dark: {
    color: {
      bg: brand.ink,
      surface: '#232E29',
      sunken: '#2C3833',
      field: '#18201C',
      text: '#E9EDEA',
      textMuted: '#AEB8B3',
      textFaint: '#8A958F',
      border: '#33403A',
      borderStrong: '#46544D',
      accent: brand.greenBright,
      accentPressed: brand.green,
      accentBorder: brand.greenBright,
      onAccent: brand.ink,
      link: '#93BDF2',
      overlay: 'rgba(10,14,12,0.72)',
      onOverlay: '#FFFFFF',
      ripple: 'rgba(233,237,234,0.10)',
      dangerBorder: '#6B3530',
      // Dark-theme state dots are lighter, so badges on them carry ink text.
      onBadge: brand.ink,
    },
    state: {
      phone: { fg: '#F5A872', bg: '#3B2618', dot: '#E8893F' },
      moving: { fg: '#93BDF2', bg: '#1A2B42', dot: '#4C8FDB' },
      server: { fg: '#86D3A8', bg: '#163327', dot: '#3FAE73' },
      needs: { fg: '#F4A79F', bg: '#3F201C', dot: '#E0645A' },
    },
  },
};

export const font = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Radii step with hierarchy: big containers are rounder than the things inside them. */
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

/** Minimum touch target (Android guideline is 48dp). */
export const HIT = 48;

/** Type scale (minor third, rounded to whole pixels). */
function typeScale(c: Palette) {
  const t = <T extends TextStyle>(s: T) => s;
  return {
    display: t({ fontFamily: font.semibold, fontSize: 30, lineHeight: 36, letterSpacing: -0.4, color: c.text }),
    title: t({ fontFamily: font.semibold, fontSize: 21, lineHeight: 27, letterSpacing: -0.2, color: c.text }),
    heading: t({ fontFamily: font.semibold, fontSize: 17, lineHeight: 23, color: c.text }),
    label: t({ fontFamily: font.semibold, fontSize: 15, lineHeight: 21, color: c.text }),
    body: t({ fontFamily: font.regular, fontSize: 16, lineHeight: 23, color: c.text }),
    bodyStrong: t({ fontFamily: font.medium, fontSize: 16, lineHeight: 23, color: c.text }),
    small: t({ fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: c.textMuted }),
    smallStrong: t({ fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: c.text }),
    caption: t({ fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, color: c.textFaint }),
    data: t({ fontFamily: font.mono, fontSize: 12.5, lineHeight: 17, color: c.textMuted }),
  };
}

export interface Theme {
  scheme: Scheme;
  color: Palette;
  state: Record<StateTone, Tone>;
  type: ReturnType<typeof typeScale>;
}

function buildTheme(scheme: Scheme): Theme {
  const p = palettes[scheme];
  return { scheme, color: p.color, state: p.state, type: typeScale(p.color) };
}

const themes: Record<Scheme, Theme> = { light: buildTheme('light'), dark: buildTheme('dark') };

const ThemeContext = createContext<Theme>(themes.light);

/** Follows the OS appearance (which the Settings override feeds via Appearance.setColorScheme). */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return <ThemeContext.Provider value={themes[scheme]}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/** Like StyleSheet.create, but from the active theme. Styles are built once per theme and cached. */
export function makeStyles<S extends NamedStyles>(
  // Same "& NamedStyles" trick as StyleSheet.create, so 'row' stays a literal, not a string.
  factory: (theme: Theme) => S & NamedStyles,
): () => Readonly<S> {
  const cache: Partial<Record<Scheme, Readonly<S>>> = {};
  return function useStyles() {
    const theme = useTheme();
    return useMemo(() => (cache[theme.scheme] ??= StyleSheet.create(factory(theme))), [theme]);
  };
}
