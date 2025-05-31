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
import BatteryStatus from '../../app/components/BatteryStatus';

// Access the global object in a way that works in React Native
const globalAny: any = global;

interface ConfigScreenProps {
  onClose: () => void;
}

interface ConnectionStatus {
  isConnected: boolean;
  message: string;
}

function ConfigScreen({ onClose }: ConfigScreenProps): React.JSX.Element {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    isConnected: false,
    message: 'Checking connection...',
  });

  const [sdkConnectionStatus, setSdkConnectionStatus] = useState<ConnectionStatus>({
    isConnected: false,
    message: 'Checking SDK connection...',
  });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [domainId, setDomainId] = useState('');
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [domainServerUrl, setDomainServerUrl] = useState('');
  const [chargingStationX, setChargingStationX] = useState('');
  const [chargingStationY, setChargingStationY] = useState('');

  useEffect(() => {
    const loadInitialData = async () => {
      await Promise.all([
        checkConnection(),
        checkSdkConnection(),
        loadStoredCredentials(),
        loadChargingStationCoordinates()
      ]);
    };
    
    loadInitialData();

    // Set up an interval to check connection periodically
    const connectionInterval = setInterval(() => {
      checkConnection();
      checkSdkConnection();
    }, 5000);

    return () => {
      clearInterval(connectionInterval);
    };
  }, []);

  const checkConnection = async () => {
    try {
      const details = await NativeModules.SlamtecUtils.checkConnection();
      setConnectionStatus({
        isConnected: details.slamApiAvailable,
        message: details.status,
      });
    } catch (error) {
      setConnectionStatus({
        isConnected: false,
        message: 'Connection error',
      });
    }
  };

  const checkSdkConnection = async () => {
    try {
      const details = await NativeModules.SlamtecUtils.checkConnectionSdk();
      setSdkConnectionStatus({
        isConnected: details.slamApiAvailable,
        message: details.status + ' (SDK)',
      });
    } catch (error) {
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
    } catch (error) {
      console.error('Failed to load credentials:', error);
    }
  };

  const loadChargingStationCoordinates = async () => {
    try {
      const coords = await NativeModules.ConfigUtils.getChargingStationCoordinates();
      setChargingStationX(coords.x.toString());
      setChargingStationY(coords.y.toString());
    } catch (error) {
      console.error('Failed to load charging station coordinates:', error);
      setChargingStationX('0.0');
      setChargingStationY('0.0');
    }
  };

  const saveChargingStationCoordinates = async () => {
    try {
      const x = parseFloat(chargingStationX);
      const y = parseFloat(chargingStationY);
      
      if (isNaN(x) || isNaN(y)) {
        Alert.alert('Error', 'Please enter valid coordinates (numbers only)');
        return;
      }
      
      await NativeModules.ConfigUtils.saveChargingStationCoordinates(x, y);
      Alert.alert('Success', 'Charging station coordinates saved successfully');
    } catch (error: any) {
      console.error('Error saving charging station coordinates:', error);
      Alert.alert('Error', 'Failed to save coordinates: ' + (error.message || 'Unknown error'));
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
      
      // DEBUGGING: Log the raw message before parsing
      console.log('Raw Auth Message:', result.message);
      
      // Extract the JSON string from the response message
      const jsonStr = result.message.replace('Domain Server: ', '');
      console.log('JSON string to parse:', jsonStr);
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

  const downloadMapInFormat = async (format: string, resolution: number) => {
    try {
      // First, request storage permissions
      await NativeModules.DomainUtils.requestStoragePermission();
      
      // Show loading alert
      Alert.alert(
        'Downloading Map',
        `Downloading map in ${format.toUpperCase()} format...`
      );
      
      // Call the getMapInFormat function with the selected format
      const result = await NativeModules.DomainUtils.getMapInFormat(format, resolution);
      
      // Show success message
      Alert.alert(
        'Map Downloaded',
        `Map saved to: ${result.filePath}\nFormat: ${format.toUpperCase()}\nFile size: ${(result.fileSize / 1024).toFixed(2)} KB`
      );
    } catch (error: any) {
      console.error(`Error downloading ${format} map:`, error);
      Alert.alert(
        'Map Download Failed',
        'Error: ' + (error.message || 'Unknown error')
      );
    }
  };

  const handleLoadMapWithSdk = async () => {
    try {
      // First, request storage permissions
      await NativeModules.DomainUtils.requestStoragePermission();
      
      // Show loading alert
      Alert.alert(
        'Loading Map',
        'Downloading and loading STCM map file with SDK...'
      );
      
      // First download the STCM map
      const result = await NativeModules.DomainUtils.getStcmMap(20);
      
      // Now use the SlamtecUtilsModule to load with SDK MapHelper
      const processResult = await NativeModules.SlamtecUtils.processMapWithSdk(result.filePath);
      
      // Show success message
      Alert.alert(
        'Map Loaded',
        `Map successfully loaded with SDK: ${processResult.mapPath}\nSuccess: ${processResult.success}`
      );
    } catch (error: any) {
      console.error('Error loading map with SDK:', error);
      Alert.alert(
        'Map Loading Failed',
        'Error: ' + (error.message || 'Unknown error')
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>Connection Status (REST API)</Text>
            <View style={[
              styles.statusIndicator,
              { backgroundColor: connectionStatus.isConnected ? '#4CAF50' : '#F44336' }
            ]} />
            <Text style={styles.statusMessage}>{connectionStatus.message}</Text>
          </View>

          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>Connection Status (SDK)</Text>
            <View style={[
              styles.statusIndicator,
              { backgroundColor: sdkConnectionStatus.isConnected ? '#4CAF50' : '#F44336' }
            ]} />
            <Text style={styles.statusMessage}>{sdkConnectionStatus.message}</Text>
          </View>

          {/* Add Battery Status */}
          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>Robot Status</Text>
            <BatteryStatus />
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

            <TouchableOpacity 
              style={[styles.button, styles.testButton]}
              onPress={handleTestAuth}
            >
              <Text style={styles.buttonText}>Test Connection</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Robot Control</Text>
            
            <View style={styles.chargingStationContainer}>
              <Text style={styles.subsectionTitle}>Charging Station Position</Text>
              <View style={styles.coordinateInputs}>
                <View style={styles.coordinateField}>
                  <Text style={styles.coordinateLabel}>X:</Text>
                  <TextInput
                    style={styles.coordinateInput}
                    value={chargingStationX}
                    onChangeText={setChargingStationX}
                    keyboardType="numeric"
                    placeholder="X Coordinate"
                  />
                </View>
                <View style={styles.coordinateField}>
                  <Text style={styles.coordinateLabel}>Y:</Text>
                  <TextInput
                    style={styles.coordinateInput}
                    value={chargingStationY}
                    onChangeText={setChargingStationY}
                    keyboardType="numeric"
                    placeholder="Y Coordinate"
                  />
                </View>
              </View>
              <TouchableOpacity 
                style={[styles.button, styles.saveButton]}
                onPress={saveChargingStationCoordinates}
              >
                <Text style={styles.buttonText}>Save Charging Station</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
              style={[styles.button, styles.homeButton]}
              onPress={async () => {
                try {
                  // Log the action
                  console.log('Going home with SDK navigation...');
                  
                  // Show loading alert
                  Alert.alert(
                    'Going Home',
                    'Moving to home position x=-1.5, y=-8.26, yaw=0 using SDK...'
                  );
                  
                  // Call the SDK navigation method instead of goHome
                  await NativeModules.SlamtecUtils.navigateHomeWithSdk(-1.5, -8.26, 0.0);
                  
                  // Show success message
                  Alert.alert(
                    'Navigation Complete',
                    'Successfully arrived at home position'
                  );
                } catch (error: any) {
                  console.error('Error going home:', error);
                  Alert.alert(
                    'Go Home Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Go Home (SDK)</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.button, styles.mapButton]}
              onPress={async () => {
                try {
                  // First, request storage permissions
                  await NativeModules.DomainUtils.requestStoragePermission();
                  
                  // Show loading alert
                  Alert.alert(
                    'Downloading Map',
                    'Downloading STCM map file...'
                  );
                  
                  // Call the getStcmMap function
                  const result = await NativeModules.DomainUtils.getStcmMap(20);
                  
                  // Show success message
                  Alert.alert(
                    'Map Downloaded',
                    `Map saved to: ${result.filePath}\nFile size: ${(result.fileSize / 1024).toFixed(2)} KB`
                  );
                } catch (error: any) {
                  console.error('Error downloading map:', error);
                  Alert.alert(
                    'Map Download Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Get Map</Text>
            </TouchableOpacity>
            
            <View style={styles.formatSelector}>
              <TouchableOpacity 
                style={[styles.button, styles.formatButton]}
                onPress={async () => {
                  try {
                    // First, request storage permissions
                    await NativeModules.DomainUtils.requestStoragePermission();
                    
                    // Show format selection dialog
                    Alert.alert(
                      'Select Map Format',
                      'Choose a map format to download:',
                      [
                        {
                          text: 'PNG',
                          onPress: async () => {
                            await downloadMapInFormat('png', 20);
                          }
                        },
                        {
                          text: 'PGM',
                          onPress: async () => {
                            await downloadMapInFormat('pgm', 20);
                          }
                        },
                        {
                          text: 'BMP',
                          onPress: async () => {
                            await downloadMapInFormat('bmp', 20);
                          }
                        },
                        {
                          text: 'STCM',
                          onPress: async () => {
                            await downloadMapInFormat('stcm', 20);
                          }
                        },
                        {
                          text: 'Cancel',
                          style: 'cancel'
                        }
                      ]
                    );
                  } catch (error: any) {
                    console.error('Error:', error);
                    Alert.alert('Error', error.message || 'Unknown error');
                  }
                }}
              >
                <Text style={styles.buttonText}>Get Map in Other Format</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
              style={[styles.button, styles.sdkButton]}
              onPress={handleLoadMapWithSdk}
            >
              <Text style={styles.buttonText}>Load Map with SDK</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, styles.navigationButton]}
              onPress={async () => {
                try {
                  // Show loading alert
                  Alert.alert(
                    'Navigating',
                    'Moving to position x=4, y=-9, yaw=0 using SDK...'
                  );
                  
                  // Call the SDK navigation method
                  await NativeModules.SlamtecUtils.navigateWithSdk(4.0, -9.0, 0.0);
                  
                  // Show success message
                  Alert.alert(
                    'Navigation Complete',
                    'Successfully arrived at destination'
                  );
                } catch (error: any) {
                  console.error('Error during navigation:', error);
                  Alert.alert(
                    'Navigation Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Go to Position (4, -9)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
  },
  closeButton: {
    padding: 5,
  },
  closeButtonText: {
    fontSize: 24,
    color: '#000',
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
  homeButton: {
    backgroundColor: '#FF9800', // Orange color for home button
  },
  mapButton: {
    backgroundColor: '#2196F3', // Blue color for map button
    marginTop: 10,
  },
  formatSelector: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  formatButton: {
    backgroundColor: '#2196F3',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  sdkButton: {
    backgroundColor: '#9C27B0', // Purple color for SDK button
    marginTop: 15,
  },
  navigationButton: {
    backgroundColor: '#E91E63', // Pink color for navigation button
    marginTop: 15,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  chargingStationContainer: {
    marginBottom: 20,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  coordinateInputs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  coordinateField: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
  },
  coordinateLabel: {
    fontSize: 16,
    width: 25,
  },
  coordinateInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    padding: 10,
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: '#4CAF50',
  },
});

export default ConfigScreen; 