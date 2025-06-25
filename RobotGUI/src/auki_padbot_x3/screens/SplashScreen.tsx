import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  Easing,
  NativeModules,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { LogUtils } from '../utils/logging';
import DeviceStorage from '../../utils/deviceStorage';
import PadbotUtils from '../utils/PadbotUtils';

// Access the global object in a way that works in React Native
const globalAny: any = global;

interface SplashScreenProps {
  onFinish: (options?: { goToConfig?: boolean }) => void;
}

const SplashScreen = ({ onFinish }: SplashScreenProps): React.JSX.Element => {
  const [opacity] = useState(new Animated.Value(1));
  const [loadingText, setLoadingText] = useState('Initializing...');
  const [showDockDialog, setShowDockDialog] = useState(false);
  const [isDocked, setIsDocked] = useState(false);
  const [showInitialDialog, setShowInitialDialog] = useState(true);
  const [initializationStarted, setInitializationStarted] = useState(false);

  // Move initialize function outside useEffect so it can be called from startInitialization
  const initialize = async () => {
    try {
      // Initialize logging first
      await LogUtils.initializeLogging();
      await LogUtils.writeDebugToFile('Starting app initialization...');

      // Initialize Padbot first - this is the central initialization point
      setLoadingText('Initializing Padbot...');
      await LogUtils.writeDebugToFile('Initializing PadbotModule...');
      
      try {
        const robotInitialized = await PadbotUtils.initialize();
        console.log('PadbotUtils.initialize() returned:', robotInitialized);
        await LogUtils.writeDebugToFile(`[DEBUG] PadbotUtils.initialize() returned: ${robotInitialized}`);
        if (robotInitialized) {
          await LogUtils.writeDebugToFile('PadbotModule initialized successfully');
          // Get initial battery status
          const initialBatteryStatus = await PadbotUtils.getBatteryStatus();
          console.log('Initial battery status:', initialBatteryStatus);
          await LogUtils.writeDebugToFile(`[DEBUG] Initial battery status: ${JSON.stringify(initialBatteryStatus)}`);
        } else {
          await LogUtils.writeDebugToFile('Failed to initialize PadbotModule');
          throw new Error('Robot initialization failed');
        }
      } catch (robotError: any) {
        console.log('Error initializing Padbot:', robotError);
        await LogUtils.writeDebugToFile(`[DEBUG] Error initializing Padbot: ${robotError.message}`);
        throw robotError;
      }

      // Debug: Before Slamtec SDK test
      console.log('[DEBUG] Before Slamtec SDK test');
      await LogUtils.writeDebugToFile('[DEBUG] Before Slamtec SDK test');

      // Test Slamtec SDK connection
      try {
        setLoadingText('Testing Slamtec SDK connection...');
        console.log('[DEBUG] Testing Slamtec SDK connection...');
        await LogUtils.writeDebugToFile('[DEBUG] Testing Slamtec SDK connection...');

        // Test SDK connection
        const sdkConnectionDetails = await NativeModules.SlamtecUtils.checkConnectionSdk();
        console.log('[DEBUG] Slamtec SDK connection:', sdkConnectionDetails);
        await LogUtils.writeDebugToFile(`[DEBUG] Slamtec SDK connection: ${JSON.stringify(sdkConnectionDetails)}`);

        if (!sdkConnectionDetails.slamApiAvailable) {
          throw new Error('Slamtec SDK connection failed');
        }

        await LogUtils.writeDebugToFile('[DEBUG] Slamtec SDK connection successful');
        console.log('[DEBUG] Slamtec SDK connection successful');
      } catch (slamtecError: any) {
        console.log('[DEBUG] Error testing Slamtec SDK connection:', slamtecError);
        await LogUtils.writeDebugToFile(`[DEBUG] Error testing Slamtec SDK connection: ${slamtecError.message}`);
        throw slamtecError;
      }

      // Debug: After Slamtec SDK test
      console.log('[DEBUG] After Slamtec SDK test');
      await LogUtils.writeDebugToFile('[DEBUG] After Slamtec SDK test');

      // Get device identifiers early and store them globally
      try {
        setLoadingText('Initializing device...');
        
        const identifiers = await NativeModules.DomainUtils.getDeviceIdentifiers();
        DeviceStorage.setIdentifiers(identifiers.deviceId, identifiers.macAddress);
        await LogUtils.writeDebugToFile(`Device identifiers initialized: deviceId=${identifiers.deviceId}, macAddress=${identifiers.macAddress}`);
      } catch (identifierError: any) {
        await LogUtils.writeDebugToFile(`Error initializing device identifiers: ${identifierError.message}`);
      }

      // First authenticate with stored credentials
      setLoadingText('Authenticating...');
      await LogUtils.writeDebugToFile('Attempting authentication...');
      
      // Use the regular authentication system, not auki_padbot_x3 credentials
      let authSuccess = false;
      let authAttempts = 0;
      const maxAuthAttempts = 3;
      
      while (!authSuccess && authAttempts < maxAuthAttempts) {
        try {
          authAttempts++;
          await LogUtils.writeDebugToFile(`Authentication attempt ${authAttempts}/${maxAuthAttempts}`);
          
          // This uses the existing authentication system with stored credentials
          await NativeModules.DomainUtils.authenticate(null, null, null);
          await LogUtils.writeDebugToFile('Authentication successful');
          authSuccess = true;

          // First try to get existing robot pose data ID
          try {
            await LogUtils.writeDebugToFile('Checking for existing robot pose data ID...');
            const dataIdResult = await NativeModules.DomainUtils.getRobotPoseDataId();
            
            if (dataIdResult.exists) {
              // Use existing data ID if available
              DeviceStorage.setRobotPoseDataId(dataIdResult.dataId);
              await LogUtils.writeDebugToFile(`Found existing robot pose data ID: ${dataIdResult.dataId}`);
            } else {
              // Only if no existing data ID, send test robot pose data with POST method
              await LogUtils.writeDebugToFile('No existing data ID found. Sending test robot pose data with POST method...');
              const testData = '{"Test 1 2 3 4"}';
              const result = await NativeModules.DomainUtils.writeRobotPose(testData, 'POST', null);
              await LogUtils.writeDebugToFile(`Robot pose test data sent successfully with ${result.method} method`);
              
              // Store the data ID from POST result
              if (result.dataId) {
                DeviceStorage.setRobotPoseDataId(result.dataId);
                await LogUtils.writeDebugToFile(`Robot pose data ID from POST: ${result.dataId}`);
              } else {
                await LogUtils.writeDebugToFile('No robot pose data ID returned from POST. Will create one with the first pose update.');
              }
            }
          } catch (poseError: any) {
            await LogUtils.writeDebugToFile(`Error handling robot pose data: ${poseError.message}`);
          }
        } catch (authError: any) {
          await LogUtils.writeDebugToFile(`Authentication error on attempt ${authAttempts}: ${authError.message}`);
          
          // Log more detailed error information
          if (authError.code) {
            await LogUtils.writeDebugToFile(`Error code: ${authError.code}`);
          }
          
          // Implement exponential backoff between retries
          if (authAttempts < maxAuthAttempts) {
            const backoffDelay = Math.pow(2, authAttempts - 1) * 1000; // 1s, 2s, 4s
            await LogUtils.writeDebugToFile(`Retrying authentication in ${backoffDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
          }
        }
      }
      
      if (!authSuccess) {
        await LogUtils.writeDebugToFile('All authentication attempts failed, proceeding with limited functionality');
        setLoadingText('Authentication failed. Some features may be limited.');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Update map
      try {
        setLoadingText('Updating map...');
        await LogUtils.writeDebugToFile('Updating map...');
        
        // Only try to update map if authentication was successful
        if (authSuccess) {
          // Check if map is already being downloaded from authenticate
          // The authenticate method already triggers map download, so we'll just wait here
          await LogUtils.writeDebugToFile('Authentication successful - downloading map');

          const mapResult = await NativeModules.DomainUtils.getStcmMap(20);
          await LogUtils.writeDebugToFile(`Map downloaded successfully: ${mapResult.filePath}`);
          
          // Wait a reasonable amount of time for the map download to progress
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // No need to explicitly call downloadAndProcessMap() here as it was initiated during authentication
          await LogUtils.writeDebugToFile('Map download complete');

          const homedockData = await NativeModules.DomainUtils.getHomedockQrId();
          await LogUtils.writeDebugToFile(`Got homedock data: ${JSON.stringify(homedockData)}`);
          
          if (homedockData.qrId) {
            // Calculate initialPose and homePoint using SlamtecUtils
            const homedock = [
              homedockData.px,
              homedockData.py,
              homedockData.pz,
              homedockData.yaw,
              0.0,
              0.0
            ];
            
            // Calculate poses
            const initialPose = await NativeModules.SlamtecUtils.calculatePose(homedock, 0.2);
            const homePoint = await NativeModules.SlamtecUtils.calculatePose(homedock, 0.5);
            
            // Store poses globally and log once
            globalAny.initialPose = initialPose;
            globalAny.homePoint = homePoint;
            await LogUtils.writeDebugToFile(`Calculated and stored poses - initialPose: ${JSON.stringify(globalAny.initialPose)}, homePoint: ${JSON.stringify(globalAny.homePoint)}`);

            // Process the map with SDK
            const processResult = await NativeModules.SlamtecUtils.processMapWithSdk(
              mapResult.filePath,
              globalAny.initialPose
            );
            await LogUtils.writeDebugToFile(`Map processed with SDK: ${processResult.mapPath}`);

            const currentPose = await NativeModules.SlamtecUtils.getCurrentPoseSdk();
            await LogUtils.writeDebugToFile(`Current pose: ${JSON.stringify(currentPose)}`);
          } 
        } else {
          await LogUtils.writeDebugToFile('Skipping map update due to authentication failure');
        }
      } catch (mapError: any) {
        await LogUtils.writeDebugToFile(`Map update error: ${mapError.message}, proceeding anyway`);
        setLoadingText('Map update failed. Using existing map.');
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
      // Initialization completed successfully - transition to ConfigScreen
      await LogUtils.writeDebugToFile('Initialization completed successfully, transitioning to ConfigScreen');
      setLoadingText('Initialization complete!');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      Animated.timing(opacity, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        onFinish({ goToConfig: true });
      });
      
    } catch (error: any) {
      const errorMessage = error.message || 'Error during initialization';
      await LogUtils.writeDebugToFile(`Error during initialization: ${errorMessage}`);
      console.error('Error during initialization:', error);
      setLoadingText(errorMessage);
      // Still finish after error, but with empty products
      setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          onFinish({ goToConfig: true });
        });
      }, 2000);
    }
  };

  // Function to start initialization - called when user clicks OK
  const startInitialization = () => {
    setInitializationStarted(true);
    setShowInitialDialog(false);
    
    // Start the timeout timer
    const timeoutId = setTimeout(() => {
      setLoadingText('Loading timeout reached');
      Animated.timing(opacity, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        onFinish({ goToConfig: true });
      });
    }, 30000);

    // Start the initialization process
    initialize();
  };

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let pollInterval: NodeJS.Timeout;
    let isMounted = true;

    const checkDockStatus = async () => {
      try {
        const batteryStatus = await PadbotUtils.getBatteryStatus();
        if (!batteryStatus.charging) {
          setShowDockDialog(true);
          setIsDocked(false);
          return false;
        } else {
          setShowDockDialog(false);
          setIsDocked(true);
          return true;
        }
      } catch (e) {
        setShowDockDialog(true);
        setIsDocked(false);
        return false;
      }
    };

    const checkCredentials = async () => {
      try {
        const creds = await NativeModules.DomainUtils.getStoredCredentials();
        const hasCreds = creds && creds.email && creds.password && creds.domainId && creds.email.length > 0 && creds.password.length > 0 && creds.domainId.length > 0;
        if (!hasCreds) {
          // Skip initialization and go to ConfigScreen
          onFinish({ goToConfig: true });
          return false;
        }
        return true;
      } catch (e) {
        onFinish({ goToConfig: true });
        return false;
      }
    };

    const waitForDock = async () => {
      setLoadingText('Checking docking status...');
      await LogUtils.writeDebugToFile('Checking robot docking status...');
      
      let docked = await checkDockStatus();
      if (!docked) {
        await LogUtils.writeDebugToFile('Robot not docked, waiting for docking...');
        pollInterval = setInterval(async () => {
          docked = await checkDockStatus();
          if (docked) {
            await LogUtils.writeDebugToFile('Robot successfully docked');
            clearInterval(pollInterval);
            // After docked, check credentials
            const credsOk = await checkCredentials();
            if (credsOk) initialize();
          }
        }, 5000);
      } else {
        await LogUtils.writeDebugToFile('Robot already docked');
        // After docked, check credentials
        const credsOk = await checkCredentials();
        if (credsOk) initialize();
      }
    };

    // Comment out waitForDock since we don't need to check docking status
    // waitForDock();

    // Don't start initialization automatically - wait for user to click OK
    // initialize();

    // Don't set timeout automatically - it will be set when user clicks OK
    // timeoutId = setTimeout(() => {
    //   if (isMounted) {
    //     setLoadingText('Loading timeout reached');
    //     Animated.timing(opacity, {
    //       toValue: 0,
    //       duration: 500,
    //       easing: Easing.out(Easing.cubic),
    //       useNativeDriver: true,
    //     }).start(() => {
    //       onFinish({ goToConfig: true });
    //     });
    //   }
    // }, 30000);

    // DEBUG: Log all available PadbotUtils and PadbotModule methods at startup
    (async () => {
      try {
        const initResult = await PadbotUtils.initialize();
        // Add a small delay after initialization
        await new Promise(resolve => setTimeout(resolve, 500));
        const batteryStatus = await PadbotUtils.getBatteryStatus();
        const isCharging = await PadbotUtils.isCharging();
        
        console.log('[PadbotUtils] initialize:', initResult);
        console.log('[PadbotUtils] getBatteryStatus:', batteryStatus);
        console.log('[PadbotUtils] isCharging:', isCharging);
        LogUtils.writeDebugToFile(`[PadbotUtils] initialize: ${JSON.stringify(initResult)}`);
        LogUtils.writeDebugToFile(`[PadbotUtils] getBatteryStatus: ${JSON.stringify(batteryStatus)}`);
        LogUtils.writeDebugToFile(`[PadbotUtils] isCharging: ${JSON.stringify(isCharging)}`);
        
        // Try to enumerate and call any extra methods on PadbotModule
        const padbotModule = NativeModules.PadbotModule;
        if (padbotModule) {
          Object.keys(padbotModule).forEach(async (key) => {
            try {
              const result = typeof padbotModule[key] === 'function' ? await padbotModule[key]() : padbotModule[key];
              console.log(`[PadbotModule] ${key}:`, result);
              LogUtils.writeDebugToFile(`[PadbotModule] ${key}: ${JSON.stringify(result)}`);
            } catch (e) {
              console.log(`[PadbotModule] ${key}: error`, e);
              LogUtils.writeDebugToFile(`[PadbotModule] ${key}: error ${e}`);
            }
          });
        }
      } catch (e) {
        console.log('[PadbotUtils] Debug block error:', e);
        LogUtils.writeDebugToFile(`[PadbotUtils] Debug block error: ${e}`);
      }
    })();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [opacity, onFinish]);

  return (
    <View style={styles.background}>
      <Animated.View style={[styles.container, { opacity }]}>
        <View style={styles.topContainer}>
          <View style={styles.logoContainer}>
            <Image
              source={require('../assets/Auki Logo Black.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.welcomeText}>Welcome to Auki Robotics</Text>
          <Text style={styles.loadingText}>{loadingText}</Text>
        </View>
        <View style={styles.padbotImageContainer}>
          <Image
            source={require('../assets/padbot.jpg')}
            style={styles.padbotImage}
            resizeMode="contain"
          />
        </View>
      </Animated.View>
      
      {/* Initial dialog asking user to ensure robot is on dock */}
      <Modal
        visible={showInitialDialog}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {}}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Robot Setup</Text>
            <Text style={styles.modalText}>Ensure the robot is on the dock</Text>
            <TouchableOpacity
              style={styles.okButton}
              onPress={startInitialization}>
              <Text style={styles.okButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      
      <Modal
        visible={showDockDialog}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {}}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalText}>Please return the robot to its docking station.</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topContainer: {
    alignItems: 'center',
    width: '80%',
    marginBottom: 40,
  },
  logoContainer: {
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  welcomeText: {
    color: '#101010',
    fontSize: 36,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 40,
  },
  loadingText: {
    color: '#101010',
    fontSize: 24,
    textAlign: 'center',
  },
  padbotImageContainer: {
    width: '50%',
    aspectRatio: 4,
  },
  padbotImage: {
    width: '100%',
    height: '100%',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    padding: 30,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#101010',
    marginBottom: 15,
    textAlign: 'center',
  },
  modalText: {
    fontSize: 22,
    color: '#101010',
    textAlign: 'center',
    marginBottom: 20,
  },
  okButton: {
    backgroundColor: '#007BFF',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  okButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default SplashScreen; 