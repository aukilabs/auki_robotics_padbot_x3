import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import BatteryStatus from './BatteryStatus';
import RobotConnectionStatus from './RobotConnectionStatus';

const RobotStatus: React.FC = () => {
  return (
    <View style={styles.container}>
      <BatteryStatus />
      <RobotConnectionStatus />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 8,
    backgroundColor: '#F5F5F5',
    borderRadius: 5,
    marginVertical: 5,
    alignItems: 'flex-start',
  },
});

export default RobotStatus; 