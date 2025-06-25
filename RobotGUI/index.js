import {AppRegistry, NativeModules} from 'react-native';
import {name as appName} from './app.json';

// Import both app variants
import AukiPadbotX3App from './src/auki_padbot_x3/app/App';

// Get the app variant from native code
const getAppVariant = () => {
  try {
    // This requires adding a native module that exposes the app variant
    const appVariant = NativeModules.AppInfo?.getAppVariant?.() || 'auki_padbot_x3';
    console.log('App variant:', appVariant);
    return appVariant;
  } catch (error) {
    console.error('Error getting app variant:', error);
    return 'auki_padbot_x3';
  }
};

// Select the app based on the variant
const getApp = () => {
  const variant = getAppVariant();
  switch (variant) {
    case 'auki_padbot_x3':
      return AukiPadbotX3App;
    default:
      return AukiPadbotX3App;
  }
};

// Register the appropriate component
AppRegistry.registerComponent(appName, () => getApp()); 