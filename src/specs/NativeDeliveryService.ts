import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/** Foreground service that keeps delivery running in the background (DeliveryService.kt). */
export interface Spec extends TurboModule {
  /** Starts the service (or updates its notification) with a short status line. */
  start(text: string): void;
  stop(): void;
}

export default TurboModuleRegistry.get<Spec>('DeliveryService');
