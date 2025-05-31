/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SplashScreen from '../screens/SplashScreen';
import MainScreen from '../screens/MainScreen';
import ConfigScreen from '../screens/ConfigScreen';
import { RobotProvider } from '../../contexts/RobotContext';

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

interface ConfigScreenProps {
  onClose: () => void;
  restartApp: () => void;
}

const App = () => {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(AppScreen.SPLASH);
  const [products, setProducts] = useState<Product[]>([]);

  const handleSplashFinish = (loadedProducts: Product[], options?: { goToConfig?: boolean }) => {
    if (options && options.goToConfig) {
      setCurrentScreen(AppScreen.CONFIG);
      return;
    }
    setProducts(loadedProducts);
    setCurrentScreen(AppScreen.MAIN);
  };

  const handleConfigPress = () => {
    setCurrentScreen(AppScreen.CONFIG);
  };

  const handleClose = () => {
    setCurrentScreen(AppScreen.MAIN);
  };

  const restartApp = () => {
    setCurrentScreen(AppScreen.SPLASH);
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case AppScreen.SPLASH:
        return <SplashScreen onFinish={handleSplashFinish} />;
      case AppScreen.MAIN:
        return <MainScreen onClose={handleClose} onConfigPress={handleConfigPress} initialProducts={products} />;
      case AppScreen.CONFIG:
        return <ConfigScreen onClose={handleClose} restartApp={restartApp} />;
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
