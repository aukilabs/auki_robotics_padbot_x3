import { NativeModules } from 'react-native';

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