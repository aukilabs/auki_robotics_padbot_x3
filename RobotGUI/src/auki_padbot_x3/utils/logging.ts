import { NativeModules } from 'react-native';

// The FileUtils module will automatically handle app-specific directories
// For AukiPadbotX3, logs will be written to the "AukiPadbotX3" directory in Downloads
const LOG_FILENAME = 'debug_log.txt';

export const LogUtils = {
  async initializeLogging() {
    try {
      // Delete existing log file
      await NativeModules.FileUtils.deleteFile(LOG_FILENAME);
      await this.writeDebugToFile('=== New Debug Session Started ===');
      await this.writeDebugToFile(`App Version: ${process.env.APP_VERSION || 'unknown'}`);
    } catch (error: any) {
      console.error('Failed to initialize logging:', error);
    }
  },

  async writeDebugToFile(message: string) {
    try {
      const timestamp = new Date().toISOString();
      await NativeModules.FileUtils.appendToFile(LOG_FILENAME, `${timestamp}: ${message}`);
    } catch (error) {
      console.error('Failed to write debug info to file:', error);
    }
  }
}; 