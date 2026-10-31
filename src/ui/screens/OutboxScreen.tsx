import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { Button } from 'react-native';
import type { RootStack } from '../navigation';
import { Placeholder } from './Placeholder';

export function OutboxScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  return (
    <Placeholder title="Reports">
      <Button title="New report" onPress={() => nav.navigate('Compose')} />
    </Placeholder>
  );
}
