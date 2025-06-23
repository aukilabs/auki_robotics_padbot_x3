import {AppRegistry, NativeModules} from 'react-native';
import {name as appName} from './app.json';

// Import both app variants
import GoTuApp from './src/gotu/app/App';

// Get the app variant from native code
const getAppVariant = () => {
  try {
    // This requires adding a native module that exposes the app variant
    const appVariant = NativeModules.AppInfo?.getAppVariant?.() || 'gotu';
    console.log('App variant:', appVariant);
    return appVariant;
  } catch (error) {
    console.error('Error getting app variant:', error);
    return 'gotu';
  }
};

// Select the app based on the variant
const getApp = () => {
  const variant = getAppVariant();
  switch (variant) {
    case 'gotu':
      return GoTuApp;
    default:
      return GoTuApp;
  }
};

// Register the appropriate component
AppRegistry.registerComponent(appName, () => getApp()); 