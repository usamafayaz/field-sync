/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { boot, engine } from './src/services';

AppRegistry.registerComponent(appName, () => App);

// Run by DeliveryService; keeps JS timers alive in the background until the outbox is empty.
AppRegistry.registerHeadlessTask('FieldSyncDelivery', () => async () => {
  await boot();
  await engine.whenIdle();
});
