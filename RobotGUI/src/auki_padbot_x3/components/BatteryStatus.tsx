import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, EmitterSubscription } from 'react-native';
import PadbotUtils from '../utils/PadbotUtils';

interface BatteryInfo {
  percentage: number;
  charging: boolean;
  isInitialValue: boolean;
}

interface ConnectionStatus {
  connected: boolean;
}

interface ChargingInfo {
  isCharging: boolean;
}

const BatteryStatus: React.FC = () => {
  const [batteryInfo, setBatteryInfo] = useState<BatteryInfo>({
    percentage: -1,
    charging: false,
    isInitialValue: true
  });
  const [isRobotCharging, setIsRobotCharging] = useState<boolean>(false);

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
    const batterySubscription: EmitterSubscription = PadbotUtils.addBatteryListener((info: BatteryInfo) => {
      setBatteryInfo({
        ...info,
        isInitialValue: false
      });
    });

    // Add charging status listener
    const chargingSubscription: EmitterSubscription = PadbotUtils.addChargingListener((info: ChargingInfo) => {
      setIsRobotCharging(info.isCharging);
    });

    // Clean up listeners on unmount
    return () => {
      batterySubscription.remove();
      chargingSubscription.remove();
      PadbotUtils.cleanup();
    };
  }, []);

  // Format the battery display
  const getBatteryDisplay = (): string => {
    if (batteryInfo.isInitialValue || batteryInfo.percentage < 0) {
      return 'Waiting for data...';
    }
    
    // Add charging indicator from robot's charging status
    const chargingText = isRobotCharging ? ' (Charging)' : '';
    return `${batteryInfo.percentage}%${chargingText}`;
  };

  // Get battery color based on level
  const getBatteryColor = (): string => {
    const level = batteryInfo.percentage;
    
    if (level < 0) return '#999'; // Gray for unknown
    if (level < 20) return '#FF3B30'; // Red for low
    if (level < 50) return '#FF9500'; // Orange for medium
    return '#4CD964'; // Green for good
  };

  return (
    <View style={styles.statusRow}>
      <Text style={styles.label}>Battery: </Text>
      <Text style={[styles.value, { color: getBatteryColor() }]}>
        {getBatteryDisplay()}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 5,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default BatteryStatus; 