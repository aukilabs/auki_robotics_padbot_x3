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
  const [isDocked, setIsDocked] = useState(false);
  const [showRemoveDockDialog, setShowRemoveDockDialog] = useState(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let pollInterval: NodeJS.Timeout;
    let isMounted = true;

    const checkDockStatus = async () => {
      try {
        const powerStatus = await NativeModules.SlamtecUtils.getPowerStatus();
        if (powerStatus.dockingStatus !== 'on_dock') {
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
          onFinish([], { goToConfig: true });
          return false;
        }
        return true;
      } catch (e) {
        onFinish([], { goToConfig: true });
        return false;
      }
    };

    const waitForCharging = async (): Promise<BatteryStatus> => {
      setLoadingText('Waiting for robot to be docked...');
      await LogUtils.writeDebugToFile('Waiting for robot to be docked (charging state)...');

      // First show the "Remove from dock" dialog
      setShowRemoveDockDialog(true);
      await LogUtils.writeDebugToFile('Showing remove from dock dialog');

      let batterySubscription: EmitterSubscription | undefined;
      let chargingSubscription: EmitterSubscription | undefined;
      let validBatteryReceived = false;
      let chargingStarted = false;

      try {
        batterySubscription = PadbotUtils.addBatteryListener((status: BatteryStatus) => {
          if (!validBatteryReceived && status.percentage !== -1) {
            validBatteryReceived = true;
            LogUtils.writeDebugToFile(`Received valid battery status: ${JSON.stringify(status)}`);
            setShowRemoveDockDialog(false);
            setShowDockDialog(true);
            setIsDocked(false);
          }
        });

        chargingSubscription = PadbotUtils.addChargingListener((info: { isCharging: boolean }) => {
          if (info.isCharging) {
            chargingStarted = true;
            setShowDockDialog(false);
            setIsDocked(true);
            LogUtils.writeDebugToFile('Robot successfully docked (charging state true)');
          }
        });

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Could not get valid battery status after 75s'));
          }, 75000);

          const checkConditions = () => {
            if (validBatteryReceived && chargingStarted) {
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
        if (chargingSubscription) chargingSubscription.remove();
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
            
            // Wait for charging state to be true before proceeding
            batteryStatus = await waitForCharging();
            console.log('[PadbotUtils] getBatteryStatus:', batteryStatus);
            await LogUtils.writeDebugToFile(`[PadbotUtils] getBatteryStatus: ${JSON.stringify(batteryStatus)}`);
            
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
        timeoutId = setTimeout(() => {
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
        }, 30000);

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
        /*
        try {
          if (isMounted) {
            setLoadingText('Updating map...');
            await LogUtils.writeDebugToFile('Updating map...');
          }
          
          // Only try to update map if authentication was successful
          if (authSuccess) {
            // Check if map is already being downloaded from authenticate
            // The authenticate method already triggers map download, so we'll just wait here
            await LogUtils.writeDebugToFile('Authentication successful - map download was triggered during authentication');
            
            // Wait a reasonable amount of time for the map download to progress
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // No need to explicitly call downloadAndProcessMap() here as it was initiated during authentication
            await LogUtils.writeDebugToFile('Map update complete');
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
        */

        // Load and validate waypoints
        /*
        try {
          if (isMounted) {
            setLoadingText('Validating waypoints...');
            await LogUtils.writeDebugToFile('Validating waypoints...');
          }
          
          const patrolPointsContent = await NativeModules.FileUtils.readFile('patrol_points.json');
          if (patrolPointsContent) {
            const patrolPoints = JSON.parse(patrolPointsContent);
            const formattedPoints = patrolPoints.patrol_points.map((point: any) => ({
              yaw: point.yaw,
              y: point.y,
              x: point.x,
              name: point.name
            }));
            await LogUtils.writeDebugToFile(`Patrol Points Configuration: ${JSON.stringify(formattedPoints)}`);

            // Get current POIs
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
          }
        } catch (waypointError: any) {
          await LogUtils.writeDebugToFile(`Error validating waypoints: ${waypointError.message}`);
        }
        */

        // Clean up
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (pollInterval) {
          clearInterval(pollInterval);
        }
      } catch (error: any) {
        console.log('Error during initialization:', error);
        await LogUtils.writeDebugToFile(`Error during initialization: ${error.message}`);
        if (isMounted) {
          setLoadingText('Initialization failed');
          Animated.timing(opacity, {
            toValue: 0,
            duration: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start(() => {
            onFinish([], { goToConfig: true });
          });
        }
      }
    };

    // Start initialization
    initialize();

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [onFinish]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.content, { opacity }]}>
        <Image
          source={require('../assets/AppIcon_Gotu.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.loadingText}>{loadingText}</Text>
      </Animated.View>

      {/* Remove from dock dialog */}
      <Modal
        visible={showRemoveDockDialog}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalText}>Remove the robot from the dock</Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setShowRemoveDockDialog(false)}
            >
              <Text style={styles.modalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Return to dock dialog */}
      <Modal
        visible={showDockDialog}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalText}>Return the robot to the dock</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
  },
  logo: {
    width: 200,
    height: 200,
    marginBottom: 20,
  },
  loadingText: {
    fontSize: 18,
    color: '#333333',
    textAlign: 'center',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    width: '80%',
  },
  modalText: {
    fontSize: 18,
    color: '#333333',
    textAlign: 'center',
    marginBottom: 20,
  },
  modalButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 5,
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default SplashScreen;