import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  NativeModules,
} from 'react-native';
import { LogUtils } from '../utils/logging';
import BatteryStatus from '../components/BatteryStatus';
import RobotConnectionStatus from '../components/RobotConnectionStatus';
import RobotStatus from '../components/RobotStatus';

// Access the global object in a way that works in React Native
const globalAny: any = global;

// Add navigateHome wrapper function
const navigateHome = async () => {
  try {
    // Access the homePoint from the global object
    const homePoint = globalAny.homePoint;
    if (!homePoint) {
      throw new Error('Home point not found in global object');
    }

    await LogUtils.writeDebugToFile(`Starting home navigation with global position: x=${homePoint[0]}, y=${homePoint[1]}, yaw=${homePoint[3]}`);
    
    await NativeModules.SlamtecUtils.navigateHomeWithSdk(
      homePoint[0], // x
      homePoint[1], // y
      homePoint[3]  // yaw
    );
    await LogUtils.writeDebugToFile('Home navigation completed');
  } catch (error: any) {
    await LogUtils.writeDebugToFile(`Error during home navigation: ${error.message}`);
    throw error;
  }
};

interface ConfigScreenProps {
  restartApp: () => void;
}

interface ConnectionStatus {
  isConnected: boolean;
  message: string;
}

function ConfigScreen({ restartApp }: ConfigScreenProps): React.JSX.Element {
  const [sdkConnectionStatus, setSdkConnectionStatus] = useState<ConnectionStatus>({
    isConnected: false,
    message: 'Checking SDK connection...',
  });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [domainId, setDomainId] = useState('');
  const [homedockQrId, setHomedockQrId] = useState('');
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [domainServerUrl, setDomainServerUrl] = useState('');
  const [restartEnabled, setRestartEnabled] = useState(false);
  const [xCoordinate, setXCoordinate] = useState('');
  const [yCoordinate, setYCoordinate] = useState('');

  useEffect(() => {
    const loadInitialData = async () => {
      await Promise.all([
        checkSdkConnection(),
        loadStoredCredentials()
      ]);
    };
    
    loadInitialData();

    // Set up an interval to check connection periodically
    const connectionInterval = setInterval(() => {
      checkSdkConnection();
    }, 5000);

    return () => {
      clearInterval(connectionInterval);
    };
  }, []);

  const checkSdkConnection = async () => {
    try {
      console.log('[ConfigScreen] Checking SDK connection...');
      const details = await NativeModules.SlamtecUtils.checkConnectionSdk();
      console.log('[ConfigScreen] SDK connection details:', details);
      console.log('[ConfigScreen] slamApiAvailable:', details.slamApiAvailable);
      console.log('[ConfigScreen] status:', details.status);
      
      const newStatus = {
        isConnected: details.slamApiAvailable,
        message: details.status + ' (SDK)',
      };
      console.log('[ConfigScreen] Setting new status:', newStatus);
      
      setSdkConnectionStatus(newStatus);
      console.log('[ConfigScreen] Status updated');
    } catch (error) {
      console.log('[ConfigScreen] SDK connection error:', error);
      setSdkConnectionStatus({
        isConnected: false,
        message: 'SDK Connection error',
      });
    }
  };

  const loadStoredCredentials = async () => {
    try {
      const credentials = await NativeModules.DomainUtils.getStoredCredentials();
      if (credentials.email) {
        setEmail(credentials.email);
        NativeModules.DomainUtils.saveEmail(credentials.email);
      }
      if (credentials.password) {
        setPassword('********');
        setHasStoredPassword(true);
        NativeModules.DomainUtils.savePassword(credentials.password);
      }
      if (credentials.domainId) {
        setDomainId(credentials.domainId);
        NativeModules.DomainUtils.saveDomainId(credentials.domainId);
      }
      if (credentials.homedockQrId) {
        setHomedockQrId(credentials.homedockQrId);
        NativeModules.DomainUtils.saveHomedockQrId(credentials.homedockQrId);
      }
    } catch (error) {
      console.error('Failed to load credentials:', error);
    }
  };

  const handleTestAuth = async () => {
    if (!email || !password || !domainId) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    try {
      // Get the actual stored password if using masked password
      const actualPassword = hasStoredPassword ? 
        (await NativeModules.DomainUtils.getStoredCredentials()).password : 
        password;

      const result = await NativeModules.DomainUtils.authenticate(email, actualPassword, domainId);
      console.log('Auth Response:', result);
      
      // Extract the JSON string from the response message
      const jsonStr = result.message.replace('Domain Server: ', '');
      const response = JSON.parse(jsonStr);
      
      // Store the domain server URL
      setDomainServerUrl(response.url);
      
      Alert.alert(
        'Test Results', 
        'Connection test successful!\n\n' +
        'Email: ' + email + '\n' +
        'Domain ID: ' + domainId + '\n' +
        'Domain Server URL: ' + response.url + '\n\n' +
        'Full Response:\n' + JSON.stringify(response, null, 2)
      );
    } catch (error: any) {
      console.error('Auth Error:', error);
      Alert.alert(
        'Test Failed',
        'Error: ' + (error.message || 'Unknown error') + '\n\n' +
        'Please check your credentials and try again.'
      );
    }
  };

  const handlePasswordFocus = () => {
    if (hasStoredPassword) {
      setPassword('');
      setHasStoredPassword(false);
    }
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    NativeModules.DomainUtils.saveEmail(text);
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    if (!hasStoredPassword) {
      NativeModules.DomainUtils.savePassword(text);
    }
  };

  const handleDomainIdChange = (text: string) => {
    setDomainId(text);
    NativeModules.DomainUtils.saveDomainId(text);
  };

  const handleHomedockQrIdChange = (text: string) => {
    // Convert to uppercase and filter out non-alphanumeric characters
    const formattedText = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setHomedockQrId(formattedText);
    NativeModules.DomainUtils.saveHomedockQrId(formattedText);
  };

  // Debug: Log current connection status
  console.log('[ConfigScreen] Current sdkConnectionStatus:', sdkConnectionStatus);

  return (
    <ScrollView style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>Slamtec Status (SDK)</Text>
            <View style={[
              styles.statusIndicator,
              { backgroundColor: sdkConnectionStatus.isConnected ? '#4CAF50' : '#F44336' }
            ]} />
            <Text style={styles.statusMessage}>{sdkConnectionStatus.message}</Text>
          </View>

          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>Padbot Status</Text>
            <RobotStatus />
          </View>
          
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Authentication</Text>
            
            <TextInput
              style={styles.input}
              placeholder="Email"
              value={email}
              onChangeText={handleEmailChange}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              value={password}
              onChangeText={handlePasswordChange}
              onFocus={handlePasswordFocus}
              secureTextEntry={!hasStoredPassword}
            />

            <TextInput
              style={styles.input}
              placeholder="Domain ID"
              value={domainId}
              onChangeText={handleDomainIdChange}
              autoCapitalize="none"
            />

            <TextInput
              style={styles.input}
              placeholder="Homedock QR ID"
              value={homedockQrId}
              onChangeText={handleHomedockQrIdChange}
              autoCapitalize="characters"
              keyboardType="default"
            />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
              <TouchableOpacity
                style={[styles.button, styles.testButton, { flex: 1, marginRight: 5 }]}
                onPress={async () => {
                  await handleTestAuth();
                  setRestartEnabled(true);
                }}
              >
                <Text style={styles.buttonText}>Test Connection</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { flex: 1, marginLeft: 5, backgroundColor: restartEnabled ? '#FF9800' : '#BDBDBD' }]}
                disabled={!restartEnabled}
                onPress={() => {
                  setRestartEnabled(false);
                  restartApp();
                }}
              >
                <Text style={styles.buttonText}>Restart App</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Robot Control</Text>
            <TouchableOpacity 
              style={[styles.button, styles.homeButton]}
              onPress={async () => {
                try {
                  // Log the action
                  console.log('Going home...');
                  
                  // Call the goHome function directly without showing any alerts
                  //await NativeModules.SlamtecUtils.goHome();
                  await navigateHome();
                  

                } catch (error: any) {
                  console.error('Error going home:', error);
                  Alert.alert(
                    'Go Home Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Go Home</Text>
            </TouchableOpacity>
            
            <View style={styles.coordinateContainer}>
              <Text style={styles.coordinateLabel}>X Coordinate:</Text>
              <TextInput
                style={styles.coordinateInput}
                placeholder="0.0"
                value={xCoordinate}
                onChangeText={setXCoordinate}
                keyboardType="numeric"
                returnKeyType="done"
              />
            </View>
            
            <View style={styles.coordinateContainer}>
              <Text style={styles.coordinateLabel}>Y Coordinate:</Text>
              <TextInput
                style={styles.coordinateInput}
                placeholder="0.0"
                value={yCoordinate}
                onChangeText={setYCoordinate}
                keyboardType="numeric"
                returnKeyType="done"
              />
            </View>
            
            <TouchableOpacity 
              style={[styles.button, styles.navigateButton]}
              onPress={async () => {
                try {
                  // Validate coordinates
                  const x = parseFloat(xCoordinate);
                  const y = parseFloat(yCoordinate);
                  
                  if (isNaN(x) || isNaN(y)) {
                    Alert.alert('Invalid Coordinates', 'Please enter valid numerical coordinates for X and Y.');
                    return;
                  }
                  
                  // Invert Y coordinate: negative becomes positive, positive becomes negative
                  const invertedY = -y;
                  
                  console.log(`Navigating to x=${x}, y=${invertedY} (original y=${y}), yaw=0`);
                  
                  Alert.alert('Navigation Started', `Robot is navigating to coordinates (${x}, ${invertedY})`);

                  // Call navigateWithSdk with x, inverted y, and yaw=0
                  await NativeModules.SlamtecUtils.navigateWithSdk(x, invertedY, 0);
                  
                } catch (error: any) {
                  console.error('Error navigating:', error);
                  Alert.alert(
                    'Navigation Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Navigate to Coordinates</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 50,
  },
  content: {
    padding: 20,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  statusText: {
    fontSize: 16,
    marginRight: 10,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  statusMessage: {
    flex: 1,
    fontSize: 14,
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    padding: 10,
    marginBottom: 10,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 10,
  },
  testButton: {
    backgroundColor: '#4CAF50',
  },
  promotionButton: {
    backgroundColor: '#9C27B0', // Purple color for promotion button
  },
  homeButton: {
    backgroundColor: '#FF9800', // Orange color for home button
  },
  mapButton: {
    backgroundColor: '#2196F3', // Blue color for map button
    marginTop: 10,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  nullButton: {
    backgroundColor: '#F44336', // Red color for null button
    marginTop: 10,
  },
  emptyButton: {
    backgroundColor: '#FF9800', // Orange color for empty string button
    marginTop: 10,
  },
  dangerButton: {
    backgroundColor: '#F44336', // Red color for danger button
  },
  getPoseButton: {
    backgroundColor: '#2196F3', // Blue color for get pose button
    marginTop: 10,
  },
  detailsButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginLeft: 10,
  },
  detailsButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  statusLabel: {
    fontSize: 16,
    marginRight: 10,
  },
  statusValue: {
    fontSize: 16,
  },
  coordinateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    justifyContent: 'space-between',
  },
  coordinateLabel: {
    fontSize: 16,
    marginRight: 10,
    minWidth: 100,
  },
  coordinateInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    padding: 10,
    fontSize: 16,
    flex: 1,
    textAlign: 'center',
  },
  navigateButton: {
    backgroundColor: '#2196F3',
    marginTop: 10,
  },
  statusSection: {
    marginBottom: 30,
  },
  robotStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

export default ConfigScreen; 