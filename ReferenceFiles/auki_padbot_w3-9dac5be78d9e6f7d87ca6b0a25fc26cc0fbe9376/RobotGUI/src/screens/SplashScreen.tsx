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

        // First authenticate with stored credentials
        if (isMounted) {
          setLoadingText('Authenticating...');
          await LogUtils.writeDebugToFile('Attempting authentication...');
        }
        await NativeModules.DomainUtils.authenticate(null, null, null);
        await LogUtils.writeDebugToFile('Authentication successful');
        
        // Load products first
        if (isMounted) {
          setLoadingText('Loading products...');
          await LogUtils.writeDebugToFile('Loading products...');
        }
        const products = await NativeModules.CactusUtils.getProducts();
        const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name));
        await LogUtils.writeDebugToFile(`Loaded ${products.length} products`);
        
        // Then check POIs against config
        if (isMounted) {
          setLoadingText('Validating waypoints...');
          await LogUtils.writeDebugToFile('Validating waypoints...');
        }
        try {
          // Get config first to know what POIs we expect
          const config = await NativeModules.DomainUtils.getConfig();
          await LogUtils.writeDebugToFile(`Config waypoints: ${JSON.stringify(config.patrol_points)}`);
          
          // Get waypoints from config
          const configPatrolPoints = Array.isArray(config.patrol_points) ? config.patrol_points : [];
          
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
          
          // Check for mismatches
          const extraPOIs = validPoiNames.filter((name: string) => 
            !configPatrolPoints.find((cp: { name: string }) => cp.name === name)
          );
          const missingPoints = configPatrolPoints.filter((cp: { name: string }) => 
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
            if (isMounted) setLoadingText('Resetting waypoints...');
            
            await NativeModules.SlamtecUtils.clearAndInitializePOIs();
            await LogUtils.writeDebugToFile('POIs have been reset and reinitialized');
            
            // Verify the POIs again
            pois = await NativeModules.SlamtecUtils.getPOIs();
            await LogUtils.writeDebugToFile(`POIs after reset: ${JSON.stringify(pois)}`);
          } else {
            await LogUtils.writeDebugToFile('POI validation successful - all points match config');
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await LogUtils.writeDebugToFile(`Waypoint validation error: ${errorMessage}`);
          if (isMounted) {
            setLoadingText(`Error validating waypoints: ${errorMessage}`);
            // Keep error visible for 5 seconds
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }

        if (isMounted) {
          // Add 1 second delay before transition
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
              source={require('../assets/app_icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.welcomeText}>
            Welcome to{'\n'}Cactus Assistant
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
    backgroundColor: '#404040',
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
    color: 'rgb(0, 215, 68)',
    fontSize: 36,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 20,
  },
  loadingText: {
    color: 'rgb(0, 215, 68)',
    fontSize: 24,
    textAlign: 'center',
  },
});

export default SplashScreen; 