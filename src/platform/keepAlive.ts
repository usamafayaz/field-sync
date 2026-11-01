import { Platform } from 'react-native';
import type { KeepAlive } from '../delivery/ports';
import NativeDeliveryService from '../specs/NativeDeliveryService';

/** Thin wrapper that avoids re-sending identical notification text on every loop turn. */
export function createKeepAlive(): KeepAlive {
  let current: string | null = null;
  const native = Platform.OS === 'android' ? NativeDeliveryService : null;
  return {
    hold(summary) {
      if (summary === current) return;
      current = summary;
      native?.start(summary);
    },
    release() {
      if (current === null) return;
      current = null;
      native?.stop();
    },
  };
}
