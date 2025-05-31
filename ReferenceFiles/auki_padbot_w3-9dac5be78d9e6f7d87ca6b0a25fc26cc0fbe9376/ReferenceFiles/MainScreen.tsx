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
} from 'react-native';
import { LogUtils } from '../utils/logging';
import { 
  clearInactivityTimer, 
  startInactivityTimer, 
  resetInactivityTimer 
} from '../utils/inactivityTimer';
import DeviceStorage from '../utils/deviceStorage';

// Access the global object in a way that works in React Native
const globalAny: any = global;

// Speed settings from config
const SPEEDS = {
  patrol: 0.3,      // Default patrol speed if config not available
  productSearch: 0.7, // Default product search speed if config not available
  default: 0.5      // Default speed for other operations
};

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
let promotionActive = false;
let promotionMounted = false;
let promotionCancelled = false;
let currentPointIndex = 0;
let remountFromConfig = false;  // Add flag to track if we're remounting after config
let navigatingToConfig = false; // Add flag to track if we're navigating to config

// Global references for functions
globalAny.clearInactivityTimer = null;
globalAny.restartPromotion = null;

// Define patrol points globally
const patrolPoints = [
  { name: "Patrol Point 1", x: -1.14, y: 2.21, yaw: 3.14 },
  { name: "Patrol Point 2", x: -6.11, y: 2.35, yaw: -1.57 },
  { name: "Patrol Point 3", x: -6.08, y: 0.05, yaw: 0 },
  { name: "Patrol Point 4", x: -1.03, y: 0.01, yaw: 1.57 }
];

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
  promotionActive = true;
  
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
  
  // Function to clear the inactivity timer
  const clearInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
      LogUtils.writeDebugToFile('Inactivity timer cleared');
    }
  };
  
  // Store the clearInactivityTimer function in the global scope
  globalAny.clearInactivityTimer = clearInactivityTimer;
  
  // Function to start the inactivity timer
  const startInactivityTimer = () => {
    // Clear any existing timer first
    clearInactivityTimer();
    
    // Log that we're starting the timer
    LogUtils.writeDebugToFile(`Starting inactivity timer (${INACTIVITY_TIMEOUT/1000} seconds)`);
    
    // Set a new timer
    inactivityTimerRef.current = setTimeout(() => {
      // Only restart promotion if we're not in config screen and not already in promotion
      if (!isPatrollingRef.current && isMountedRef.current) {
        LogUtils.writeDebugToFile('Inactivity timer expired, restarting promotion');
        restartPromotion();
      }
    }, INACTIVITY_TIMEOUT);
  };
  
  // Function to restart the promotion
  const restartPromotion = async () => {
    try {
      // Only restart if we're not already in promotion mode
      if (!isPatrollingRef.current && isMountedRef.current) {
        await LogUtils.writeDebugToFile('Auto-restarting promotion after inactivity');
        
        // Use the same logic as the global startPromotion function
        promotionCancelled = false;
        currentPointIndex = 0;
        promotionActive = true;
        
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
            LogUtils.writeDebugToFile('Starting navigation to first waypoint after auto-restart');
            // Ensure patrol state is still active
            isPatrollingRef.current = true;
            navigateToNextPoint();
          } else {
            LogUtils.writeDebugToFile(`Navigation not starting after auto-restart: isMounted=${isMountedRef.current}, navigationCancelled=${navigationCancelledRef.current}`);
          }
        }, 1000); // Increased delay to 1 second for more reliable startup
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
    promotionMounted = true;
    
    // Log the current promotion state
    LogUtils.writeDebugToFile(`MainScreen mounted. Promotion state: active=${promotionActive}, cancelled=${promotionCancelled}, currentPointIndex=${currentPointIndex}, remountFromConfig=${remountFromConfig}`);
    
    // Only start promotion if it was explicitly activated via the global startPromotion function
    // and not cancelled, and we're not remounting after config screen
    if (promotionActive && !promotionCancelled) {
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
    } else {
      if (remountFromConfig) {
        LogUtils.writeDebugToFile('Remounting after config screen, not starting promotion automatically');
        // Reset the flag after we've checked it
        remountFromConfig = false;
      } else {
        LogUtils.writeDebugToFile('No active promotion detected on mount');
      }
    }
    
    // Clean up on unmount
    return () => {
      promotionMounted = false;
      isMountedRef.current = false;
      
      // Set a flag to indicate we're coming from config screen if that's where we're going
      if (navigatingToConfig) {
        remountFromConfig = true;
        navigatingToConfig = false;
        LogUtils.writeDebugToFile('Setting remountFromConfig flag to true');
      }
      
      LogUtils.writeDebugToFile('Component unmounted, waypoint sequence cancelled');
      
      // Clear inactivity timer on unmount
      clearInactivityTimer();
      
      // Also clear pose polling interval
      if (posePollingRef.current) {
        clearInterval(posePollingRef.current);
        posePollingRef.current = null;
        LogUtils.writeDebugToFile('Robot pose polling stopped on component unmount');
      }
    };
  }, []);
  
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
    
    // Clear the search text immediately when a product is selected
    setSearchText('');
    
    // Cancel any ongoing patrol
    setIsPatrolling(false);
    promotionActive = false;
    promotionCancelled = true;
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
          setNavigationStatus(NavigationStatus.ARRIVED);
          
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
        } catch (error: any) {
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
          
          // Handle other errors as before
          if (!navigationCancelledRef.current) {
            const errorMsg = error.message || 'Navigation failed. Please try again.';
            await LogUtils.writeDebugToFile(`Error: ${errorMsg}`);
            setNavigationStatus(NavigationStatus.ERROR);
            setNavigationError(errorMsg);
          }
        }
      } catch (error: any) {
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
        
        // Handle other errors as before
        if (!navigationCancelledRef.current) {
          const errorMsg = error.message || 'Navigation failed. Please try again.';
          await LogUtils.writeDebugToFile(`Error: ${errorMsg}`);
          setNavigationStatus(NavigationStatus.ERROR);
          setNavigationError(errorMsg);
        }
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
      promotionCancelled = true;
      promotionActive = false;
      
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
      
      // If we just handled a robot call, implement cooldown period before restarting polling
      if (lastRobotCallHandled) {
        await LogUtils.writeDebugToFile('Robot call cooldown period starting (60 seconds)');
        // Will be reset in the useEffect
      }
      
      // Only start inactivity timer if auto-promotion is enabled
      try {
        const autoPromotionEnabled = await NativeModules.ConfigManagerModule.getAutoPromotionEnabled();
        if (autoPromotionEnabled) {
          await LogUtils.writeDebugToFile('Auto-promotion enabled, starting inactivity timer after returning to list');
          startInactivityTimer();
        } else {
          await LogUtils.writeDebugToFile('Auto-promotion disabled, not starting inactivity timer');
        }
      } catch (error) {
        // Default to not starting promotion if we can't check the config
        await LogUtils.writeDebugToFile('Error checking auto-promotion config, defaulting to not starting timer');
      }
    } catch (error) {
      // Even if stopping fails, still cancel patrol and return to list
      navigationCancelledRef.current = true;
      promotionCancelled = true;
      promotionActive = false;
      setIsPatrolling(false);
      isPatrollingRef.current = false;
      setSelectedProduct(null);
      setNavigationStatus(NavigationStatus.IDLE);
      
      // Only start inactivity timer if auto-promotion is enabled
      try {
        const autoPromotionEnabled = await NativeModules.ConfigManagerModule.getAutoPromotionEnabled();
        if (autoPromotionEnabled) {
          await LogUtils.writeDebugToFile('Auto-promotion enabled, starting inactivity timer after error');
          startInactivityTimer();
        } else {
          await LogUtils.writeDebugToFile('Auto-promotion disabled, not starting inactivity timer after error');
        }
      } catch (error) {
        // Default to not starting promotion if we can't check the config
        await LogUtils.writeDebugToFile('Error checking auto-promotion config, defaulting to not starting timer');
      }
    }
  };
  
  const handleGoHome = async () => {
    // Cancel any ongoing patrol unless it's the final step of patrol
    setIsPatrolling(false);
    promotionActive = false;
    promotionCancelled = true;
    await LogUtils.writeDebugToFile('Waypoint sequence cancelled due to manual Go Home');
    
    // Reset navigation cancelled flag
    navigationCancelledRef.current = false;
    
    // Set navigation status to NAVIGATING immediately
    setNavigationStatus(NavigationStatus.NAVIGATING);
    setSelectedProduct(null);
    
    // Reset robot speed to default
    try {
      await NativeModules.SlamtecUtils.setMaxLineSpeed(SPEEDS.default.toString());
      await LogUtils.writeDebugToFile(`Reset robot speed to default: ${SPEEDS.default} m/s`);
    } catch (error: any) {
      await LogUtils.writeDebugToFile(`Failed to reset robot speed: ${error.message}`);
    }
    
    try {
      // Directly call goHome without showing a confirmation dialog
      await LogUtils.writeDebugToFile('Starting navigation to home');
      await NativeModules.SlamtecUtils.goHome();
      
      // Only update state if navigation wasn't cancelled
      if (!navigationCancelledRef.current) {
        // When going home, we skip ARRIVED state and go directly to IDLE
        // This ensures no "We have arrived" dialog is shown
        await LogUtils.writeDebugToFile('Robot arrived home, transitioning directly to IDLE state');
        
        // Go directly to IDLE state (not ARRIVED) to close any dialogs
        setNavigationStatus(NavigationStatus.IDLE);
      }
    } catch (error: any) {
      // Only update error state if navigation wasn't cancelled
      if (!navigationCancelledRef.current) {
        const errorMsg = error.message || 'Navigation to home failed. Please try again.';
        await LogUtils.writeDebugToFile(`Go Home error: ${errorMsg}`);
        setNavigationStatus(NavigationStatus.ERROR);
        setNavigationError(errorMsg);
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
        // Start cooldown timer for 1 minute before restarting polling
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
    switch (navigationStatus) {
      case NavigationStatus.IDLE:
        return (
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search for a person or place..."
              placeholderTextColor="#999"
              value={searchText}
              onChangeText={setSearchText}
            />
            
            {isLoading ? (
              <ActivityIndicator size="large" color="#2670F8" />
            ) : (
              <>
                <FlatList
                  data={filteredProducts}
                  renderItem={renderProductItem}
                  keyExtractor={item => item.eslCode}
                  style={styles.productList}
                  contentContainerStyle={[styles.productListContent, { paddingBottom: 100 }]}
                  keyboardShouldPersistTaps="handled"
                />
                <View style={styles.homeButtonContainer}>
                  <TouchableOpacity
                    style={styles.homeButton}
                    onPress={handleGoHome}
                  >
                    <Text style={styles.homeButtonText}>Go Home</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        );
        
      case NavigationStatus.PATROL:
        // Full-screen image for patrol mode with tap instruction
        return (
          <TouchableOpacity 
            style={styles.fullScreenContainer}
            onPress={handleReturnToList}
            activeOpacity={1}
          >
            <Image 
              source={require('../assets/test_image.jpg')} 
              style={styles.fullScreenImage}
              resizeMode="cover"
            />
            <View style={styles.tapInstructionContainer}>
              <Text style={styles.tapInstructionText}>Tap anywhere for help finding products</Text>
            </View>
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
  };
  
  // Function to reset the inactivity timer
  const resetInactivityTimer = async () => {
    clearInactivityTimer();
    
    // Only start inactivity timer if auto-promotion is enabled
    try {
      const autoPromotionEnabled = await NativeModules.ConfigManagerModule.getAutoPromotionEnabled();
      if (autoPromotionEnabled) {
        await LogUtils.writeDebugToFile('Auto-promotion enabled, starting inactivity timer after reset');
        startInactivityTimer();
      } else {
        await LogUtils.writeDebugToFile('Auto-promotion disabled, not starting inactivity timer after reset');
      }
    } catch (error) {
      // Default to not starting promotion if we can't check the config
      await LogUtils.writeDebugToFile('Error checking auto-promotion config, defaulting to not starting timer after reset');
    }
  };

  // Add a dedicated function to stop pose polling
  const stopPosePolling = async () => {
    if (posePollingRef.current) {
      clearInterval(posePollingRef.current);
      posePollingRef.current = null;
      await LogUtils.writeDebugToFile('Robot pose polling stopped explicitly');
      return true;
    }
    return false;
  };

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

  // Function to read the pose and log it
  const readRobotPose = async () => {
    try {
      // Only continue polling if we're in NAVIGATING or PATROL states
      if (currentNavigationStatusRef.current !== NavigationStatus.NAVIGATING && 
          currentNavigationStatusRef.current !== NavigationStatus.PATROL) {
        await stopPosePolling();
        await LogUtils.writeDebugToFile(`Auto-stopped polling - not in NAVIGATING/PATROL state`);
        return;
      }
      
      const pose = await NativeModules.SlamtecUtils.getCurrentPose();
      if (pose) {
        const timestamp = Date.now();
        
        // Transform coordinates and add quaternion
        const transformedPose = transformCoordinates(pose.x, pose.y, pose.yaw);
        
        // Create formatted log string with the transformed pose including quaternion
        const logString = 
          `ROBOT_POSE: ${timestamp} - ` +
          `pos=[${transformedPose.x.toFixed(4)}, ${transformedPose.y.toFixed(4)}, ${transformedPose.z.toFixed(4)}], ` +
          `quat=[${transformedPose.quaternion.w.toFixed(4)}, ${transformedPose.quaternion.x.toFixed(4)}, ` +
          `${transformedPose.quaternion.y.toFixed(4)}, ${transformedPose.quaternion.z.toFixed(4)}], ` +
          `original=[${transformedPose.originalX.toFixed(4)}, ${transformedPose.originalY.toFixed(4)}, ${transformedPose.originalYaw.toFixed(4)}]`;
          
        await LogUtils.writeDebugToFile(logString);
        
        // Create JSON payload in the requested format
        // Convert millisecond timestamp to nanoseconds by multiplying by 1,000,000
        const timestampNano = BigInt(timestamp) * BigInt(1000000);
        
        // Get device identifiers from global storage
        const identifiers = DeviceStorage.getIdentifiers();
        
        // If identifiers are not in global storage, log an error
        if (!DeviceStorage.hasIdentifiers()) {
          await LogUtils.writeDebugToFile("Error: Device identifiers not found in global storage!");
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
            ry: transformedPose.quaternion.y,
            rz: transformedPose.quaternion.z,
            rw: transformedPose.quaternion.w
          },
          mac_address: identifiers.macAddress || "unknown_mac_address"
        };
        
        // Log the JSON format to debug
        await LogUtils.writeDebugToFile(JSON.stringify(poseData));

        // Send the pose data to the domain
        try {
          // Always use PUT when a data ID exists, otherwise use POST to create one
          const robotPoseDataId = DeviceStorage.getIdentifiers().robotPoseDataId;
          
          if (robotPoseDataId) {
            // If we have a stored data ID, use PUT
            await LogUtils.writeDebugToFile(`Using PUT with existing data ID: ${robotPoseDataId}`);
            const result = await NativeModules.DomainUtils.writeRobotPose(JSON.stringify(poseData), "PUT", robotPoseDataId);
            await LogUtils.writeDebugToFile(`Pose data sent successfully with PUT: ${JSON.stringify(result)}`);
          } else {
            // If no data ID yet, use POST to create one
            await LogUtils.writeDebugToFile(`Using POST to create new robot pose data`);
            const result = await NativeModules.DomainUtils.writeRobotPose(JSON.stringify(poseData), "POST", null);
            await LogUtils.writeDebugToFile(`Pose data sent successfully with POST: ${JSON.stringify(result)}`);
            
            // If this was a POST and we got a data ID back, store it for future updates
            if (result.dataId) {
              DeviceStorage.setRobotPoseDataId(result.dataId);
              await LogUtils.writeDebugToFile(`Stored new robot pose data ID: ${result.dataId}`);
            }
          }
        } catch (error: any) {
          await LogUtils.writeDebugToFile(`Error sending pose data: ${error.message}`);
        }
      }
    } catch (error: any) {
      await LogUtils.writeDebugToFile(`Error getting robot pose: ${error.message}`);
    }
  };

  // Define startPosePolling outside the useEffect so it can be called from multiple places
  const startPosePolling = async () => {
    try {
      // ALWAYS clear any existing interval first to prevent duplicates
      await stopPosePolling();
      
      await LogUtils.writeDebugToFile('Starting robot pose polling at 2 times per second');
      
      // Call once immediately
      await readRobotPose();
      
      // Only set up interval if we're in NAVIGATING or PATROL states
      if (currentNavigationStatusRef.current === NavigationStatus.NAVIGATING || 
          currentNavigationStatusRef.current === NavigationStatus.PATROL) {
        posePollingRef.current = setInterval(readRobotPose, 500);
        await LogUtils.writeDebugToFile('Robot pose polling started successfully');
      } else {
        await LogUtils.writeDebugToFile(`Not starting polling interval - not in NAVIGATING/PATROL state`);
      }
    } catch (error: any) {
      await LogUtils.writeDebugToFile(`Error starting pose polling: ${error.message}`);
    }
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

  return (
    <SafeAreaView 
      style={styles.container}
      onTouchStart={() => {
        // Only reset timer if we're not in promotion mode
        if (!isPatrollingRef.current && navigationStatus !== NavigationStatus.PATROL) {
          // We can't use await in the onTouchStart handler, so we handle it with a promise
          resetInactivityTimer()
            .then(() => LogUtils.writeDebugToFile('Touch detected, reset inactivity timer processed'))
            .catch(err => LogUtils.writeDebugToFile(`Error resetting inactivity timer: ${err.message || err}`));
        }
      }}
    >
      <View style={styles.header}>
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
        
        <TouchableOpacity 
          style={styles.configButton}
          onPress={undefined}
          onLongPress={() => {
            // Clear inactivity timer when config screen is opened
            clearInactivityTimer();
            LogUtils.writeDebugToFile('Config screen opened, cleared inactivity timer');
            // Set flag that we're navigating to config
            navigatingToConfig = true;
            onConfigPress();
          }}
          delayLongPress={3000}
        >
          {/* Config button is now invisible but still functional with long press */}
        </TouchableOpacity>
      </View>
      
      {renderContent()}
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
  homeButtonContainer: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'transparent',
    zIndex: 10,
    elevation: 5,
  },
  homeButton: {
    backgroundColor: '#2670F8',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  homeButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '500',
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
});

export default MainScreen; 