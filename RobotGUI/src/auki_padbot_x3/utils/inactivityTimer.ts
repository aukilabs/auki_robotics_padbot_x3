import { LogUtils } from './logging';

// Access the global object in a way that works in React Native
const globalAny: any = global;

// Inactivity timeout duration (1 minute)
export const INACTIVITY_TIMEOUT = 60000;

// Initialize global references
let inactivityTimerRef: NodeJS.Timeout | null = null;
globalAny.inactivityTimerActive = false;

/**
 * Clears the inactivity timer if it exists
 */
export const clearInactivityTimer = () => {
  if (inactivityTimerRef) {
    clearTimeout(inactivityTimerRef);
    inactivityTimerRef = null;
    globalAny.inactivityTimerActive = false;
    LogUtils.writeDebugToFile('Inactivity timer cleared');
  }
};

/**
 * Starts the inactivity timer
 * @param callback Function to call when the timer expires
 */
export const startInactivityTimer = (callback: () => void) => {
  // Clear any existing timer first
  clearInactivityTimer();
  
  // Log that we're starting the timer
  LogUtils.writeDebugToFile('Starting inactivity timer (1 minute)');
  
  // Set a new timer
  inactivityTimerRef = setTimeout(() => {
    LogUtils.writeDebugToFile('Inactivity timer expired, executing callback');
    globalAny.inactivityTimerActive = false;
    callback();
  }, INACTIVITY_TIMEOUT);
  
  globalAny.inactivityTimerActive = true;
};

/**
 * Resets the inactivity timer if it's active
 * @param callback Function to call when the timer expires
 */
export const resetInactivityTimer = (callback: () => void) => {
  if (globalAny.inactivityTimerActive) {
    clearInactivityTimer();
    startInactivityTimer(callback);
    LogUtils.writeDebugToFile('Inactivity timer reset');
  }
};

/**
 * Checks if the inactivity timer is currently active
 * @returns boolean indicating if the timer is active
 */
export const isInactivityTimerActive = (): boolean => {
  return globalAny.inactivityTimerActive;
}; 