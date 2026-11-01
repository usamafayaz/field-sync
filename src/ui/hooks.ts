import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import type { ServerReport } from '../delivery/types';
import { api, drafts, engine, outbox, settings } from '../services';

/* Each hook reads one store. Screens compose them; none of them owns delivery logic. */

export const useOutbox = () => useSyncExternalStore(outbox.subscribe, outbox.all);

export const useEngine = () => useSyncExternalStore(engine.subscribe, engine.getSnapshot);

export const useDraft = () => useSyncExternalStore(drafts.subscribe, drafts.get);

export const useSettings = () => useSyncExternalStore(settings.subscribe, settings.get);

/** Re-renders every `ms` so relative times and countdowns stay honest. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export type CameraAccess = 'unknown' | 'granted' | 'ask' | 'blocked';

/** Camera permission, re-checked when the user comes back from Settings. */
export function useCameraPermission() {
  const [access, setAccess] = useState<CameraAccess>('unknown');

  const check = useCallback(async () => {
    if (Platform.OS !== 'android') return setAccess('granted');
    const ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
    setAccess(prev => (ok ? 'granted' : prev === 'blocked' ? 'blocked' : 'ask'));
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', s => s === 'active' && check());
    return () => sub.remove();
  }, [check]);

  const request = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      setAccess('granted');
      return true;
    }
    setAccess(result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'ask');
    return false;
  }, []);

  return { access, request };
}

export type ServerList =
  | { kind: 'loading' }
  | { kind: 'loaded'; reports: ServerReport[]; at: number; refreshing: boolean; error?: string }
  | { kind: 'failed'; error: string };

/** What the server holds, fetched from the server. Never filled in from the outbox. */
export function useServerReports() {
  const [state, setState] = useState<ServerList>({ kind: 'loading' });
  const serverUrl = useSettings().serverUrl;

  const load = useCallback(async () => {
    setState(s => (s.kind === 'loaded' ? { ...s, refreshing: true, error: undefined } : { kind: 'loading' }));
    try {
      const reports = await api.listReports();
      setState({ kind: 'loaded', reports, at: Date.now(), refreshing: false });
    } catch (err) {
      const error = (err as Error).message;
      setState(s => (s.kind === 'loaded' ? { ...s, refreshing: false, error } : { kind: 'failed', error }));
    }
  }, []);

  // A new server address means the old list describes a different server.
  useEffect(() => {
    setState({ kind: 'loading' });
    load();
  }, [serverUrl, load]);

  return { state, reload: load, clear: () => setState({ kind: 'loading' }) };
}
