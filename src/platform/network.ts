import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import type { NetworkMonitor } from '../delivery/ports';

/** Online unless the OS is certain we're not. */
const isOnline = (s: NetInfoState) => s.isConnected !== false;

export function createNetworkMonitor(): NetworkMonitor {
  let online = true;
  const listeners = new Set<(online: boolean) => void>();
  NetInfo.addEventListener(state => {
    const next = isOnline(state);
    if (next === online) return;
    online = next;
    listeners.forEach(l => l(online));
  });
  NetInfo.fetch().then(state => {
    online = isOnline(state);
    listeners.forEach(l => l(online));
  });
  return {
    isOnline: () => online,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
