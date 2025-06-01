import React, { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  NativeModules,
  BackHandler,
  NativeEventEmitter,
  Image,
  KeyboardAvoidingView,
  Platform,
  AppState,
  AppStateStatus,
  Keyboard,
  Modal,
} from 'react-native';
import { LogUtils } from '../utils/logging';
import { 
  clearInactivityTimer, 
  startInactivityTimer, 
  resetInactivityTimer 
} from '../utils/inactivityTimer';
import DeviceStorage from '../../utils/deviceStorage';

// Access the global object in a way that works in React Native
const globalAny: any = global;

// Speed settings from config
const SPEEDS = {
  patrol: 0.3,      // Default patrol speed if config not available
  productSearch: 0.7, // Default product search speed if config not available
  default: 0.5      // Default speed for other operations
};

// Define robot base error types
const RobotBaseErrorTypes = {
  NAVIGATION_TIMEOUT: 'navigation_timeout',
  PATH_BLOCKED: 'path_blocked',
  HARDWARE_FAILURE: 'hardware_failure',
  LOCALIZATION_LOST: 'localization_lost',
  COMMUNICATION_ERROR: 'communication_error',
  UNKNOWN_ERROR: 'unknown_error'
};

// Maximum recovery attempts
const MAX_RECOVERY_ATTEMPTS = 3;

// Load speeds from config
const loadSpeeds = async () => {
  try {
    // Check if ConfigManagerModule is available
    if (NativeModules.ConfigManagerModule) {
      const speeds = await NativeModules.ConfigManagerModule.getSpeeds();
      if (speeds) {
        SPEEDS.patrol = speeds.patrol;
        SPEEDS.productSearch = speeds.productSearch;
        SPEEDS.default = speeds.default;
        await LogUtils.writeDebugToFile(`Loaded speeds from config: patrol=${SPEEDS.patrol}, productSearch=${SPEEDS.productSearch}, default=${SPEEDS.default}`);
      }
    }
  } catch (error: any) {
    await LogUtils.writeDebugToFile(`Failed to load speeds from config: ${error.message}`);
  }
};

// Load speeds immediately
loadSpeeds();

// Inactivity timeout duration (20 seconds for testing)
const INACTIVITY_TIMEOUT = 20000;

// Global variables to track promotion state across component lifecycles
globalAny.promotionActive = false;
let promotionMounted = false;
let promotionCancelled = false;
let currentPointIndex = 0;
let remountFromConfig = false;  // Add flag to track if we're remounting after config
let navigatingToConfig = false; // Add flag to track if we're navigating to config

// Global references for functions
globalAny.clearInactivityTimer = null;
globalAny.restartPromotion = null;

// Define patrol points as a state variable instead of a constant
let patrolPoints: Array<{name: string, x: number, y: number, yaw: number}> = [];

// Add token refresh interval (55 minutes to refresh before expiration)
const TOKEN_REFRESH_INTERVAL = 55 * 60 * 1000;
// Add token validation interval (15 minutes)
const TOKEN_VALIDATION_INTERVAL = 15 * 60 * 1000;
// Add token expiration time estimate (60 minutes)
const TOKEN_EXPIRATION_TIME = 60 * 60 * 1000;

// Create a shared auth state object
const AuthState = {
  lastRefreshTime: 0,
  isRefreshing: false,
  tokenValid: false,
  validationInProgress: false,
  lastValidationTime: 0,
};

interface MainScreenProps {
  onClose: () => void;
  onConfigPress: () => void;
  initialProducts: any[];
}

interface Product {
  name: string;
  eslCode: string;
  description?: string;
  pose: {
    x: number;
    y: number;
    z: number;
    yaw?: number;  // Optional yaw value
    px?: number;   // Alternative position format
    py?: number;
    pz?: number;
  };
  id?: string;     // ID from the backend
  image?: string;  // Image filename from the backend
}

// Navigation status states
enum NavigationStatus {
  IDLE,
  NAVIGATING,
  ARRIVED,
  ERROR,
  PATROL  // Add PATROL as a new status
}

// Define a global function that will persist even when the component is unmounted
globalAny.startPromotion = async () => {
  await LogUtils.writeDebugToFile('Promotion activated globally');
  
  // Set the promotion state
  promotionCancelled = false;
  currentPointIndex = 0;
  globalAny.promotionActive = true;
  
  // Reset the remountFromConfig flag to ensure promotion starts even when coming from config screen
  remountFromConfig = false;
  
  // Set robot speed to patrol speed immediately
  try {
    await NativeModules.SlamtecUtils.setMaxLineSpeed(SPEEDS.patrol.toString());
    await LogUtils.writeDebugToFile(`Set robot speed to patrol mode: ${SPEEDS.patrol} m/s`);
  } catch (error: any) {
    await LogUtils.writeDebugToFile(`Failed to set patrol speed: ${error.message}`);
  }
  
  // If the MainScreen is mounted, we can start the promotion immediately
  if (promotionMounted) {
    await LogUtils.writeDebugToFile('MainScreen is mounted, starting promotion immediately');
    
    // Clear any inactivity timer when manually starting promotion
    if (globalAny.clearInactivityTimer && typeof globalAny.clearInactivityTimer === 'function') {
      globalAny.clearInactivityTimer();
      await LogUtils.writeDebugToFile('Cleared inactivity timer for manual promotion start');
    }
    
    return true;
  } else {
    // Otherwise, the promotion will start when the MainScreen mounts
    await LogUtils.writeDebugToFile('MainScreen not mounted, promotion will start when it mounts');
    return true;
  }
};

