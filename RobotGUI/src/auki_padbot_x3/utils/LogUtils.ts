import { NativeModules } from 'react-native';

export const LogUtils = {
  writeDebugToFile: async (message: string): Promise<void> => {
    try {
      await NativeModules.FileUtils.appendToFile('debug_log.txt', message + '\n');
    } catch (error) {
      console.error('Failed to write to debug log:', error);
    }
  }
}; 