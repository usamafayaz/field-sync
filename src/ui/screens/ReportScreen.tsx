import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Text } from 'react-native';
import type { RootStack } from '../navigation';
import { Placeholder } from './Placeholder';

type Props = NativeStackScreenProps<RootStack, 'Report'>;

export function ReportScreen({ route }: Props) {
  return (
    <Placeholder title="Report">
      <Text>{route.params.id}</Text>
    </Placeholder>
  );
}
