/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SplashScreen from './src/screens/SplashScreen';
import MainScreen from './src/screens/MainScreen';
import ConfigScreen from './src/screens/ConfigScreen';
import { RobotProvider, useRobot } from './src/contexts/RobotContext';

enum AppScreen {
  SPLASH,
  MAIN,
  CONFIG
}

interface Product {
  name: string;
  eslCode: string;
  pose: {
    x: number;
    y: number;
    z: number;
  };
}

const AppContent = () => {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(AppScreen.SPLASH);
  const [products, setProducts] = useState<Product[]>([]);
  const { initialize } = useRobot();

  const handleSplashFinish = async (loadedProducts: Product[]) => {
    // Initialize robot as part of splash screen completion
    const robotInitialized = await initialize();
    if (robotInitialized) {
      setProducts(loadedProducts);
      setCurrentScreen(AppScreen.MAIN);
    } else {
      // Handle initialization failure - you might want to show an error screen
      console.error('Failed to initialize robot, staying on splash screen');
    }
  };

  const handleConfigPress = () => {
    setCurrentScreen(AppScreen.CONFIG);
  };

  const handleClose = () => {
    setCurrentScreen(AppScreen.MAIN);
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case AppScreen.SPLASH:
        return <SplashScreen onFinish={handleSplashFinish} />;
      case AppScreen.MAIN:
        return <MainScreen onClose={handleClose} onConfigPress={handleConfigPress} initialProducts={products} />;
      case AppScreen.CONFIG:
        return <ConfigScreen onClose={handleClose} />;
    }
  };

  return (
    <View style={styles.container}>
      {renderScreen()}
    </View>
  );
};

const App = () => {
  return (
    <RobotProvider>
      <AppContent />
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
