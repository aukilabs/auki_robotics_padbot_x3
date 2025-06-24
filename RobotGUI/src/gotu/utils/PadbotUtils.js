import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { PadbotModule } = NativeModules;

// Create event emitter for battery events
const padbotEventEmitter = new NativeEventEmitter(PadbotModule);

class PadbotUtils {
  /**
   * Initialize the Padbot connection
   * @returns {Promise<boolean>} True if initialization was successful
   */
  static async initialize() {
    try {
      return await PadbotModule.initialize();
    } catch (error) {
      console.error('Error initializing Padbot:', error);
      return false;
    }
  }

  /**
   * Get the current battery status
   * @returns {Promise<{percentage: number, charging: boolean, isInitialValue: boolean}>}
   */
  static async getBatteryStatus() {
    try {
      return await PadbotModule.getBatteryStatus();
    } catch (error) {
      console.error('Error getting battery status:', error);
      return {
        percentage: PadbotModule.DEFAULT_BATTERY_LEVEL, 
        charging: false,
        isInitialValue: true
      };
    }
  }

  /**
   * Add a listener for battery updates
   * @param {Function} callback Function to call when battery status changes
   * @returns {Object} Subscription that should be removed when no longer needed
   */
  static addBatteryListener(callback) {
    return padbotEventEmitter.addListener('batteryUpdate', callback);
  }

  /**
   * Add a listener for robot connection status updates
   * @param {Function} callback Function to call when connection status changes
   * @returns {Object} Subscription that should be removed when no longer needed
   */
  static addConnectionListener(callback) {
    return padbotEventEmitter.addListener('robotConnectionUpdate', callback);
  }

  /**
   * Check if robot is currently charging
   * @returns {Promise<boolean>}
   */
  static async isCharging() {
    try {
      return await PadbotModule.isCharging();
    } catch (error) {
      console.error('Error checking charging status:', error);
      return false;
    }
  }

  /**
   * Get the current connection status
   * @returns {Promise<{connected: boolean, initialized: boolean}>}
   */
  static async getConnectionStatus() {
    try {
      return await PadbotModule.getConnectionStatus();
    } catch (error) {
      console.error('Error getting connection status:', error);
      return { connected: false, initialized: false };
    }
  }

  /**
   * Check the Padbot connection by testing the actual connection
   * @returns {Promise<{connected: boolean, status: string, padbotApiAvailable: boolean}>}
   */
  static async checkConnection() {
    try {
      return await PadbotModule.checkConnection();
    } catch (error) {
      console.error('Error checking Padbot connection:', error);
      return { 
        connected: false, 
        status: 'Connection check failed: ' + error.message,
        padbotApiAvailable: false 
      };
    }
  }

  /**
   * Add a listener for charging status updates
   * @param {Function} callback Function that receives {isCharging: boolean}
   * @returns {Object} Subscription
   */
  static addChargingListener(callback) {
    return padbotEventEmitter.addListener('chargingUpdate', callback);
  }

  /**
   * Clean up the module when no longer needed
   */
  static cleanup() {
    if (Platform.OS === 'android') {
      PadbotModule.cleanup();
    }
  }
}

export default PadbotUtils; 