/**
 * X3-Prep App
 * 
 * @format
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, BackHandler } from 'react-native';
import ConfigScreen from './src/screens/ConfigScreen';

const App = () => {
  useEffect(() => {
    // Override the back button behavior to exit the app
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => backHandler.remove();
  }, []);

  const handleClose = () => {
    // Exit the app when config screen is closed
    BackHandler.exitApp();
  };

  return (
    <View style={styles.container}>
      <ConfigScreen onClose={handleClose} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#9C9C9C',
  },
});

export default App;
