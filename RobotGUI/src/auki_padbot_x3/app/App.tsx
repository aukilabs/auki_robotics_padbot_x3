/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SplashScreen from '../screens/SplashScreen';
import ConfigScreen from '../screens/ConfigScreen';
import { RobotProvider } from '../../contexts/RobotContext';

enum AppScreen {
  SPLASH,
  CONFIG
}

interface ConfigScreenProps {
  restartApp: () => void;
}

const App = () => {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(AppScreen.SPLASH);

  const handleSplashFinish = (options?: { goToConfig?: boolean }) => {
    // Always go to ConfigScreen after initialization
    setCurrentScreen(AppScreen.CONFIG);
  };

  const restartApp = () => {
    setCurrentScreen(AppScreen.SPLASH);
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case AppScreen.SPLASH:
        return <SplashScreen onFinish={handleSplashFinish} />;
      case AppScreen.CONFIG:
        return <ConfigScreen restartApp={restartApp} />;
    }
  };

  return (
    <RobotProvider>
      <View style={styles.container}>
        {renderScreen()}
      </View>
    </RobotProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#9C9C9C',
  },
});

export default App;