const MainScreen = ({ onClose, onConfigPress, initialProducts }: MainScreenProps): React.JSX.Element => {
  const [searchText, setSearchText] = useState('');
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>(initialProducts);
  const [isLoading, setIsLoading] = useState(false);
  const [navigationStatus, setNavigationStatus] = useState<NavigationStatus>(NavigationStatus.IDLE);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [navigationError, setNavigationError] = useState<string>('');
  
  // Add state to track if patrol is active - start with false since we won't auto-start
  const [isPatrolling, setIsPatrolling] = useState(false);
  
  // Add ref to track inactivity timer
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Add ref to track token refresh interval
  const tokenRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Add ref to track if navigation has been cancelled
  const navigationCancelledRef = useRef(false);
  
  // Store patrol state in a ref to access in useEffect cleanup
  const isPatrollingRef = useRef(false);
  
  // Set the mounted ref to true
  const isMountedRef = useRef(true);
  
  // Robot call data state
  const [robotCallData, setRobotCallData] = useState<any>(null);
  const [isRobotCallLoading, setIsRobotCallLoading] = useState(false);
  const [lastRobotCallHandled, setLastRobotCallHandled] = useState(false);
  const robotCallCooldownRef = useRef<NodeJS.Timeout | null>(null);
  
  // Add polling interval ref
  const robotCallPollingRef = useRef<NodeJS.Timeout | null>(null);
  
  // Add ref to track token validation interval
  const tokenValidationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Add ref to track app state
  const appStateRef = useRef(AppState.currentState);
  
  // Add posePollingRef to track the interval for robot pose polling
  const posePollingRef = useRef<NodeJS.Timeout | null>(null);
  
  // Add a ref to track current navigation status for use in polling
  const currentNavigationStatusRef = useRef(NavigationStatus.IDLE);
  
  // Add new state variables for error handling
  const [robotBaseStatus, setRobotBaseStatus] = useState<string>('ok');
  const [recoveryAttempts, setRecoveryAttempts] = useState<number>(0);
  
  // Add these near the top of the file with other state declarations
  const [robotSpeed, setRobotSpeed] = useState(SPEEDS.default);
  const defaultSpeed = SPEEDS.default;
  
  // Add battery monitoring state
  const [batteryLevel, setBatteryLevel] = useState<number>(100);
  const [isLowBatteryAlertShown, setIsLowBatteryAlertShown] = useState(false);
  const [isReturningToCharger, setIsReturningToCharger] = useState(false);
  const returnToChargerAlertRef = useRef<{ dismiss: () => void } | null>(null);
  const [showPatrolDialog, setShowPatrolDialog] = useState(false);
  const batteryMonitoringInitializedRef = useRef(false);
  
  // Add this with other refs at the top of the component
  const isReturningToChargerRef = useRef(false);

  // Function to handle battery status updates
  const handleBatteryStatusUpdate = async (event: any) => {
    await LogUtils.writeDebugToFile(`[BATTERY] Battery status update event received`);

    // Get power status first as it's our source of truth
    try {
      const powerStatus = await NativeModules.SlamtecUtils.getPowerStatus();
      await LogUtils.writeDebugToFile(`[BATTERY] Power status response: ${JSON.stringify(powerStatus)}`);
      
      // Set battery level from power status immediately
      setBatteryLevel(powerStatus.batteryPercentage);
      await LogUtils.writeDebugToFile(`[BATTERY] Battery level updated to: ${powerStatus.batteryPercentage}%`);
      
      // Only proceed if not on dock AND battery is low
      if (powerStatus.dockingStatus !== 'on_dock' && powerStatus.batteryPercentage <= 20 && !isReturningToChargerRef.current) {
        await LogUtils.writeDebugToFile('Initiating return to charger due to low battery');
        
        // Cancel any ongoing patrol
        if (isPatrolling) {
          LogUtils.writeDebugToFile('Cancelling ongoing patrol due to low battery');
          await cancelPatrol('battery_return');
        }

        // Clear the inactivity timer when returning to charger
        clearInactivityTimer();
        await LogUtils.writeDebugToFile('Cleared inactivity timer due to return to charger');

        // Set returning to charger state using both ref and state
        isReturningToChargerRef.current = true;
        setIsReturningToCharger(true);
        await LogUtils.writeDebugToFile(`isReturningToCharger value after setting: ${isReturningToChargerRef.current}`);

        // Call handleReturnToList to handle the return to charger
        handleReturnToList();
      }
    } catch (error) {
      console.error('Error checking power status:', error);
      LogUtils.writeDebugToFile('Error checking power status: ' + error);
    }
  };

  // Add effect to start battery monitoring
  useEffect(() => {
    const initializeBatteryMonitoring = async () => {
      // Skip if already initialized
      if (batteryMonitoringInitializedRef.current) {
        await LogUtils.writeDebugToFile('Battery monitoring already initialized, skipping');
        return;
      }

      try {
        // Check if BatteryMonitor module exists
        if (!NativeModules.BatteryMonitor) {
          await LogUtils.writeDebugToFile('BatteryMonitor module not found');
          return;
        }

        // Start battery monitoring
        await LogUtils.writeDebugToFile('Starting battery monitoring...');
        NativeModules.BatteryMonitor.startMonitoring();
        
        // Add event listener for battery updates
        const eventEmitter = new NativeEventEmitter(NativeModules.BatteryMonitor);
        const subscription = eventEmitter.addListener('BatteryStatusUpdate', handleBatteryStatusUpdate);
        
        await LogUtils.writeDebugToFile('Battery monitoring initialized successfully');
        batteryMonitoringInitializedRef.current = true;
        
        // Return cleanup function
        return () => {
          // Clean up
          if (NativeModules.BatteryMonitor) {
            NativeModules.BatteryMonitor.stopMonitoring();
          }
          subscription.remove();
          LogUtils.writeDebugToFile('Battery monitoring stopped');
          batteryMonitoringInitializedRef.current = false;
        };
      } catch (error: any) {
        await LogUtils.writeDebugToFile(`Error initializing battery monitoring: ${error.message}`);
      }
    };

    // Call initializeBatteryMonitoring and store the cleanup function
    const cleanup = initializeBatteryMonitoring();
    
    // Return cleanup function from useEffect
    return () => {
      if (cleanup) {
        cleanup.then(cleanupFn => {
          if (cleanupFn) cleanupFn();
        });
      }
    };
  }, []);
  
  // Function to clear the inactivity timer
  const clearInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
      LogUtils.writeDebugToFile('Inactivity timer cleared');
    } else {
      LogUtils.writeDebugToFile('Inactivity timer clear called, but no timer was running');
    }
  };
  
  // Store the clearInactivityTimer function in the global scope
  globalAny.clearInactivityTimer = clearInactivityTimer;
  
  // Function to start the inactivity timer
  const startInactivityTimer = () => {
    clearInactivityTimer();
    
    inactivityTimerRef.current = setTimeout(() => {
      if (globalAny.promotionActive && !promotionCancelled && isMountedRef.current && !isReturningToCharger) {
        restartPromotion();
      }
    }, INACTIVITY_TIMEOUT);
  };
  
  // Function to restart the promotion
  const restartPromotion = async () => {
    try {
      LogUtils.writeDebugToFile('restartPromotion called');
      // Only restart if we're not already in promotion mode
      if (!isPatrollingRef.current && isMountedRef.current) {
        await LogUtils.writeDebugToFile('Auto-restarting promotion after inactivity');
        
        // Use the same logic as the global startPromotion function
        promotionCancelled = false;
        // Don't reset currentPointIndex, preserve it for resuming patrol
        globalAny.promotionActive = true;
        
        // Set patrol state to active
        setIsPatrolling(true);
        isPatrollingRef.current = true;
        
        // Reset navigation cancelled flag to ensure navigation can start
        navigationCancelledRef.current = false;
        
        // Set navigation status to PATROL immediately to show the promotion screen
        setNavigationStatus(NavigationStatus.PATROL);
        
        // Set robot speed to patrol speed
        try {
          await NativeModules.SlamtecUtils.setMaxLineSpeed(SPEEDS.patrol.toString());
          await LogUtils.writeDebugToFile(`Set robot speed to patrol mode: ${SPEEDS.patrol} m/s`);
        } catch (error: any) {
          await LogUtils.writeDebugToFile(`Failed to set patrol speed: ${error.message}`);
        }
        
        // Start navigation with a small delay to ensure UI has updated
        setTimeout(() => {
          if (isMountedRef.current && !navigationCancelledRef.current) {
            LogUtils.writeDebugToFile(`Starting navigation to waypoint ${currentPointIndex + 1} after auto-restart`);
            // Ensure patrol state is still active
            isPatrollingRef.current = true;
            navigateToNextPoint();
          } else {
            LogUtils.writeDebugToFile(`Navigation not starting after auto-restart: isMounted=${isMountedRef.current}, navigationCancelled=${navigationCancelledRef.current}`);
          }
        }, 1000); // Increased delay to 1 second for more reliable startup
      } else {
        await LogUtils.writeDebugToFile(`restartPromotion: Not restarting because isPatrolling=${isPatrollingRef.current}, isMounted=${isMountedRef.current}`);
      }
    } catch (error: any) {
      await LogUtils.writeDebugToFile(`Error auto-restarting promotion: ${error.message}`);
    }
  };
  
  // Store the restartPromotion function in the global scope
  globalAny.restartPromotion = restartPromotion;
  
  // Function to navigate to the next patrol point
  const navigateToNextPoint = async () => {
    // Log the current state for debugging
    await LogUtils.writeDebugToFile(`navigateToNextPoint called. State: isPatrolling=${isPatrollingRef.current}, isMounted=${isMountedRef.current}, navigationCancelled=${navigationCancelledRef.current}, promotionCancelled=${promotionCancelled}`);
    
    // Don't continue if patrol has been cancelled or component unmounted
    if (!isPatrollingRef.current || !isMountedRef.current || navigationCancelledRef.current || promotionCancelled) {
      await LogUtils.writeDebugToFile('Waypoint sequence cancelled or component unmounted, stopping sequence');
      return;
    }
    
    // Check if patrol points are loaded
    if (patrolPoints.length === 0) {
      await LogUtils.writeDebugToFile('No patrol points loaded, stopping patrol');
      setNavigationStatus(NavigationStatus.ERROR);
      setNavigationError('No patrol points configured');
      return;
    }
    
    if (currentPointIndex < patrolPoints.length) {
      const point = patrolPoints[currentPointIndex];
      await LogUtils.writeDebugToFile(`Starting navigation to ${point.name} (index: ${currentPointIndex})`);
      try {
        // Double check patrol state before proceeding
        if (!isPatrollingRef.current || !isMountedRef.current || navigationCancelledRef.current || promotionCancelled) {
          await LogUtils.writeDebugToFile('Patrol conditions changed before navigation, aborting');
          return;
        }
        
        // Always keep in PATROL state, don't change to other states during patrol
        setNavigationStatus(NavigationStatus.PATROL);
        setSelectedProduct({
          name: point.name,
          eslCode: `PP${currentPointIndex + 1}`,
          pose: {
            x: point.x,
            y: point.y,
            z: 0,
            yaw: point.yaw
          }
        });
        
        // Log navigation parameters for debugging
        await LogUtils.writeDebugToFile(`Navigating to coordinates: x=${point.x}, y=${point.y}, yaw=${point.yaw}`);
        
        await NativeModules.SlamtecUtils.navigate(
          point.x,
          point.y,
          point.yaw
        );
        
        // Don't update state if component unmounted or patrol cancelled
        if (!isPatrollingRef.current || !isMountedRef.current || navigationCancelledRef.current || promotionCancelled) {
          await LogUtils.writeDebugToFile('Patrol conditions changed after navigation, not proceeding to next point');
          return;
        }
        
        await LogUtils.writeDebugToFile(`Navigation to ${point.name} completed`);
        
        // Don't change navigation status to ARRIVED, keep it in PATROL
        // setNavigationStatus(NavigationStatus.ARRIVED);
        
        currentPointIndex++;
        
        // Move to next point immediately - no timer needed
        // This will only happen after the previous navigation completes
        navigateToNextPoint();
      } catch (error: any) {
        // Don't update state if component unmounted or patrol cancelled
        if (!isPatrollingRef.current || !isMountedRef.current || navigationCancelledRef.current || promotionCancelled) return;
        
        await LogUtils.writeDebugToFile(`Error during navigation to ${point.name}: ${error.message}`);
        setNavigationStatus(NavigationStatus.ERROR);
        setNavigationError(error.message || 'Navigation failed');
      }
    } else {
      // Instead of returning home, reset the index and continue the loop
      if (isPatrollingRef.current && isMountedRef.current && !navigationCancelledRef.current && !promotionCancelled) {
        await LogUtils.writeDebugToFile('Completed one cycle of waypoints, looping back to the beginning');
        currentPointIndex = 0; // Reset to the first waypoint
        navigateToNextPoint(); // Continue the loop
      }
    }
  };
  
  // Update ref when state changes
  useEffect(() => {
    isPatrollingRef.current = isPatrolling;
    LogUtils.writeDebugToFile(`Patrol state changed to: ${isPatrolling ? 'active' : 'inactive'}`);
  }, [isPatrolling]);
  
  // Handle hardware back button (Android)
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
  
    // Add event listener for SlamtecDebug events
    const eventEmitter = new NativeEventEmitter(NativeModules.SlamtecUtils);
    const subscription = eventEmitter.addListener('SlamtecDebug', (event) => {
      if (event.type === 'debug') {
        LogUtils.writeDebugToFile(event.message);
      }
    });
  
    return () => {
      backHandler.remove();
      subscription.remove();
    };
  }, []);
  
  // Effect to handle component mount/unmount and promotion state
  useEffect(() => {
    // Set the mounted ref to true
    isMountedRef.current = true;
    
    if(globalAny.promotionActive) {
      promotionMounted = true;
      globalAny.promotionActive = true;
      globalAny.promotionCancelled = false;
      globalAny.currentPointIndex = 0;
    }
    
    // Log the current promotion state
    LogUtils.writeDebugToFile(`MainScreen mounted. Promotion state: active=${globalAny.promotionActive}, cancelled=${promotionCancelled}, currentPointIndex=${currentPointIndex}, remountFromConfig=${remountFromConfig}`);
    
    // Only start promotion if it was explicitly activated via the global startPromotion function
    // and not cancelled, and we're not remounting after config screen
    if (globalAny.promotionActive && !promotionCancelled) {
      LogUtils.writeDebugToFile('Active promotion detected on mount, starting navigation to first waypoint');
      
      // Set patrol state to active
      setIsPatrolling(true);
      isPatrollingRef.current = true;
      
      // Set navigation status to PATROL immediately to show the promotion screen
      setNavigationStatus(NavigationStatus.PATROL);
      
      // Set robot speed to patrol speed
      (async () => {
        try {
          await NativeModules.SlamtecUtils.setMaxLineSpeed(SPEEDS.patrol.toString());
          await LogUtils.writeDebugToFile(`Set robot speed to patrol mode: ${SPEEDS.patrol} m/s when mounting`);
        } catch (error: any) {
          await LogUtils.writeDebugToFile(`Failed to set patrol speed when mounting: ${error.message}`);
        }
      })();
      
      // Start navigation with a small delay
      setTimeout(() => {
        if (isPatrollingRef.current && isMountedRef.current && !navigationCancelledRef.current) {
          LogUtils.writeDebugToFile('Starting navigation to first waypoint');
          navigateToNextPoint();
        } else {
          LogUtils.writeDebugToFile(`Navigation not starting: isMounted=${isMountedRef.current}, navigationCancelled=${navigationCancelledRef.current}`);
        }
      }, 500);
    }

    return () => {
      isMountedRef.current = false;
      promotionMounted = false;
    };
  }, []);

  // Effect to handle automatic closing of ARRIVED screen
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    if (navigationStatus === NavigationStatus.ARRIVED) {
      timeoutId = setTimeout(() => {
        if (isMountedRef.current) {
          handleReturnToList();
        }
      }, 5000); // 5 seconds
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [navigationStatus]);
  
  // Filter products when search text changes
  useEffect(() => {
    if (searchText) {
      const filtered = products.filter(product => 
        product.name.toLowerCase().includes(searchText.toLowerCase()) ||
        product.eslCode.toLowerCase().includes(searchText.toLowerCase())
      ).sort((a, b) => a.name.localeCompare(b.name));
      setFilteredProducts(filtered);
    } else {
      setFilteredProducts([...products].sort((a, b) => a.name.localeCompare(b.name)));
    }
  }, [searchText, products]);
  
  // Add proactive token validation function
  const validateToken = async (force = false): Promise<boolean> => {
    LogUtils.writeDebugToFile(`validateToken called (force=${force})`);
    // Skip validation if already in progress or if not enough time has passed
    if (AuthState.validationInProgress) {
      await LogUtils.writeDebugToFile('Token validation already in progress, skipping');
      return AuthState.tokenValid;
    }
    
    const now = Date.now();
    if (!force && AuthState.lastValidationTime > 0 && now - AuthState.lastValidationTime < 60000) {
      await LogUtils.writeDebugToFile('Token validation was performed recently, skipping');
      return AuthState.tokenValid;
    }
    
    try {
      AuthState.validationInProgress = true;
      await LogUtils.writeDebugToFile('Proactively validating authentication token');
      
      // Check if token is likely expired based on last refresh time
      if (AuthState.lastRefreshTime > 0 && now - AuthState.lastRefreshTime > TOKEN_EXPIRATION_TIME) {
        await LogUtils.writeDebugToFile('Token likely expired based on time, refreshing');
        return await refreshToken(); // Refresh and return result
      }
      
      // Make a lightweight API call to verify the token is still valid
      // For example, try to fetch a minimal piece of data
      try {
        const result = await NativeModules.DomainUtils.testTokenValidity();
        await LogUtils.writeDebugToFile(`Token validation successful: ${JSON.stringify(result)}`);
        AuthState.tokenValid = true;
        AuthState.lastValidationTime = now;
        return true;
      } catch (validationError: any) {
        await LogUtils.writeDebugToFile(`Token validation failed: ${validationError.message}`);
        
        // If validation fails, try to refresh the token
        if (validationError.message?.includes('token') || 
            validationError.message?.includes('unauthorized') || 
            validationError.message?.includes('401')) {
          await LogUtils.writeDebugToFile('Token invalid, attempting refresh');
          return await refreshToken(); // Refresh and return result
        }
        
        // For other errors, consider the token still valid (might be network issues)
        return AuthState.tokenValid;
      }
    } catch (error: any) {
      await LogUtils.writeDebugToFile(`Error during token validation: ${error.message}`);
      return AuthState.tokenValid;
    } finally {
      AuthState.validationInProgress = false;
    }
  };

  // Enhanced token refresh function
  const refreshToken = async (retryAttempt = 0): Promise<boolean> => {
    // Skip if already refreshing
    if (AuthState.isRefreshing) {
      await LogUtils.writeDebugToFile('Token refresh already in progress, skipping');
      return AuthState.tokenValid;
    }
    
    try {
      AuthState.isRefreshing = true;
      await LogUtils.writeDebugToFile(`Refreshing authentication token (attempt ${retryAttempt + 1}/4)`);
      
      const result = await NativeModules.DomainUtils.refreshToken();
      AuthState.lastRefreshTime = Date.now();
      AuthState.tokenValid = true;
      
      await LogUtils.writeDebugToFile(`Token refresh successful at ${new Date(AuthState.lastRefreshTime).toISOString()}`);
      return true;
    } catch (error: any) {
      await LogUtils.writeDebugToFile(`Token refresh attempt ${retryAttempt + 1} failed: ${error.message}`);
      
      // Log detailed error information
      if (error.code) {
        await LogUtils.writeDebugToFile(`Error code: ${error.code}`);
      }
      if (error.response) {
        await LogUtils.writeDebugToFile(`Response data: ${JSON.stringify(error.response.data || {})}`);
        await LogUtils.writeDebugToFile(`Response status: ${error.response.status}`);
      }
      
      // If we haven't tried 3 times yet, retry with exponential backoff
      if (retryAttempt < 3) {
        const backoffDelay = Math.pow(2, retryAttempt) * 1000; // 1s, 2s, 4s backoff
        await LogUtils.writeDebugToFile(`Retrying token refresh in ${backoffDelay}ms...`);
        
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        AuthState.isRefreshing = false;
        return refreshToken(retryAttempt + 1);
      }
      
      AuthState.tokenValid = false;
      return false;
    } finally {
      AuthState.isRefreshing = false;
    }
  };

  // Function to handle app state changes
  const handleAppStateChange = async (nextAppState: AppStateStatus) => {
    // Log the state change
    await LogUtils.writeDebugToFile(`App state changed from ${appStateRef.current} to ${nextAppState}`);
    
    // Check if app is coming to foreground
    if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
      await LogUtils.writeDebugToFile('App came to foreground, validating token');
      // Validate token when app comes to foreground
      validateToken(true);
    }
    
    // Update app state ref
    appStateRef.current = nextAppState;
  };

  // Effect to handle app state changes
  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription.remove();
    };
  }, []);

  // Effect to handle initial token validation and set up intervals
  useEffect(() => {
    // Initial token validation
    (async () => {
      await LogUtils.writeDebugToFile('Performing initial token validation');
      await validateToken(true);
    })();
    
    // Set up token validation interval
    tokenValidationIntervalRef.current = setInterval(validateToken, TOKEN_VALIDATION_INTERVAL);
    
    // Set up token refresh interval
    tokenRefreshIntervalRef.current = setInterval(async () => {
      await LogUtils.writeDebugToFile('Scheduled token refresh interval triggered');
      await refreshToken();
    }, TOKEN_REFRESH_INTERVAL);
    
    // Clean up on unmount
    return () => {
      if (tokenValidationIntervalRef.current) {
        clearInterval(tokenValidationIntervalRef.current);
        tokenValidationIntervalRef.current = null;
        LogUtils.writeDebugToFile('Cleared token validation interval');
      }
      
      if (tokenRefreshIntervalRef.current) {
        clearInterval(tokenRefreshIntervalRef.current);
        tokenRefreshIntervalRef.current = null;
        LogUtils.writeDebugToFile('Cleared token refresh interval');
      }
    };
  }, []);

  const handleProductSelect = async (product: Product) => {
    // Clear any inactivity timer when starting new navigation
    clearInactivityTimer();
    
    // Reset recovery attempts counter when starting new navigation
    setRecoveryAttempts(0);
    
    // Clear the search text immediately when a product is selected
    setSearchText('');
    
    // Cancel any ongoing patrol
    setIsPatrolling(false);
    //globalAny.promotionActive = false;
    //promotionCancelled = true;
    await LogUtils.writeDebugToFile('Waypoint sequence cancelled due to product selection');
    
    // Reset navigation cancelled flag
    navigationCancelledRef.current = false;
    
    await LogUtils.writeDebugToFile(`Starting navigation to: ${product.name}`);
    setSelectedProduct(product);
    setNavigationStatus(NavigationStatus.NAVIGATING);
    
    // Set robot speed to product search speed (faster)
    try {
      await NativeModules.SlamtecUtils.setMaxLineSpeed(SPEEDS.productSearch.toString());
      await LogUtils.writeDebugToFile(`Set robot speed to product search mode: ${SPEEDS.productSearch} m/s`);
    } catch (error: any) {
      await LogUtils.writeDebugToFile(`Failed to set product search speed: ${error.message}`);
    }
    
    const attemptNavigation = async (retryCount = 0) => {
      try {
        // Validate token before attempting navigation
        if (!await validateToken()) {
          await LogUtils.writeDebugToFile('Token validation failed before navigation, attempting refresh');
          
          if (!await refreshToken()) {
            // If token refresh fails, show error dialog
            await LogUtils.writeDebugToFile('Token refresh failed, cannot proceed with navigation');
            
            Alert.alert(
              'Authentication Error',
              'Your session has expired and automatic renewal failed. Please try again or restart the application.',
              [
                { 
                  text: 'Return to List', 
                  onPress: () => {
                    setNavigationStatus(NavigationStatus.ERROR);
                    setNavigationError('Session expired. Please try again.');
                  }
                }
              ]
            );
            return;
          }
        }
        
        // Get product coordinates
        const poseZ = product.pose.pz || product.pose.z;
        const coords = {
          x: product.pose.px || product.pose.x,
          y: 0,
          z: poseZ
        };
    
        await LogUtils.writeDebugToFile(`Requesting navmesh coordinates for: ${JSON.stringify(coords)}`);
        const navTarget = await NativeModules.DomainUtils.getNavmeshCoord(coords);
        
        // Log the full structure of navTarget
        await LogUtils.writeDebugToFile(`Received navTarget: ${JSON.stringify(navTarget)}`);
    
        // Detailed validation
        if (!navTarget) {
          throw new Error('No navTarget received');
        }
        
        // Check if we're getting the expected structure or direct coordinates
        const targetCoords = navTarget.transformedCoords || navTarget;
        
        if (typeof targetCoords.x === 'undefined' || typeof targetCoords.z === 'undefined') {
          throw new Error(`Invalid coordinates: ${JSON.stringify(targetCoords)}`);
        }
    
        await LogUtils.writeDebugToFile(`Raw targetCoords: ${JSON.stringify(targetCoords, null, 2)}`);
        const navigationParams = {
          x: targetCoords.x,
          y: targetCoords.z,  // z is passed as y
          yaw: targetCoords.yaw || -Math.PI
        };
        await LogUtils.writeDebugToFile(`Calling navigateProduct with exact params: ${JSON.stringify(navigationParams, null, 2)}`);
        
        try {
          await LogUtils.writeDebugToFile('Starting navigation command...');
          await NativeModules.SlamtecUtils.navigateProduct(
            targetCoords.x,
            targetCoords.z,  // Pass z as y since the API expects (x,y) plane movement
            targetCoords.yaw || -Math.PI
          );
          
          // Check if navigation was cancelled during the process
          if (navigationCancelledRef.current) {
            await LogUtils.writeDebugToFile('Navigation was cancelled during product navigation, not updating status');
            return;
          }
          
          await LogUtils.writeDebugToFile('Navigation command completed');
          await LogUtils.writeDebugToFile('Setting navigation status to ARRIVED');
          
          // Only start the inactivity timer if auto-promotion is enabled in the configuration
          // This prevents promotion from automatically starting after a user-initiated navigation
          try {
            const autoPromotionEnabled = await NativeModules.ConfigManagerModule.getAutoPromotionEnabled();
            if (autoPromotionEnabled) {
              await LogUtils.writeDebugToFile('Auto-promotion enabled, starting inactivity timer after arriving at product');
              startInactivityTimer();
            } else {
              await LogUtils.writeDebugToFile('Auto-promotion disabled, not starting inactivity timer');
            }
          } catch (error) {
            // Default to not starting promotion if we can't check the config
            await LogUtils.writeDebugToFile('Error checking auto-promotion config, defaulting to not starting timer');
          }
          
          // Add a small delay to ensure state updates are processed
          await new Promise(resolve => setTimeout(resolve, 100));
          
          if (!navigationCancelledRef.current) {
            await LogUtils.writeDebugToFile('Navigation completed, showing arrival screen');
            setNavigationStatus(NavigationStatus.ARRIVED);
          }
        } catch (error: any) {
          // Check if navigation was cancelled
          if (navigationCancelledRef.current) {
            await LogUtils.writeDebugToFile('Navigation was cancelled, not processing error');
            return;
          }
          
          // Classify error type
          const errorType = classifyErrorType(error.message || 'Unknown error');
          
          // Check if error is due to token expiration
          if (error.message?.includes('token') || error.message?.includes('unauthorized') || error.message?.includes('401')) {
            await LogUtils.writeDebugToFile('Token expired, attempting to refresh');
            
            if (retryCount < 3) {  // Allow up to 3 retries instead of just 1
              const refreshed = await refreshToken();
              if (refreshed) {
                await LogUtils.writeDebugToFile(`Token refreshed, retrying navigation (attempt ${retryCount + 1}/3)`);
                return attemptNavigation(retryCount + 1);
              }
            }
            
            // If we've exhausted all retries or refresh failed, show error dialog
            await LogUtils.writeDebugToFile('Token refresh failed or max retries reached');
            
            // Show a more informative error dialog
            Alert.alert(
              'Authentication Error',
              'Your session has expired and automatic renewal failed. Please try again or restart the application.',
              [
                { 
                  text: 'Return to List', 
                  onPress: () => {
                    setNavigationStatus(NavigationStatus.ERROR);
                    setNavigationError(error.message || 'Session expired. Please try again.');
                  }
                }
              ]
            );
            return;
          }
          
          // Handle robot base error with automatic recovery
          await handleRobotBaseError(error.message || 'Navigation failed', errorType);
        }
      } catch (error: any) {
        // Check if navigation was cancelled
        if (navigationCancelledRef.current) {
          await LogUtils.writeDebugToFile('Navigation was cancelled, not processing outer error');
          return;
        }
        
        // Classify error type
        const errorType = classifyErrorType(error.message || 'Unknown error');
        
        // Check if error is due to token expiration
        if (error.message?.includes('token') || error.message?.includes('unauthorized') || error.message?.includes('401')) {
          await LogUtils.writeDebugToFile('Token expired, attempting to refresh');
          
          if (retryCount < 3) {  // Allow up to 3 retries instead of just 1
            const refreshed = await refreshToken();
            if (refreshed) {
              await LogUtils.writeDebugToFile(`Token refreshed, retrying navigation (attempt ${retryCount + 1}/3)`);
              return attemptNavigation(retryCount + 1);
            }
          }
          
          // If we've exhausted all retries or refresh failed, show error dialog
          await LogUtils.writeDebugToFile('Token refresh failed or max retries reached');
          
          // Show a more informative error dialog
          Alert.alert(
            'Authentication Error',
            'Your session has expired and automatic renewal failed. Please try again or restart the application.',
            [
              { 
                text: 'Return to List', 
                onPress: () => {
                  setNavigationStatus(NavigationStatus.ERROR);
                  setNavigationError(error.message || 'Session expired. Please try again.');
                }
              }
            ]
          );
          return;
        }
        
        // Handle robot base error with automatic recovery
        await handleRobotBaseError(error.message || 'Navigation preparation failed', errorType);
      }
    };
    
    // Start the navigation attempt
    await attemptNavigation();
  };
  
  const handleClose = () => {
    Alert.alert(
      'Exit App',
      'Are you sure you want to exit?',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Exit',
          onPress: async () => {
            await LogUtils.writeDebugToFile('User confirmed app exit');
            BackHandler.exitApp();
          }
        }
      ],
      { cancelable: true }
    );
  };
  
  const handleReturnToList = async () => {
    try {
      // Mark navigation as cancelled
      navigationCancelledRef.current = true;
      
      // Reset recovery attempts counter
      setRecoveryAttempts(0);
      
      // Log the actual value of isReturningToCharger
      await LogUtils.writeDebugToFile(`handleReturnToList - isReturningToCharger value: ${isReturningToChargerRef.current}`);
      
      // Set promotion flags first if returning to charger
      if (isReturningToChargerRef.current) {
        promotionCancelled = true;
        globalAny.promotionActive = false;
        await LogUtils.writeDebugToFile('Promotion cancelled due to low battery return to charger');
      }
      
      // Don't cancel navigation if we're returning to charger due to low battery
      if (!isReturningToChargerRef.current) {
        // Cancel patrol sequence
        setIsPatrolling(false);
        isPatrollingRef.current = false;
        await LogUtils.writeDebugToFile('Waypoint sequence cancelled');
        
        // Stop the robot's movement
        await NativeModules.SlamtecUtils.stopNavigation();
        await LogUtils.writeDebugToFile('Robot movement stopped');
        
        // Reset UI state
        setSelectedProduct(null);
        setNavigationStatus(NavigationStatus.IDLE);
        
        // Only start inactivity timer if promotion is active and not cancelled
        if (globalAny.promotionActive && !promotionCancelled) {
          await LogUtils.writeDebugToFile('Promotion active, starting inactivity timer after returning to list');
          startInactivityTimer();
        } else {
          await LogUtils.writeDebugToFile('Promotion inactive or cancelled, not starting inactivity timer');
        }
      } else {
        await LogUtils.writeDebugToFile('Not cancelling navigation - returning to charger due to low battery');
        // Keep navigation status as NAVIGATING while returning to charger
        setNavigationStatus(NavigationStatus.NAVIGATING);

        // Start going home
        await NativeModules.SlamtecUtils.goHome();
        await LogUtils.writeDebugToFile('Initiating return to charger');

        // Check if robot is already on dock
        const powerStatus = await NativeModules.SlamtecUtils.getPowerStatus();
        if (powerStatus.dockingStatus === 'on_dock') {
          isReturningToChargerRef.current = false;
          setIsReturningToCharger(false);
          setNavigationStatus(NavigationStatus.IDLE);
          await LogUtils.writeDebugToFile('Robot already on dock, resetting return to charger state');
        }
      }
      
      // If we just handled a robot call, implement cooldown period before restarting polling
      if (lastRobotCallHandled) {
        await LogUtils.writeDebugToFile('Robot call cooldown period starting (60 seconds)');
        // Will be reset in the useEffect
      }
    } catch (error) {
      // Even if stopping fails, still cancel patrol and return to list
      navigationCancelledRef.current = true;
      
      // Reset recovery attempts counter
      setRecoveryAttempts(0);
      
      // Set promotion flags first if returning to charger
      if (isReturningToChargerRef.current) {
        promotionCancelled = true;
        globalAny.promotionActive = false;
        await LogUtils.writeDebugToFile('Promotion cancelled due to low battery return to charger (error handler)');
      }
      
      // Don't cancel navigation if we're returning to charger due to low battery
      if (!isReturningToChargerRef.current) {
        // Cancel patrol sequence
        setIsPatrolling(false);
        isPatrollingRef.current = false;
        await LogUtils.writeDebugToFile('Waypoint sequence cancelled in error handler');
        
        // Reset UI state
        setSelectedProduct(null);
        setNavigationStatus(NavigationStatus.IDLE);
        
        // Only start inactivity timer if promotion is active and not cancelled
        if (globalAny.promotionActive && !promotionCancelled) {
          await LogUtils.writeDebugToFile('Promotion active, starting inactivity timer after error');
          startInactivityTimer();
        } else {
          await LogUtils.writeDebugToFile('Promotion inactive or cancelled, not starting inactivity timer after error');
        }
      } else {
        await LogUtils.writeDebugToFile('Not cancelling navigation in error handler - returning to charger due to low battery');
        // Keep navigation status as NAVIGATING while returning to charger
        setNavigationStatus(NavigationStatus.NAVIGATING);

        // Start going home
        await NativeModules.SlamtecUtils.goHome();
        await LogUtils.writeDebugToFile('Initiating return to charger in error handler');

        // Check if robot is already on dock
        const powerStatus = await NativeModules.SlamtecUtils.getPowerStatus();
        if (powerStatus.dockingStatus === 'on_dock') {
          isReturningToChargerRef.current = false;
          setIsReturningToCharger(false);
          setNavigationStatus(NavigationStatus.IDLE);
          await LogUtils.writeDebugToFile('Robot already on dock, resetting return to charger state');
        }
      }
    }
  };
  
  const renderProductItem = ({ item }: { item: Product }) => {
    // Create the image URL if both id and image are available
    const imageUrl = item.id && item.image ? 
      `https://conference-backend-0.aukiverse.com/api/files/gkzgdbw8bnw0bs7/${item.id}/${item.image}` : null;
    
    return (
      <View style={styles.productItem}>
        <View style={styles.productContent}>
          <View style={styles.productTextContainer}>
            <Text style={styles.productText}>{item.name}</Text>
            <Text style={styles.productDescription}>{item.description || 'No description available'}</Text>
            <TouchableOpacity 
              style={styles.findButton}
              onPress={() => handleProductSelect(item)}
            >
              <Text style={styles.findButtonText}>Find</Text>
              <Text style={{color: '#FFFFFF', fontWeight: 'bold'}}>→</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.productImageContainer}>
            {imageUrl ? (
              <Image 
                source={{ uri: imageUrl }} 
                style={styles.productImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.placeholderImage}>
                <Text style={styles.placeholderText}>{item.name.charAt(0)}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };
  
  // Function for automatic polling of robot call data
  const fetchRobotCallData = async () => {
    try {
      // Only poll when not navigating
      if (navigationStatus !== NavigationStatus.IDLE) {
        return;
      }
      
      await LogUtils.writeDebugToFile('Polling for robot call data...');
      
      const result = await NativeModules.DomainUtils.getRobotCall();
      
      // Skip if no data or null data
      if (!result || !result.data) {
        return;
      }
      
      await LogUtils.writeDebugToFile(`Received robot call data: ${JSON.stringify(result)}`);
      
      // Parse the data (it comes as a string)
      try {
        const parsedData = JSON.parse(result.data);
        
        // Only process if there's valid data and ID
        if (parsedData && parsedData.id) {
          await LogUtils.writeDebugToFile(`Processing robot call with ID: ${parsedData.id}`);
          
          // Look up product with matching ID
          const matchingProduct = products.find(product => product.id === parsedData.id);
          
          if (matchingProduct) {
            // Found a matching product
            await LogUtils.writeDebugToFile(`Found matching product for ID ${parsedData.id}: ${matchingProduct.name}`);
            
            // Set that we've handled a robot call
            setLastRobotCallHandled(true);
            
            // Start navigation immediately without showing any dialog
            await LogUtils.writeDebugToFile(`Automatically navigating to product: ${matchingProduct.name}`);
            
            // Start navigation and clear data
            handleProductSelect(matchingProduct);
            
            // Use the proper write function to clear the robot call data with PUT method
            try {
              // First get the metadata to extract the data_id
              const callData = await NativeModules.DomainUtils.getRobotCall();
              
              if (callData && callData.metadata && callData.metadata.id) {
                // Use the specific data_id from the metadata when clearing
                const dataId = callData.metadata.id;
                await LogUtils.writeDebugToFile(`Clearing robot call with specific data_id: ${dataId}`);
                
                // Write empty ID to clear the data, using the correct data_id
                const clearResult = await NativeModules.DomainUtils.writeRobotCall(JSON.stringify({ id: null }), "PUT", dataId);
                await LogUtils.writeDebugToFile(`Clear result: ${JSON.stringify(clearResult)}`);
                
                // Verify the data was cleared
                const verifyData = await NativeModules.DomainUtils.getRobotCall();
                await LogUtils.writeDebugToFile(`Verification after write: ${JSON.stringify(verifyData)}`);
              } else {
                await LogUtils.writeDebugToFile('Could not get data_id from robot call metadata, using default approach');
                
                // Fallback to original approach
                const clearResult = await NativeModules.DomainUtils.writeRobotCall(JSON.stringify({ id: null }), "PUT", null);
                await LogUtils.writeDebugToFile(`Fallback clear result: ${JSON.stringify(clearResult)}`);
              }
            } catch (clearError: any) {
              await LogUtils.writeDebugToFile(`Failed to clear robot call data: ${clearError.message}`);
            }
          } else {
            // No matching product found
            await LogUtils.writeDebugToFile(`Robot call data ID ${parsedData.id} not found in products list`);
          }
        }
      } catch (parseError: any) {
        await LogUtils.writeDebugToFile(`Error parsing robot call data: ${parseError.message}`);
      }
    } catch (error: any) {
      await LogUtils.writeDebugToFile(`Error fetching robot call data: ${error.message}`);
    }
  };
  
  // Set up polling for robot call data
  useEffect(() => {
    // Clear any previous cooldown timer
    if (robotCallCooldownRef.current) {
      clearTimeout(robotCallCooldownRef.current);
      robotCallCooldownRef.current = null;
    }
    
    // Start polling when component mounts and not navigating
    if (navigationStatus === NavigationStatus.IDLE) {
      // Check if we just finished handling a robot call
      if (lastRobotCallHandled) {
        // Start cooldown timer for 1 minute before restarting robot call polling
        LogUtils.writeDebugToFile('Starting 60-second cooldown before restarting robot call polling');
        
        robotCallCooldownRef.current = setTimeout(() => {
          // After cooldown, start polling and reset the handled flag
          LogUtils.writeDebugToFile('Robot call cooldown completed, resuming polling');
          setLastRobotCallHandled(false);
          
          // Start polling after cooldown
          fetchRobotCallData();
          robotCallPollingRef.current = setInterval(fetchRobotCallData, 5000);
        }, 60000); // 1 minute cooldown
      } else {
        // No cooldown needed, start polling immediately
        // Poll immediately on mount
        fetchRobotCallData();
        
        // Set up polling interval (every 5 seconds)
        robotCallPollingRef.current = setInterval(fetchRobotCallData, 5000);
        
        LogUtils.writeDebugToFile('Started robot call polling');
      }
    } else {
      // Clear polling when navigating
      if (robotCallPollingRef.current) {
        clearInterval(robotCallPollingRef.current);
        robotCallPollingRef.current = null;
        LogUtils.writeDebugToFile('Stopped robot call polling due to navigation');
      }
    }
    
    // Clean up polling on unmount or navigation state changes
    return () => {
      if (robotCallPollingRef.current) {
        clearInterval(robotCallPollingRef.current);
        robotCallPollingRef.current = null;
        LogUtils.writeDebugToFile('Cleaned up robot call polling');
      }
      
      if (robotCallCooldownRef.current) {
        clearTimeout(robotCallCooldownRef.current);
        robotCallCooldownRef.current = null;
        LogUtils.writeDebugToFile('Cleaned up robot call cooldown timer');
      }
    };
  }, [navigationStatus, lastRobotCallHandled]);
  
  // Modify the renderContent function to remove the robot call button
  const renderContent = () => {
    return (
      <>
        <Modal
          visible={isReturningToCharger}
          transparent={true}
          animationType="fade"
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Returning to Charger</Text>
              <Text style={styles.modalText}>The robot is returning to the charging dock.</Text>
            </View>
          </View>
        </Modal>

        {(() => {
          switch (navigationStatus) {
            case NavigationStatus.IDLE:
              return (
                <View style={styles.searchContainer}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search products..."
                    value={searchText}
                    onChangeText={setSearchText}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                  />
                  {filteredProducts.length > 0 ? (
                    <FlatList
                      data={filteredProducts}
                      renderItem={renderProductItem}
                      keyExtractor={(item) => item.eslCode}
                      style={styles.productList}
                    />
                  ) : (
                    <Text style={styles.noProductsText}>No products found</Text>
                  )}
                </View>
              );
              
            case NavigationStatus.PATROL:
              // Full-screen image for patrol mode, no text or banner
              return (
                <TouchableOpacity 
                  style={styles.fullScreenContainer}
                  onPress={handleReturnToList}
                  activeOpacity={1}
                >
                  <Image 
                    source={require('../assets/GotuAdLandscape.png')} 
                    style={styles.fullScreenImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              );
              
            case NavigationStatus.NAVIGATING:
              return (
                <View style={styles.navigationContainer}>
                  <View style={styles.navigationDialog}>
                    <Text style={styles.navigationTitle}>Navigating to:</Text>
                    <Text style={styles.navigationProductName}>
                      {selectedProduct ? selectedProduct.name : "Home"}
                    </Text>
                    <ActivityIndicator size="large" color="#2670F8" style={styles.navigationSpinner} />
                    
                    <TouchableOpacity 
                      style={[styles.navigationButton, styles.cancelButton, { marginTop: 30 }]}
                      onPress={handleReturnToList}
                    >
                      <Text style={styles.navigationButtonText}>Cancel Navigation</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
              
            case NavigationStatus.ARRIVED:
              return (
                <View style={styles.navigationContainer}>
                  <View style={styles.navigationDialog}>
                    <Text style={styles.navigationTitle}>We have arrived!</Text>
                    <Text style={styles.navigationProductName}>{selectedProduct?.name}</Text>
                    
                    <View style={styles.navigationButtonContainer}>
                      <TouchableOpacity 
                        style={styles.navigationButton}
                        onPress={handleReturnToList}
                      >
                        <Text style={styles.navigationButtonText}>Back to List</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
              
            case NavigationStatus.ERROR:
              return (
                <View style={styles.navigationContainer}>
                  <View style={styles.navigationDialog}>
                    <Text style={styles.navigationTitle}>Navigation Error</Text>
                    <Text style={styles.navigationErrorText}>{navigationError}</Text>
                    
                    <TouchableOpacity 
                      style={styles.navigationButton}
                      onPress={handleReturnToList}
                    >
                      <Text style={styles.navigationButtonText}>Back to List</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
          }
        })()}
      </>
    );
  };
  
  // Function to reset the inactivity timer
  const resetInactivityTimer = async () => {
    clearInactivityTimer();
    
    // Log the state of promotion flags
    await LogUtils.writeDebugToFile(`resetInactivityTimer - promotionActive: ${globalAny.promotionActive}, promotionCancelled: ${promotionCancelled}, isPatrolling: ${isPatrollingRef.current}`);
    
    // Only start inactivity timer if promotion is active and not cancelled
    if (globalAny.promotionActive && !promotionCancelled) {
      await LogUtils.writeDebugToFile('Starting inactivity timer - promotion is active and not cancelled');
      startInactivityTimer();
    } else {
      await LogUtils.writeDebugToFile('Not starting inactivity timer - promotion is inactive or cancelled');
    }
  };

  // Add a counter and flag for pose polling debug
  let posePollingActiveCount = 0;
  let posePollingInProgress = false;

  // Refactor pose polling to use a wait-for-completion loop
  let posePollingShouldRun = false;

  const startPosePolling = async () => {
    await stopPosePolling();
    posePollingShouldRun = true;
    await LogUtils.writeDebugToFile('[POSE POLLING] Wait-for-completion polling started');
    pollPoseLoop();
  };

  const stopPosePolling = async () => {
    posePollingShouldRun = false;
    await LogUtils.writeDebugToFile('[POSE POLLING] Wait-for-completion polling stopped');
    return true;
  };

  const pollPoseLoop = async () => {
    while (posePollingShouldRun) {
      await readRobotPose();
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1s between polls
    }
    await LogUtils.writeDebugToFile('[POSE POLLING] Polling loop exited');
  };

  const readRobotPose = async () => {
    if (posePollingInProgress) {
      await LogUtils.writeDebugToFile('[POSE POLLING] Overlapping readRobotPose call detected!');
    }
    posePollingInProgress = true;
    // await LogUtils.writeDebugToFile('[POSE POLLING] readRobotPose started');
    try {
      if (currentNavigationStatusRef.current !== NavigationStatus.NAVIGATING && 
          currentNavigationStatusRef.current !== NavigationStatus.PATROL) {
        await stopPosePolling();
        await LogUtils.writeDebugToFile(`[POSE POLLING] Auto-stopped polling - not in NAVIGATING/PATROL state`);
        posePollingInProgress = false;
        return;
      }

      // Check if robot is on dock while returning to charger
      if (isReturningToCharger) {
        const powerStatus = await NativeModules.SlamtecUtils.getPowerStatus();
        if (powerStatus.dockingStatus === 'on_dock') {
          setIsReturningToCharger(false);
          setNavigationStatus(NavigationStatus.IDLE);
          await LogUtils.writeDebugToFile('Robot docked successfully, resetting return to charger state');
          await stopPosePolling();
          posePollingInProgress = false;
          return;
        }
      }

      if (poseReportingCooldownRef.current) {
        posePollingInProgress = false;
        return;
      }
      if (poseUploadInProgress) {
        await LogUtils.writeDebugToFile('[POSE POLLING] Skipping pose upload: previous upload still in progress');
        posePollingInProgress = false;
        return;
      }
      poseUploadInProgress = true;
      const pose = await NativeModules.SlamtecUtils.getCurrentPose();
      if (pose) {
        const timestamp = Date.now();
        const transformedPose = transformCoordinates(pose.x, pose.y, pose.yaw);
        
        // Create JSON payload
        const timestampNano = BigInt(timestamp) * BigInt(1000000);
        const identifiers = DeviceStorage.getIdentifiers();
        
        // If identifiers are not in global storage, log an error
        if (!DeviceStorage.hasIdentifiers()) {
          await LogUtils.writeDebugToFile("[POSE] Error: Device identifiers not found in global storage!");
        }
        
        const poseData = {
          name: "PadBot",
          device_id: identifiers.deviceId || "unknown_device_id",
          device_type: "padbot-robot-w3",
          timestamp: timestampNano.toString(),
          pose: {
            px: transformedPose.x,
            py: transformedPose.y,
            pz: transformedPose.z,
            rx: transformedPose.quaternion.x,
            ry: transformedPose.quaternion.z,
            rz: transformedPose.quaternion.y,
            rw: transformedPose.quaternion.w
          },
          mac_address: identifiers.macAddress || "unknown_mac_address"
        };

        // Send the pose data to the domain without logging
        try {
          const robotPoseDataId = DeviceStorage.getIdentifiers().robotPoseDataId;
          if (robotPoseDataId) {
            await NativeModules.DomainUtils.writeRobotPose(JSON.stringify(poseData), "PUT", robotPoseDataId);
          } else {
            const result = await NativeModules.DomainUtils.writeRobotPose(JSON.stringify(poseData), "POST", null);
            if (result.dataId) {
              DeviceStorage.setRobotPoseDataId(result.dataId);
            }
          }
        } catch (error: any) {
          if (!poseReportingCooldownRef.current) {
            poseReportingCooldownRef.current = true;
            setTimeout(() => {
              poseReportingCooldownRef.current = false;
            }, 10000); // Back to 10 seconds
            await LogUtils.writeDebugToFile(`[POSE POLLING] Error sending pose data: ${error.message}`);
          }
        }
      }
      poseUploadInProgress = false;
    } catch (error: any) {
      await LogUtils.writeDebugToFile(`[POSE POLLING] Error in readRobotPose: ${error.message}`);
      poseUploadInProgress = false;
    }
    // await LogUtils.writeDebugToFile('[POSE POLLING] readRobotPose finished');
    posePollingInProgress = false;
  };

  // Watch for navigation status changes and manage polling based on NavigationStatus
  useEffect(() => {
    const handleNavigationStateChange = async () => {
      // Log the state change
      await LogUtils.writeDebugToFile(`Navigation state changed to: ${NavigationStatus[navigationStatus]}`);
      
      // Only poll in NAVIGATING or PATROL states
      if (navigationStatus === NavigationStatus.NAVIGATING || 
          navigationStatus === NavigationStatus.PATROL) {
        // Start polling if not already polling
        if (!posePollingRef.current) {
          await LogUtils.writeDebugToFile(`Starting polling in ${NavigationStatus[navigationStatus]} state`);
          await startPosePolling();
        }
      } else {
        // Stop polling in all other states
        await stopPosePolling();
        await LogUtils.writeDebugToFile(`Polling stopped in ${NavigationStatus[navigationStatus]} state`);
      }
    };
    
    // Call the handler immediately when navigation status changes
    handleNavigationStateChange();
    
    // Clean up when component unmounts or navigation state changes
    return () => {
      if (posePollingRef.current) {
        clearInterval(posePollingRef.current);
        posePollingRef.current = null;
        LogUtils.writeDebugToFile('Robot pose polling stopped on cleanup');
      }
    };
  }, [navigationStatus]);

  // Update ref when navigation status changes
  useEffect(() => {
    currentNavigationStatusRef.current = navigationStatus;
    LogUtils.writeDebugToFile(`Navigation status updated to: ${NavigationStatus[navigationStatus]}`);
  }, [navigationStatus]);

  // Function to classify error types based on error message
  const classifyErrorType = (errorMessage: string): string => {
    const lowerCaseError = errorMessage.toLowerCase();
    
    if (lowerCaseError.includes('timeout') || lowerCaseError.includes('timed out')) {
      return RobotBaseErrorTypes.NAVIGATION_TIMEOUT;
    } else if (lowerCaseError.includes('obstacle') || lowerCaseError.includes('blocked') || 
               lowerCaseError.includes('path') || lowerCaseError.includes('cannot find path')) {
      return RobotBaseErrorTypes.PATH_BLOCKED;
    } else if (lowerCaseError.includes('hardware') || lowerCaseError.includes('motor') || 
               lowerCaseError.includes('wheel') || lowerCaseError.includes('lidar')) {
      return RobotBaseErrorTypes.HARDWARE_FAILURE;
    } else if (lowerCaseError.includes('localization') || lowerCaseError.includes('lost') || 
               lowerCaseError.includes('position')) {
      return RobotBaseErrorTypes.LOCALIZATION_LOST;
    } else if (lowerCaseError.includes('communication') || lowerCaseError.includes('connection') || 
               lowerCaseError.includes('disconnected')) {
      return RobotBaseErrorTypes.COMMUNICATION_ERROR;
    } else {
      return RobotBaseErrorTypes.UNKNOWN_ERROR;
    }
  };
  
  // Function to check robot base health
  const checkRobotBaseHealth = async (): Promise<boolean> => {
    try {
      if (NativeModules.SlamtecUtils && typeof NativeModules.SlamtecUtils.checkConnection === 'function') {
        const details = await NativeModules.SlamtecUtils.checkConnection();
        await LogUtils.writeDebugToFile(`Health check - Robot status: ${JSON.stringify(details)}`);
        
        setRobotBaseStatus(details.status || 'unknown');
        return details.slamApiAvailable === true;
      } else {
        await LogUtils.writeDebugToFile(`Health check skipped - checkConnection method not available`);
        setRobotBaseStatus('unknown');
        return true;
      }
    } catch (error: any) {
      await LogUtils.writeDebugToFile(`Health check failed: ${error.message}`);
      setRobotBaseStatus('error');
      return false;
    }
  };
  
  // Function to handle robot base errors with automatic recovery
  const handleRobotBaseError = async (errorMessage: string, errorType: string = RobotBaseErrorTypes.UNKNOWN_ERROR) => {
    // Log detailed information about the error state
    await LogUtils.writeDebugToFile(`Robot base error: ${errorMessage} (Type: ${errorType})`);
    await LogUtils.writeDebugToFile(`Current navigation status: ${NavigationStatus[currentNavigationStatusRef.current]}`);
    await LogUtils.writeDebugToFile(`Recovery attempts: ${recoveryAttempts}`);
    
    // Collect additional diagnostic information
    try {
      const pose = await NativeModules.SlamtecUtils.getCurrentPose();
      await LogUtils.writeDebugToFile(`Robot pose at error: ${JSON.stringify(pose)}`);
      
      // Use checkConnection instead of getRobotStatus
      const details = await NativeModules.SlamtecUtils.checkConnection();
      await LogUtils.writeDebugToFile(`Robot status at error: ${JSON.stringify(details)}`);
      
      // Get battery status if available
      if (NativeModules.SlamtecUtils.getBatteryInfo) {
        const battery = await NativeModules.SlamtecUtils.getBatteryInfo();
        await LogUtils.writeDebugToFile(`Battery info at error: ${JSON.stringify(battery)}`);
      }
    } catch (diagError: any) {
      await LogUtils.writeDebugToFile(`Error collecting diagnostic info: ${diagError.message}`);
    }
    
    // Decide whether to attempt recovery based on error type and previous attempts
    if (recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
      // Attempt recovery based on error type
      await LogUtils.writeDebugToFile(`Attempting recovery (attempt ${recoveryAttempts + 1}/${MAX_RECOVERY_ATTEMPTS})`);
      
      // Increment recovery attempts
      setRecoveryAttempts(prev => prev + 1);
      
      try {
        // First stop the current navigation
        await NativeModules.SlamtecUtils.stopNavigation();
        await LogUtils.writeDebugToFile('Stopped current navigation for recovery');
        
        let recoveryStrategy = '';
        
        switch (errorType) {
          case RobotBaseErrorTypes.PATH_BLOCKED:
            // For blocked paths, wait a moment then try again
            recoveryStrategy = 'Wait and retry navigation';
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // If we have a selected product, retry navigation
            if (selectedProduct) {
              await LogUtils.writeDebugToFile('Retrying navigation after path blocked');
              handleProductSelect(selectedProduct);
            } else {
              handleReturnToList();
            }
            break;
            
          case RobotBaseErrorTypes.LOCALIZATION_LOST:
            // For localization issues, try to relocalize
            recoveryStrategy = 'Attempt relocalization';
            if (NativeModules.SlamtecUtils.relocalize) {
              await LogUtils.writeDebugToFile('Attempting relocalization');
              await NativeModules.SlamtecUtils.relocalize();
              
              // Wait for relocalization to complete
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              // If we have a selected product, retry navigation
              if (selectedProduct) {
                await LogUtils.writeDebugToFile('Retrying navigation after relocalization');
                handleProductSelect(selectedProduct);
              } else {
                handleReturnToList();
              }
            } else {
              // If relocalization not available, return to list
              handleReturnToList();
            }
            break;
            
          case RobotBaseErrorTypes.NAVIGATION_TIMEOUT:
          case RobotBaseErrorTypes.COMMUNICATION_ERROR:
            // For timeouts and communication errors, try resetting the robot connection
            recoveryStrategy = 'Reset robot connection';
            if (NativeModules.SlamtecUtils.resetConnection) {
              await LogUtils.writeDebugToFile('Resetting robot connection');
              await NativeModules.SlamtecUtils.resetConnection();
              
              // Wait for connection reset to complete
              await new Promise(resolve => setTimeout(resolve, 5000));
              
              // If we have a selected product, retry navigation
              if (selectedProduct) {
                await LogUtils.writeDebugToFile('Retrying navigation after connection reset');
                handleProductSelect(selectedProduct);
              } else {
                handleReturnToList();
              }
            } else {
              // If reset not available, return to list
              handleReturnToList();
            }
            break;
            
          default:
            // For unknown errors, just return to list
            recoveryStrategy = 'Return to list';
            handleReturnToList();
            break;
        }
        
        await LogUtils.writeDebugToFile(`Applied recovery strategy: ${recoveryStrategy}`);
      } catch (recoveryError: any) {
        await LogUtils.writeDebugToFile(`Recovery attempt failed: ${recoveryError.message}`);
        
        // If recovery fails, update UI to show error
        setNavigationStatus(NavigationStatus.ERROR);
        setNavigationError(`Navigation failed: ${errorMessage}. Recovery failed.`);
      }
    } else {
      // Max recovery attempts reached, update UI to show error
      await LogUtils.writeDebugToFile('Maximum recovery attempts reached, showing error to user');
      setNavigationStatus(NavigationStatus.ERROR);
      setNavigationError(`Navigation failed: ${errorMessage}. Please try again.`);
      
      // Reset recovery attempts counter when showing error to user
      setRecoveryAttempts(0);
    }
  };

  // Effect to clean up resources when component unmounts
  useEffect(() => {
    return () => {
      // Clear heartbeat check
      // stopHeartbeatCheck();
      
      // ... existing cleanup code ...
    };
  }, []);

  const navigateToProduct = async (product: Product) => {
    try {
      await LogUtils.writeDebugToFile(`Navigating to product: ${product.name}`);

      // Reset for new navigation
      setNavigationStatus(NavigationStatus.NAVIGATING);
      setRecoveryAttempts(0);
      navigationCancelledRef.current = false;
      await LogUtils.writeDebugToFile(`Navigation status set to NAVIGATING`);
      
      // Start heartbeat monitoring
      // startHeartbeatCheck();
      
      // Start pose polling for this navigation
      await startPosePolling();

      const productHasYaw = product.pose.yaw !== undefined;
      const yaw = productHasYaw ? product.pose.yaw : 0;
      
      await LogUtils.writeDebugToFile(`Using product coordinates - X: ${product.pose.x}, Y: ${product.pose.y}, Yaw: ${yaw}`);
      
      // Call the native module to navigate
      await NativeModules.SlamtecUtils.navigateProduct(
        product.pose.x,
        product.pose.y,
        yaw,
      );
    } catch (error: any) {
      // Handle any errors that occur during navigation
      await LogUtils.writeDebugToFile(`Navigation error: ${error.message}`);
      setNavigationStatus(NavigationStatus.ERROR);
      setNavigationError(`Failed to navigate to ${product.name}`);
      
      // Stop heartbeat monitoring on error
      // stopHeartbeatCheck();
    }
  };

  // Effect to start heartbeat check when component mounts
  useEffect(() => {
    // Start heartbeat check immediately
    // startHeartbeatCheck();
    
    return () => {
      // Clear heartbeat check on unmount
      // stopHeartbeatCheck();
    };
  }, []);

  // Initial health check
  useEffect(() => {
    const performInitialHealthCheck = async () => {
      try {
        LogUtils.writeDebugToFile('Performing initial health check in MainScreen...');
        const response = await NativeModules.SlamtecUtils.checkConnection();
        LogUtils.writeDebugToFile('Initial health check response: ' + JSON.stringify(response, null, 2));

        // Parse the response string if it exists
        let parsedResponse;
        if (response.response) {
          try {
            parsedResponse = JSON.parse(response.response);
            LogUtils.writeDebugToFile('Parsed health check response: ' + JSON.stringify(parsedResponse, null, 2));
          } catch (parseError: any) {
            LogUtils.writeDebugToFile('Failed to parse health check response: ' + parseError.message);
            throw new Error('Invalid health check response format');
          }
        }

        // Check for health check failures
        if (response.hasError || response.hasFatal || response.hasSystemEmergencyStop || 
            response.hasLidarDisconnected || response.hasDepthCameraDisconnected || response.hasSdpDisconnected ||
            (parsedResponse && (parsedResponse.hasFatal || parsedResponse.hasError || 
             (parsedResponse.baseError && parsedResponse.baseError.length > 0)))) {
          throw new Error('Health check failed: ' + JSON.stringify(response));
        }

        LogUtils.writeDebugToFile('Initial health check successful');
      } catch (error) {
        LogUtils.writeDebugToFile('Initial health check failed: ' + (error instanceof Error ? error.message : String(error)));
        
        // Show error dialog with more detailed information
        Alert.alert(
          'Connection Error',
          'There was an issue detected, please restart the app. If the error persists please reboot the robot.',
          [
            {
              text: 'OK',
              onPress: () => {
                LogUtils.writeDebugToFile('User dismissed base error alert');
              },
            },
          ],
          { 
            cancelable: true,
            onDismiss: () => {
              LogUtils.writeDebugToFile('User dismissed base error alert by tapping outside');
            }
          }
        );
      }
    };

    // Perform the initial health check
    performInitialHealthCheck();
  }, []);

  useEffect(() => {
    // Set up app state change listener
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Start pose polling
    startPosePolling();

    // Set up token refresh interval
    const tokenRefreshInterval = setInterval(refreshToken, TOKEN_REFRESH_INTERVAL);

    // Set up token validation interval
    const tokenValidationInterval = setInterval(() => validateToken(false), TOKEN_VALIDATION_INTERVAL);

    // Clean up function
    return () => {
      subscription.remove();
      stopPosePolling();
      clearInterval(tokenRefreshInterval);
      clearInterval(tokenValidationInterval);
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, []);

  // Add new ref for cancellation state
  const isCancellingRef = useRef(false);

  // Update initialization effect
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Perform health check first
        LogUtils.writeDebugToFile('Performing initial health check in MainScreen...');
        const healthCheck = await NativeModules.SlamtecUtils.checkConnection();
        LogUtils.writeDebugToFile('Initial health check response: ' + JSON.stringify(healthCheck, null, 2));

        if (!healthCheck.slamApiAvailable) {
          throw new Error('Robot not ready');
        }

        // Only proceed with token validation if health check passes
        await validateToken();

        // Then proceed with map operations
        LogUtils.writeDebugToFile('Initial health check successful');
      } catch (error) {
        LogUtils.writeDebugToFile('Initial health check failed: ' + (error instanceof Error ? error.message : String(error)));
        
        Alert.alert(
          'Connection Error',
          'Please wait for the robot to be ready before proceeding.',
          [{ text: 'OK' }]
        );
      }
    };

    initializeApp();
  }, []);

  const [isInputFocused, setIsInputFocused] = useState(false);

  // Add this function before handleGoHome
  const cancelPatrol = async (reason = 'unknown') => {
    LogUtils.writeDebugToFile(`Cancelling patrol - Reason: ${reason}`);
    LogUtils.writeDebugToFile(`Current navigation status: ${navigationStatus}`);
    LogUtils.writeDebugToFile(`Is patrolling: ${isPatrolling}`);
    LogUtils.writeDebugToFile(`Is returning to charger: ${isReturningToCharger}`);
    LogUtils.writeDebugToFile(`Current promotion state - Active: ${globalAny.promotionActive}, Cancelled: ${promotionCancelled}`);
    
    setIsPatrolling(false);
    promotionCancelled = true;
    globalAny.promotionActive = false;
    await LogUtils.writeDebugToFile(`Waypoint sequence cancelled (reason: ${reason})`);
    
    LogUtils.writeDebugToFile('Patrol cancelled - Flags updated');
    LogUtils.writeDebugToFile(`New promotion state - Active: ${globalAny.promotionActive}, Cancelled: ${promotionCancelled}`);
  };

  // Add a ref to track pose reporting cooldown
  const poseReportingCooldownRef = useRef(false);

  // Helper function to convert from yaw to quaternion (assuming pitch and roll are 0)
  const yawToQuaternion = (yaw: number) => {
    const halfYaw = yaw / 2;
    return {
      w: Math.cos(halfYaw),
      x: 0,
      y: 0,
      z: Math.sin(halfYaw)
    };
  };

  // Helper function to transform coordinates from robot system to our coordinate system
  const transformCoordinates = (x: number, y: number, yaw: number) => {
    // In the new system:
    // x remains the same
    // y becomes 0 (ground plane)
    // z becomes the old y, but inverted
    const z = -y; // Invert y to get z
    // Convert yaw to quaternion
    const quaternion = yawToQuaternion(yaw);
    return {
      x,
      y: 0,
      z,
      quaternion,
      // Keep the original values for reference
      originalX: x,
      originalY: y,
      originalYaw: yaw
    };
  };

  // Add effect to load patrol points on mount
  useEffect(() => {
    const loadPatrolPoints = async () => {
      try {
        const patrolPointsContent = await NativeModules.FileUtils.readFile('patrol_points.json');
        if (patrolPointsContent) {
          const parsedPoints = JSON.parse(patrolPointsContent);
          patrolPoints = parsedPoints.patrol_points.map((point: any) => ({
            yaw: point.yaw,
            y: point.y,
            x: point.x,
            name: point.name
          }));
          await LogUtils.writeDebugToFile(`Loaded patrol points: ${JSON.stringify(patrolPoints)}`);

          // Validate against POIs
          let pois = await NativeModules.SlamtecUtils.getPOIs();
          await LogUtils.writeDebugToFile(`Initial POIs fetch: ${JSON.stringify(pois)}`);
          
          // If POIs is empty, wait a moment and try again as they might be initializing
          if (Array.isArray(pois) && pois.length === 0) {
            await LogUtils.writeDebugToFile('No POIs found, waiting for initialization...');
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for POIs to initialize
            pois = await NativeModules.SlamtecUtils.getPOIs();
            await LogUtils.writeDebugToFile(`POIs after initialization: ${JSON.stringify(pois)}`);
          }
          
          // POIs response is an array of POI objects with metadata.display_name
          const poiNames = Array.isArray(pois) ? pois.map((poi: any) => poi.metadata?.display_name?.trim()) : [];
          await LogUtils.writeDebugToFile(`Found POI names: ${JSON.stringify(poiNames)}`);
          
          // Filter out any undefined or empty names
          const validPoiNames = poiNames.filter((name): name is string => 
            typeof name === 'string' && name.length > 0
          );
          await LogUtils.writeDebugToFile(`Valid POI names: ${JSON.stringify(validPoiNames)}`);
          
          // Check for mismatches
          const extraPOIs = validPoiNames.filter((name: string) => 
            !patrolPoints.find((cp: { name: string }) => cp.name === name)
          );
          const missingPoints = patrolPoints.filter((cp: { name: string }) => 
            !validPoiNames.includes(cp.name)
          );
          
          if (extraPOIs.length > 0 || missingPoints.length > 0) {
            let errorMsg = '';
            if (extraPOIs.length > 0) {
              errorMsg += `Unexpected POIs found: ${extraPOIs.join(', ')}\n`;
            }
            if (missingPoints.length > 0) {
              errorMsg += `Missing waypoints: ${missingPoints.map((p: { name: string }) => p.name).join(', ')}`;
            }
            await LogUtils.writeDebugToFile(`POI validation error: ${errorMsg}`);
            
            // Clear and reinitialize POIs
            await LogUtils.writeDebugToFile('Clearing and reinitializing POIs...');
            await NativeModules.SlamtecUtils.clearAndInitializePOIs();
            await LogUtils.writeDebugToFile('POIs have been reset and reinitialized');
            
            // Verify the POIs again
            pois = await NativeModules.SlamtecUtils.getPOIs();
            await LogUtils.writeDebugToFile(`POIs after reset: ${JSON.stringify(pois)}`);
          } else {
            await LogUtils.writeDebugToFile('POI validation successful - all points match config');
          }
        } else {
          await LogUtils.writeDebugToFile('No patrol points configuration found');
        }
      } catch (error: any) {
        await LogUtils.writeDebugToFile(`Error loading patrol points: ${error.message}`);
      }
    };

    loadPatrolPoints();
  }, []);

  // Add with other refs at the top of the component:
  const isTouchDebouncedRef = useRef(false);

  // Add a flag to prevent overlapping pose uploads
  let poseUploadInProgress = false;

  const BatteryIndicator = () => {
    const [powerStatus, setPowerStatus] = useState<any>(null);

    useEffect(() => {
      const updatePowerStatus = async () => {
        try {
          const status = await NativeModules.SlamtecUtils.getPowerStatus();
          setPowerStatus(status);
        } catch (error) {
          console.error('Error getting power status:', error);
        }
      };

      // Update immediately
      updatePowerStatus();

      // Set up interval to update every 30 seconds
      const interval = setInterval(updatePowerStatus, 30000);

      return () => clearInterval(interval);
    }, []);

    if (!powerStatus) return null;

    return (
      <View style={styles.batteryContainer}>
        <View style={[
          styles.batteryIndicator,
          powerStatus.batteryPercentage <= 20 ? styles.batteryLow :
          powerStatus.batteryPercentage <= 50 ? styles.batteryMedium :
          styles.batteryHigh
        ]}>
          <Text style={styles.batteryText}>{Math.round(powerStatus.batteryPercentage)}%</Text>
        </View>
      </View>
    );
  };

  // Add loading state
  const [isContentReady, setIsContentReady] = useState(false);
  const [isHeaderReady, setIsHeaderReady] = useState(false);
  
  // Add effect to handle initial loading
  useEffect(() => {
    const initializeContent = async () => {
      try {
        // Wait for initial battery status
        const powerStatus = await NativeModules.SlamtecUtils.getPowerStatus();
        if (powerStatus) {
          // Add delay before setting header ready
          setTimeout(() => {
            setIsHeaderReady(true);
            // Add a small delay to ensure header is rendered
            setTimeout(() => {
              setIsContentReady(true);
            }, 100);
          }, 250);
        }
      } catch (error) {
        // If we can't get battery status, still show content after a short delay
        setTimeout(() => {
          setIsHeaderReady(true);
          setTimeout(() => {
            setIsContentReady(true);
          }, 500);
        }, 250);
      }
    };

    initializeContent();
  }, []);

  return (
    <SafeAreaView 
      style={styles.container}
      /*onTouchStart={async () => {
        // Debounce touch events to prevent rapid firing
        if (isTouchDebouncedRef.current) return;
        isTouchDebouncedRef.current = true;
        setTimeout(() => { isTouchDebouncedRef.current = false; }, 1000);

        // Only log essential information
        if (!isPatrollingRef.current && navigationStatus !== NavigationStatus.PATROL) {
          resetInactivityTimer()
            .catch(err => console.error('Error resetting inactivity timer:', err));
        } else if (isPatrollingRef.current && navigationStatus === NavigationStatus.PATROL) {
          startInactivityTimer();
        }
      }}*/
      onTouchStart={() => {
        // Only start timer if we're in promotion mode (PATROL), no product selected, and promotion is active
        if (navigationStatus === NavigationStatus.PATROL && !selectedProduct && globalAny.promotionActive) {
          // We can't use await in the onTouchStart handler, so we handle it with a promise
          resetInactivityTimer()
            .then(() => LogUtils.writeDebugToFile('Touch detected in active promotion mode, reset inactivity timer processed'))
            .catch(err => LogUtils.writeDebugToFile(`Error resetting inactivity timer: ${err.message || err}`));
        }
      }}
    >
      <View style={[
        styles.contentContainer,
        { opacity: isContentReady ? 1 : 0 }
      ]}>
        <View style={[
          styles.header,
          { opacity: isHeaderReady ? 1 : 0 }
        ]}>
          <TouchableOpacity 
            style={styles.closeButton} 
            onPress={undefined}
            onLongPress={handleClose}
            delayLongPress={3000}
          >
            {/* Close button is now invisible but still functional with long press */}
          </TouchableOpacity>
          
          <Image 
            source={require('../assets/AppIcon_Gotu.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
          
          <View style={styles.headerRight}>
            <BatteryIndicator />
            <TouchableOpacity 
              style={styles.configButton}
              onPress={undefined}
              onLongPress={() => {
                clearInactivityTimer();
                LogUtils.writeDebugToFile('Config screen opened, cleared inactivity timer');
                navigatingToConfig = true;
                onConfigPress();
              }}
              delayLongPress={3000}
            >
              {/* Config button is now invisible but still functional with long press */}
            </TouchableOpacity>
          </View>
        </View>
        
        {renderContent()}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6F6',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#FFFFFF',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  headerLogo: {
    width: 200,
    height: 80,
    flex: 1,
    alignSelf: 'center',
  },
  closeButton: {
    padding: 5,
    width: 40,
    height: 40,
  },
  configButton: {
    padding: 5,
    width: 40,
    height: 40,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchContainer: {
    flex: 1,
    padding: 16,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    color: '#101010',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    fontSize: 20,
    marginBottom: 16,
    fontFamily: 'DM Sans',
  },
  productList: {
    flex: 1,
  },
  productListContent: {
    paddingVertical: 8,
    paddingBottom: 100,
  },
  productItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    marginBottom: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  productContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  productTextContainer: {
    flex: 3,
    paddingRight: 16,
  },
  productText: {
    color: '#101010',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
    fontFamily: 'DM Sans',
  },
  productDescription: {
    color: '#596168',
    fontSize: 15,
    marginBottom: 12,
    fontFamily: 'DM Sans',
  },
  findButton: {
    backgroundColor: '#2670F8',
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  findButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
    marginRight: 4,
    fontFamily: 'DM Sans',
  },
  navigationContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  navigationDialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    width: '80%',
    maxWidth: 500,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  navigationTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#101010',
    marginBottom: 16,
    textAlign: 'center',
    fontFamily: 'DM Sans',
  },
  navigationProductName: {
    fontSize: 25,
    color: '#101010',
    textAlign: 'center',
    marginBottom: 24,
    fontFamily: 'DM Sans',
  },
  navigationSpinner: {
    marginTop: 16,
  },
  navigationErrorText: {
    fontSize: 20,
    color: '#E74C3C',
    textAlign: 'center',
    marginVertical: 16,
    fontFamily: 'DM Sans',
  },
  navigationButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 16,
  },
  navigationButton: {
    backgroundColor: '#2670F8',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 120,
    marginHorizontal: 8,
  },
  navigationButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '500',
    textAlign: 'center',
    fontFamily: 'DM Sans',
  },
  cancelButton: {
    backgroundColor: '#E74C3C',
  },
  fullScreenContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  fullScreenImage: {
    width: '100%',
    height: '100%',
  },
  tapInstructionContainer: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingVertical: 16,
  },
  tapInstructionText: {
    fontSize: 25,
    fontWeight: 'bold',
    color: '#FFFFFF',
    fontFamily: 'DM Sans',
  },
  productImageContainer: {
    width: 100,
    height: 100,
    borderRadius: 8,
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  placeholderImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  placeholderText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  actionButtonContainer: {
    marginBottom: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  modalText: {
    fontSize: 16,
    textAlign: 'center',
  },
  noProductsText: {
    fontSize: 20,
    color: '#555',
    textAlign: 'center',
    marginVertical: 16,
    fontFamily: 'DM Sans',
  },
  batteryContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 8,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  batteryIndicator: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  batteryHigh: {
    backgroundColor: '#4CAF50',
  },
  batteryMedium: {
    backgroundColor: '#FFC107',
  },
  batteryLow: {
    backgroundColor: '#F44336',
  },
  batteryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'DM Sans',
  },
  contentContainer: {
    flex: 1,
    opacity: 0, // Start invisible
  },
});

export default MainScreen; 