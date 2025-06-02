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
  NativeEventEmitter,
  EmitterSubscription,
  TouchableOpacity,
} from 'react-native';
import { LogUtils } from '../utils/logging';
import DeviceStorage from '../../utils/deviceStorage';
import PadbotUtils from '../utils/PadbotUtils';

// Access the global object in a way that works in React Native
const globalAny: any = global;

interface BatteryStatus {
  percentage: number;
  charging: boolean;
  isInitialValue?: boolean;
}

interface SplashScreenProps {
  onFinish: (products: any[], options?: { goToConfig?: boolean }) => void;
}

const SplashScreen = ({ onFinish }: SplashScreenProps): React.JSX.Element => {
  const [opacity] = useState(new Animated.Value(1));
  const [loadingText, setLoadingText] = useState('Initializing...');
  const [showDockDialog, setShowDockDialog] = useState(false);
  const [showRemoveDockDialog, setShowRemoveDockDialog] = useState(false);
  const [showWaitDialog, setShowWaitDialog] = useState(false);
  const [isMounted] = useState(true);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const waitForBatteryStatus = async (): Promise<BatteryStatus> => {
    setShowWaitDialog(true);
    await LogUtils.writeDebugToFile('Waiting for valid battery status...');

    let batterySubscription: EmitterSubscription | undefined;
    let validBatteryReceived = false;

    try {
      batterySubscription = PadbotUtils.addBatteryListener((status: BatteryStatus) => {
        if (!validBatteryReceived && status.percentage !== -1) {
          validBatteryReceived = true;
          LogUtils.writeDebugToFile(`Received valid battery status: ${JSON.stringify(status)}`);
          setShowWaitDialog(false);
          setShowDockDialog(true);
        }
      }) as EmitterSubscription;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Could not get valid battery status after 75s'));
        }, 75000);

        const checkConditions = () => {
          if (validBatteryReceived) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkConditions, 1000);
          }
        };
        checkConditions();
      });

      return await PadbotUtils.getBatteryStatus();
    } finally {
      if (batterySubscription) batterySubscription.remove();
    }
  };

  const waitForCharging = async (): Promise<void> => {
    let chargingSubscription: EmitterSubscription | undefined;
    let chargingStarted = false;

    try {
      chargingSubscription = PadbotUtils.addChargingListener((info: { isCharging: boolean }) => {
        if (info.isCharging) {
          chargingStarted = true;
          setShowDockDialog(false);
          LogUtils.writeDebugToFile('Robot successfully docked (charging state true)');
        }
      }) as EmitterSubscription;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Could not get charging status after 75s'));
        }, 75000);

        const checkConditions = () => {
          if (chargingStarted) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkConditions, 1000);
          }
        };
        checkConditions();
      });
    } finally {
      if (chargingSubscription) chargingSubscription.remove();
    }
  };

  const initialize = async () => {
    try {
      // Initialize logging first
      await LogUtils.initializeLogging();
      await LogUtils.writeDebugToFile('Starting app initialization...');

      // Initialize Padbot first - this is the central initialization point
      if (isMounted) {
        setLoadingText('Initializing Padbot...');
        await LogUtils.writeDebugToFile('Initializing PadbotModule...');
      }
      
      let batteryStatus;
      try {
        const robotInitialized = await PadbotUtils.initialize();
        console.log('PadbotUtils.initialize() returned:', robotInitialized);
        await LogUtils.writeDebugToFile(`[DEBUG] PadbotUtils.initialize() returned: ${robotInitialized}`);
        if (robotInitialized) {
          await LogUtils.writeDebugToFile('PadbotModule initialized successfully');
          
          // Wait for valid battery status
          batteryStatus = await waitForBatteryStatus();
          console.log('[PadbotUtils] getBatteryStatus:', batteryStatus);
          await LogUtils.writeDebugToFile(`[PadbotUtils] getBatteryStatus: ${JSON.stringify(batteryStatus)}`);
          
          // Wait for charging state
          await waitForCharging();
          
          // Log PadbotModule constants
          const padbotModule = NativeModules.PadbotModule;
          if (padbotModule) {
            const constants = await padbotModule.getConstants();
            console.log('[PadbotModule] getConstants:', constants);
            await LogUtils.writeDebugToFile(`[PadbotModule] getConstants: ${JSON.stringify(constants)}`);
          }
        } else {
          await LogUtils.writeDebugToFile('Failed to initialize PadbotModule');
          throw new Error('Robot initialization failed');
        }
      } catch (robotError: any) {
        console.log('Error initializing Padbot:', robotError);
        await LogUtils.writeDebugToFile(`[DEBUG] Error initializing Padbot: ${robotError.message}`);
        throw robotError;
      }

      // Start the main 30s timeout after charging state is confirmed
      setTimeoutId(setTimeout(() => {
        if (isMounted) {
          setLoadingText('Loading timeout reached');
          Animated.timing(opacity, {
            toValue: 0,
            duration: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start(() => {
            onFinish([], { goToConfig: true });
          });
        }
      }, 30000));

      // Debug: Before Slamtec SDK test
      console.log('[DEBUG] Before Slamtec SDK test');
      await LogUtils.writeDebugToFile('[DEBUG] Before Slamtec SDK test');

      // Test Slamtec SDK connection
      try {
        if (isMounted) {
          setLoadingText('Testing Slamtec SDK connection...');
          console.log('[DEBUG] Testing Slamtec SDK connection...');
          await LogUtils.writeDebugToFile('[DEBUG] Testing Slamtec SDK connection...');
        }

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
        if (isMounted) {
          setLoadingText('Initializing device...');
        }
        
        const identifiers = await NativeModules.DomainUtils.getDeviceIdentifiers();
        DeviceStorage.setIdentifiers(identifiers.deviceId, identifiers.macAddress);
        await LogUtils.writeDebugToFile(`Device identifiers initialized: deviceId=${identifiers.deviceId}, macAddress=${identifiers.macAddress}`);
      } catch (identifierError: any) {
        await LogUtils.writeDebugToFile(`Error initializing device identifiers: ${identifierError.message}`);
      }

      // First authenticate with stored credentials
      if (isMounted) {
        setLoadingText('Authenticating...');
        await LogUtils.writeDebugToFile('Attempting authentication...');
      }
      
      // Use the regular authentication system, not gotu credentials
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
        if (isMounted) {
          setLoadingText('Authentication failed. Some features may be limited.');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Update map
      try {
        if (isMounted) {
          setLoadingText('Updating map...');
          await LogUtils.writeDebugToFile('Updating map...');
        }
        
        // Only try to update map if authentication was successful
        if (authSuccess) {
          // First, get homedock pose
          try {
            if (isMounted) {
              setLoadingText('Getting homedock pose...');
              await LogUtils.writeDebugToFile('Getting homedock pose...');
            }
            
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
              const homePoint = await NativeModules.SlamtecUtils.calculatePose(homedock, 0.4);
              
              // Store poses globally and log once
              globalAny.initialPose = initialPose;
              globalAny.homePoint = homePoint;
              await LogUtils.writeDebugToFile(`Calculated and stored poses - initialPose: ${JSON.stringify(globalAny.initialPose)}, homePoint: ${JSON.stringify(globalAny.homePoint)}`);
            }
          } catch (error) {
            await LogUtils.writeDebugToFile(`Error getting homedock pose: ${error}`);
            if (isMounted) {
              setLoadingText('Error getting homedock pose. Some features may be limited.');
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }

          // First, request storage permissions
          await NativeModules.DomainUtils.requestStoragePermission();
          
          // Download the STCM map
          const mapResult = await NativeModules.DomainUtils.getStcmMap(20);
          await LogUtils.writeDebugToFile(`Map downloaded successfully: ${mapResult.filePath}`);
          
          // Process the map with SDK
          const processResult = await NativeModules.SlamtecUtils.processMapWithSdk(mapResult.filePath);
          await LogUtils.writeDebugToFile(`Map processed with SDK: ${processResult.mapPath}`);
          
          if (processResult.success) {
            await LogUtils.writeDebugToFile('Map update complete');
            if (isMounted) {
              setLoadingText('Map updated successfully');
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          } else {
            throw new Error('Map processing failed');
          }
        } else {
          await LogUtils.writeDebugToFile('Skipping map update due to authentication failure');
        }
      } catch (mapError: any) {
        await LogUtils.writeDebugToFile(`Map update error: ${mapError.message}, proceeding anyway`);
        if (isMounted) {
          setLoadingText('Map update failed. Using existing map.');
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      // Load items from Gotu endpoint
      if (isMounted) {
        setLoadingText('Loading items...');
        await LogUtils.writeDebugToFile('Loading Gotu items...');
      }
      
      try {
        await LogUtils.writeDebugToFile('Attempting to get items from GotuUtils...');
        const products = await NativeModules.GotuUtils.getItems();
        await LogUtils.writeDebugToFile(`GotuUtils.getItems() returned ${products?.length || 0} items`);
        
        if (!products) {
          throw new Error('No products returned from GotuUtils.getItems()');
        }
        
        const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name));
        await LogUtils.writeDebugToFile(`Loaded ${products.length} items`);

        if (isMounted) {
          // Add a short delay before transition
          await new Promise(resolve => setTimeout(resolve, 1000));
          await LogUtils.writeDebugToFile('Initialization complete, transitioning to main screen...');
          
          // Create fade-out animation
          Animated.timing(opacity, {
            toValue: 0,
            duration: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start(() => {
            onFinish(sortedProducts);
          });
        }
      } catch (error: any) {
        await LogUtils.writeDebugToFile(`Error loading items: ${error.message}`);
        if (isMounted) {
          setLoadingText(`Error loading items: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          onFinish([], { goToConfig: true });
        }
      }
    } catch (error: any) {
      await LogUtils.writeDebugToFile(`Error during initialization: ${error.message}`);
      if (isMounted) {
        setLoadingText(`Error: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        onFinish([], { goToConfig: true });
      }
    }
  };

  const handleOkPress = async () => {
    try {
      setShowRemoveDockDialog(false);
      await initialize();
    } catch (error: any) {
      console.error('Error during initialization:', error);
      await LogUtils.writeDebugToFile(`Error during initialization: ${error.message}`);
      setLoadingText(`Error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      onFinish([], { goToConfig: true });
    }
  };

  useEffect(() => {
    let isMounted = true;

    const checkCredentials = async () => {
      try {
        const creds = await NativeModules.DomainUtils.getStoredCredentials();
        const hasCreds = creds && creds.email && creds.password && creds.domainId && creds.email.length > 0 && creds.password.length > 0 && creds.domainId.length > 0;
        if (!hasCreds) {
          onFinish([], { goToConfig: true });
          return false;
        }
        return true;
      } catch (e) {
        onFinish([], { goToConfig: true });
        return false;
      }
    };

    // Start with remove from dock dialog
    setShowRemoveDockDialog(true);

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [opacity, onFinish]);

  return (
    <View style={styles.background}>
      <Animated.View style={[styles.container, { opacity }]}>
        <View style={styles.contentContainer}>
          <View style={styles.logoContainer}>
            <Image 
              source={require('../assets/AppIcon_Gotu.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.welcomeText}>
            Welcome to{'\n'}Gotu
          </Text>
          <Text style={styles.loadingText}>{loadingText}</Text>
        </View>
      </Animated.View>
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
      <Modal
        visible={showRemoveDockDialog}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {}}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalText}>Remove the robot from the dock</Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={handleOkPress}
            >
              <Text style={styles.modalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal
        visible={showWaitDialog}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {}}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalText}>Please wait...</Text>
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
  contentContainer: {
    padding: 30,
    alignItems: 'center',
    width: '80%',
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
    marginVertical: 20,
  },
  loadingText: {
    color: '#2670F8',
    fontSize: 24,
    textAlign: 'center',
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
  modalText: {
    fontSize: 22,
    color: '#101010',
    textAlign: 'center',
  },
  modalButton: {
    backgroundColor: '#2670F8',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 5,
    marginTop: 15,
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default SplashScreen; 