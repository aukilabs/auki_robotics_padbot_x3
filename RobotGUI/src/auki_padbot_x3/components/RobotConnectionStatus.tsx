import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PadbotUtils from '../utils/PadbotUtils';

interface ConnectionStatus {
  connected: boolean;
}

const RobotConnectionStatus: React.FC = () => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        setIsChecking(true);
        const result = await PadbotUtils.checkConnection();
        setIsConnected(result.connected);
        console.log('[RobotConnectionStatus] Connection check result:', result);
      } catch (error) {
        console.error('[RobotConnectionStatus] Connection check error:', error);
        setIsConnected(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkConnection();
  }, []);

  return (
    <View style={styles.statusRow}>
      <Text style={styles.label}>Robot Connection: </Text>
      <Text style={[styles.value, { color: isConnected ? '#4CD964' : '#FF3B30' }]}>
        {isChecking ? 'Checking...' : (isConnected ? 'Connected' : 'Disconnected')}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 2,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    textAlign: 'left',
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'left',
  },
});

export default RobotConnectionStatus; 