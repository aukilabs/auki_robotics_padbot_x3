import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  TextInput,
  Image,
  ScrollView,
  Alert,
  NativeModules,
  NativeEventEmitter,
  AppState,
  AppStateStatus,
  SafeAreaView,
  BackHandler,
  ActivityIndicator,
} from 'react-native';
import { LogUtils } from '../utils/logging';
import { 
  clearInactivityTimer, 
  startInactivityTimer, 
  resetInactivityTimer 
} from '../utils/inactivityTimer';

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

// Add AuthState object to track token state
const AuthState = {
  lastRefreshTime: 0,
  isRefreshing: false,
  validationInProgress: false,
  lastValidationTime: 0,
  tokenValid: false,
};

interface MainScreenProps {
  onClose: () => void;
  onConfigPress: () => void;
  initialProducts: any[];
}

interface Product {
  name: string;
  eslCode: string;
  pose: {
    x: number;
    y: number;
    z: number;
    yaw?: number;  // Optional yaw value
    px?: number;   // Alternative position format
    py?: number;
    pz?: number;
  };
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
  
  // Add ref to track token validation interval
  const tokenValidationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Add ref to track if navigation has been cancelled
  const navigationCancelledRef = useRef(false);
  
  // Store patrol state in a ref to access in useEffect cleanup
  const isPatrollingRef = useRef(false);
  
  // Set the mounted ref to true
  const isMountedRef = useRef(true);
  
  // Add ref to track app state
  const appStateRef = useRef<string>(AppState.currentState);
  
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

  // Effect to handle token validation and refresh
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
            
            if (retryCount < 1) {  // Only retry once
              await LogUtils.writeDebugToFile('Attempting to validate and refresh token');
              // Try validation first
              if (await validateToken(true)) {
                await LogUtils.writeDebugToFile('Token refreshed, retrying navigation');
                return attemptNavigation(retryCount + 1);
              }
            }
            
            // If we've already retried or refresh failed, show error and return to list
            await LogUtils.writeDebugToFile('Token refresh failed or max retries reached');
            
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
          
          if (retryCount < 1) {  // Only retry once
            await LogUtils.writeDebugToFile('Attempting to validate and refresh token');
            // Try validation first
            if (await validateToken(true)) {
              await LogUtils.writeDebugToFile('Token refreshed, retrying navigation');
              return attemptNavigation(retryCount + 1);
            }
          }
          
          // If we've already retried or refresh failed, show error and return to list
          await LogUtils.writeDebugToFile('Token refresh failed or max retries reached');
          
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
    
    // Validate token before attempting navigation
    if (!await validateToken()) {
      await LogUtils.writeDebugToFile('Token validation failed before going home, attempting refresh');
      
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
      await NativeModules.SlamtecUtils.navigateHomeWithSdk(-1.5, -8.26, 0.0);
      
      // Only update state if navigation wasn't cancelled
      if (!navigationCancelledRef.current) {
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
  
  const renderProductItem = ({ item }: { item: Product }) => (
    <TouchableOpacity 
      style={styles.productItem}
      onPress={() => handleProductSelect(item)}
    >
      <Text style={styles.productText}>{item.name} ({item.eslCode})</Text>
    </TouchableOpacity>
  );
  
  // Render different views based on navigation status
  const renderContent = () => {
    switch (navigationStatus) {
      case NavigationStatus.IDLE:
        return (
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search products..."
              placeholderTextColor="#999"
              value={searchText}
              onChangeText={setSearchText}
            />
            
            {isLoading ? (
              <ActivityIndicator size="large" color="rgb(0, 215, 68)" />
            ) : (
              <FlatList
                data={filteredProducts}
                renderItem={renderProductItem}
                keyExtractor={item => item.eslCode}
                style={styles.productList}
                contentContainerStyle={styles.productListContent}
              />
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
              <ActivityIndicator size="large" color="rgb(0, 215, 68)" style={styles.navigationSpinner} />
              
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
        
        <Text style={styles.headerTitle}>Cactus Assistant</Text>
        
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
    backgroundColor: '#404040',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'rgb(0, 215, 68)',
    flex: 1,
    textAlign: 'center',
  },
  closeButton: {
    padding: 5,
    width: 40,
    height: 40,
    // No background color or border to make it invisible
  },
  closeButtonText: {
    fontSize: 24,
    color: 'rgb(0, 215, 68)',
  },
  configButton: {
    padding: 5,
    width: 40,
    height: 40,
    // No background color or border to make it invisible
  },
  configButtonText: {
    fontSize: 32,
    color: 'rgb(0, 215, 68)',
    textAlign: 'right',
  },
  searchContainer: {
    flex: 1,
    padding: 20,
  },
  searchInput: {
    backgroundColor: '#303030',
    color: 'white',
    borderWidth: 2,
    borderColor: 'rgb(0, 215, 68)',
    borderRadius: 5,
    padding: 15,
    fontSize: 22,
    marginBottom: 20,
    minHeight: 60,
  },
  productList: {
    flex: 1,
    backgroundColor: '#303030',
    borderRadius: 5,
  },
  productListContent: {
    paddingVertical: 5,
  },
  productItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#505050',
    minHeight: 60,
  },
  productText: {
    color: 'white',
    fontSize: 18,
  },
  homeButton: {
    backgroundColor: 'rgb(0, 215, 68)',
    padding: 15,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 20,
    minHeight: 50,
  },
  homeButtonText: {
    color: '#404040',
    fontSize: 18,
    fontWeight: 'bold',
  },
  navigationContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  navigationDialog: {
    backgroundColor: '#404040',
    borderRadius: 10,
    padding: 30,
    width: '80%',
    maxWidth: 500,
    alignItems: 'center',
  },
  navigationTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'rgb(0, 215, 68)',
    marginBottom: 20,
    textAlign: 'center',
  },
  navigationProductName: {
    fontSize: 28,
    color: 'white',
    textAlign: 'center',
    marginBottom: 30,
  },
  navigationSpinner: {
    marginTop: 20,
  },
  navigationErrorText: {
    fontSize: 24,
    color: '#F44336',
    textAlign: 'center',
    marginVertical: 20,
  },
  navigationButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 20,
  },
  navigationButton: {
    backgroundColor: '#666',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 5,
    minWidth: 150,
    marginHorizontal: 10,
  },
  navigationButtonText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  navigationHomeButton: {
    backgroundColor: 'rgb(0, 215, 68)',
  },
  navigationHomeButtonText: {
    color: '#404040',
  },
  cancelButton: {
    backgroundColor: '#F44336',
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
    bottom: 5,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingVertical: 15,
  },
  tapInstructionText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 5,
  },
});

export default MainScreen; 