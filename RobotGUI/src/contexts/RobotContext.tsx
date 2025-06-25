import React, { createContext, useContext, useState, useEffect } from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';

interface RobotContextType {
  isInitialized: boolean;
  batteryLevel: number;
  isCharging: boolean;
  isConnected: boolean;
  initialize: () => Promise<boolean>;
  cleanup: () => void;
  startAutoCharging: () => Promise<void>;
}

const RobotContext = createContext<RobotContextType | null>(null);

export const useRobot = () => {
  const context = useContext(RobotContext);
  if (!context) {
    throw new Error('useRobot must be used within a RobotProvider');
  }
  return context;
};

export const RobotProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState(-1);
  const [isCharging, setIsCharging] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const eventEmitter = new NativeEventEmitter(NativeModules.PadbotModule);
    
    const batterySubscription = eventEmitter.addListener('batteryUpdate', (event) => {
      setBatteryLevel(event.percentage);
      setIsCharging(event.charging);
    });

    const connectionSubscription = eventEmitter.addListener('robotConnectionUpdate', (event) => {
      setIsConnected(event.connected);
    });

    const chargingSubscription = eventEmitter.addListener('chargingUpdate', (event) => {
      setIsCharging(event.isCharging);
    });

    return () => {
      batterySubscription.remove();
      connectionSubscription.remove();
      chargingSubscription.remove();
      if (isInitialized) {
        cleanup();
      }
    };
  }, [isInitialized]);

  const initialize = async (): Promise<boolean> => {
    try {
      await NativeModules.PadbotModule.initialize();
      setIsInitialized(true);
      return true;
    } catch (error) {
      console.error('Failed to initialize robot:', error);
      return false;
    }
  };

  const cleanup = () => {
    NativeModules.PadbotModule.cleanup();
    setIsInitialized(false);
  };

  const startAutoCharging = async () => {
    try {
      await NativeModules.PadbotModule.startAutoCharging();
    } catch (error) {
      console.error('Failed to start auto-charging:', error);
      throw error;
    }
  };

  const value = {
    isInitialized,
    batteryLevel,
    isCharging,
    isConnected,
    initialize,
    cleanup,
    startAutoCharging,
  };

  return <RobotContext.Provider value={value}>{children}</RobotContext.Provider>;
}; 