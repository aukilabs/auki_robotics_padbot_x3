import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PadbotUtils from '../utils/PadbotUtils';

const BatteryStatus = () => {
  const [batteryInfo, setBatteryInfo] = useState({
    percentage: -1,
    charging: false,
    isInitialValue: true
  });
  const [isConnected, setIsConnected] = useState(false);
  const [isRobotCharging, setIsRobotCharging] = useState(false);

  useEffect(() => {
    // Initialize Padbot connection
    const initializePadbot = async () => {
      try {
        await PadbotUtils.initialize();
        const initialBatteryStatus = await PadbotUtils.getBatteryStatus();
        setBatteryInfo(initialBatteryStatus);
        
        // Check initial charging state
        const charging = await PadbotUtils.isCharging();
        setIsRobotCharging(charging);
      } catch (error) {
        console.error('Failed to initialize Padbot:', error);
      }
    };

    initializePadbot();

    // Set up listeners for battery and connection updates
    const batterySubscription = PadbotUtils.addBatteryListener((info) => {
      setBatteryInfo({
        ...info,
        isInitialValue: false
      });
    });

    const connectionSubscription = PadbotUtils.addConnectionListener((status) => {
      setIsConnected(status.connected);
    });
    
    // Add charging status listener
    const chargingSubscription = PadbotUtils.addChargingListener((info) => {
      setIsRobotCharging(info.isCharging);
    });

    // Clean up listeners on unmount
    return () => {
      batterySubscription.remove();
      connectionSubscription.remove();
      chargingSubscription.remove();
      PadbotUtils.cleanup();
    };
  }, []);

  // Format the battery display
  const getBatteryDisplay = () => {
    if (batteryInfo.isInitialValue || batteryInfo.percentage < 0) {
      return 'Waiting for data...';
    }
    
    // Add charging indicator from robot's charging status
    const chargingText = isRobotCharging ? ' (Charging)' : '';
    return `${batteryInfo.percentage}%${chargingText}`;
  };

  // Get battery color based on level
  const getBatteryColor = () => {
    const level = batteryInfo.percentage;
    
    if (level < 0) return '#999'; // Gray for unknown
    if (level < 20) return '#FF3B30'; // Red for low
    if (level < 50) return '#FF9500'; // Orange for medium
    return '#4CD964'; // Green for good
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <Text style={styles.label}>Battery: </Text>
        <Text style={[styles.value, { color: getBatteryColor() }]}>
          {getBatteryDisplay()}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 0,
    backgroundColor: 'transparent',
    borderRadius: 0,
    marginVertical: 0,
  },
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

export default BatteryStatus; 