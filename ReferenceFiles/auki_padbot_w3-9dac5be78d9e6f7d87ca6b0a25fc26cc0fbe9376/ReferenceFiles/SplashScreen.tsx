import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  Easing,
  NativeModules,
} from 'react-native';
import { LogUtils } from '../utils/logging';
import DeviceStorage from '../utils/deviceStorage';

interface SplashScreenProps {
  onFinish: (products: any[]) => void;
}

const SplashScreen = ({ onFinish }: SplashScreenProps): React.JSX.Element => {
  const [opacity] = useState(new Animated.Value(1));
  const [loadingText, setLoadingText] = useState('Initializing...');

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let isMounted = true;

    const initialize = async () => {
      try {
        // Initialize logging first
        await LogUtils.initializeLogging();
        await LogUtils.writeDebugToFile('Starting app initialization...');

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
            await NativeModules.DomainUtils.downloadAndProcessMap();
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
         
        // Load items from Gotu endpoint
        if (isMounted) {
          setLoadingText('Loading items...');
          await LogUtils.writeDebugToFile('Loading Gotu items...');
        }
        
        try {
          const products = await NativeModules.GotuUtils.getItems();
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
        } catch (itemsError: any) {
          await LogUtils.writeDebugToFile(`Error loading items: ${itemsError.message}`);
          if (isMounted) {
            setLoadingText('Error loading items. Please restart the application.');
            setTimeout(() => {
              if (isMounted) {
                Animated.timing(opacity, {
                  toValue: 0,
                  duration: 500,
                  easing: Easing.out(Easing.cubic),
                  useNativeDriver: true,
                }).start(() => {
                  onFinish([]);
                });
              }
            }, 2000);
          }
        }
      } catch (error: any) {
        if (isMounted) {
          const errorMessage = error.message || 'Error during initialization';
          await LogUtils.writeDebugToFile(`Error during initialization: ${errorMessage}`);
          console.error('Error during initialization:', error);
          setLoadingText(errorMessage);
          // Still finish after error, but with empty products
          setTimeout(() => {
            if (isMounted) {
              Animated.timing(opacity, {
                toValue: 0,
                duration: 500,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }).start(() => {
                onFinish([]);
              });
            }
          }, 2000);
        }
      }
    };

    // Start initialization
    initialize();

    // Set 30 second timeout
    timeoutId = setTimeout(() => {
      if (isMounted) {
        LogUtils.writeDebugToFile('Loading timeout reached');
        setLoadingText('Loading timeout reached');
        Animated.timing(opacity, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          onFinish([]);
        });
      }
    }, 30000);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
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
});

export default SplashScreen; 