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
import { LogUtils } from '../utils/LogUtils';
import BatteryStatus from '../components/BatteryStatus';

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
  onClose: () => void;
  restartApp: () => void;
}

interface ConnectionStatus {
  isConnected: boolean;
  message: string;
}

function ConfigScreen({ onClose, restartApp }: ConfigScreenProps): React.JSX.Element {
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

  const showHealthCheckDetails = () => {
    // Implementation of showHealthCheckDetails function
  };

  const handleTestSeries = async () => {
    try {
      // Fetch the series_move_to array from native
      const series = await NativeModules.ConfigManagerModule.getSeriesMoveTo();
      if (!Array.isArray(series) || series.length === 0) {
        Alert.alert('Error', 'No series_move_to found in config.');
        return;
      }
      // Build targets: {x, y, z: 0} for each, yaw from last
      const targets = series.map(([x, y]) => ({ x, y, z: 0 }));
      const last = series[series.length - 1];
      const yaw = last[2] || 0;
      await NativeModules.SlamtecUtils.seriesNavigate(targets, yaw);
      Alert.alert('Success', 'Series navigation started.');
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to start series navigation.');
    }
  };

  return (
    <ScrollView style={styles.container}>
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
            <Text style={styles.statusText}>Connection Status (SDK)</Text>
            <View style={[
              styles.statusIndicator,
              { backgroundColor: sdkConnectionStatus.isConnected ? '#4CAF50' : '#F44336' }
            ]} />
            <Text style={styles.statusMessage}>{sdkConnectionStatus.message}</Text>
          </View>

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
            <Text style={styles.sectionTitle}>Gotu Authentication</Text>
            <TouchableOpacity 
              style={[styles.button, styles.testButton]}
              onPress={async () => {
                try {
                  const result = await NativeModules.CactusUtils.getProducts();
                  Alert.alert(
                    'Gotu Auth Test',
                    'Authentication successful!\n\n' +
                    'Products retrieved: ' + result.length
                  );
                } catch (error: any) {
                  Alert.alert(
                    'Gotu Auth Test Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Test Gotu Auth</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Promotion Mode</Text>
            <TouchableOpacity 
              style={[styles.button, styles.promotionButton]}
              onPress={async () => {
                try {
                  // @ts-ignore - startPromotion is added to window in MainScreen
                  if (typeof globalAny.startPromotion === 'function') {
                    // First activate the promotion globally
                    await globalAny.startPromotion();
                    
                    // Then close the config screen
                    onClose();
                  } else {
                    Alert.alert(
                      'Feature Not Available',
                      'The promotion feature is not available. Please make sure the robot is connected and try again.'
                    );
                  }
                } catch (error: any) {
                  console.error('Error starting promotion:', error);
                  Alert.alert(
                    'Promotion Start Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Start Promotion</Text>
            </TouchableOpacity>
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
                  
                  // Close the config screen after initiating go home
                  onClose();
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
            
            <TouchableOpacity 
              style={[styles.button, styles.mapButton]}
              onPress={async () => {
                try {
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
          </View>
          
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Robot Call Test</Text>
            
            <TouchableOpacity 
              style={[styles.button, styles.testButton]}
              onPress={async () => {
                try {
                  // Read current robot call data
                  const currentData = await NativeModules.DomainUtils.getRobotCall();
                  console.log('Current robot call data:', currentData);
                  
                  Alert.alert(
                    'Current Robot Call Data',
                    `Data: ${JSON.stringify(currentData, null, 2)}`
                  );
                } catch (error: any) {
                  console.error('Error reading robot call data:', error);
                  Alert.alert(
                    'Read Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Read Robot Call</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.button, styles.nullButton]}
              onPress={async () => {
                try {
                  // Write null value using PUT method
                  const result = await NativeModules.DomainUtils.writeRobotCall(JSON.stringify({ id: null }), "PUT");
                  console.log('Write null result:', result);
                  
                  Alert.alert(
                    'Write Completed',
                    `Wrote { id: null } using PUT method.\nResult: ${JSON.stringify(result, null, 2)}`
                  );
                  
                  // Read back to confirm
                  const updatedData = await NativeModules.DomainUtils.getRobotCall();
                  Alert.alert(
                    'Verification',
                    `Current data after write: ${JSON.stringify(updatedData, null, 2)}`
                  );
                } catch (error: any) {
                  console.error('Error writing robot call data:', error);
                  Alert.alert(
                    'Write Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Write NULL ID (PUT)</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.button, styles.emptyButton]}
              onPress={async () => {
                try {
                  // Write empty string value using PUT method
                  const result = await NativeModules.DomainUtils.writeRobotCall(JSON.stringify({ id: "" }), "PUT");
                  console.log('Write empty string result:', result);
                  
                  Alert.alert(
                    'Write Completed',
                    `Wrote { id: "" } using PUT method.\nResult: ${JSON.stringify(result, null, 2)}`
                  );
                  
                  // Read back to confirm
                  const updatedData = await NativeModules.DomainUtils.getRobotCall();
                  Alert.alert(
                    'Verification',
                    `Current data after write: ${JSON.stringify(updatedData, null, 2)}`
                  );
                } catch (error: any) {
                  console.error('Error writing robot call data:', error);
                  Alert.alert(
                    'Write Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Write Empty ID (PUT)</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.button, styles.testButton]}
              onPress={async () => {
                try {
                  // Write test value using PUT method
                  const result = await NativeModules.DomainUtils.writeRobotCall(JSON.stringify({ id: "test-id-123" }), "PUT");
                  console.log('Write test ID result:', result);
                  
                  Alert.alert(
                    'Write Completed',
                    `Wrote { id: "test-id-123" } using PUT method.\nResult: ${JSON.stringify(result, null, 2)}`
                  );
                  
                  // Read back to confirm
                  const updatedData = await NativeModules.DomainUtils.getRobotCall();
                  Alert.alert(
                    'Verification',
                    `Current data after write: ${JSON.stringify(updatedData, null, 2)}`
                  );
                } catch (error: any) {
                  console.error('Error writing robot call data:', error);
                  Alert.alert(
                    'Write Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Write Test ID (PUT)</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Device ID Management</Text>
            
            <TouchableOpacity 
              style={[styles.button, styles.dangerButton]}
              onPress={async () => {
                try {
                  // Confirm with the user before clearing
                  Alert.alert(
                    'Clear Device ID',
                    'This will clear the stored device ID used for robot pose data. The app will generate a new ID on next startup. Continue?',
                    [
                      {
                        text: 'Cancel',
                        style: 'cancel'
                      },
                      {
                        text: 'Clear ID',
                        style: 'destructive',
                        onPress: async () => {
                          await NativeModules.DomainUtils.clearDeviceId();
                          Alert.alert(
                            'Success',
                            'Device ID has been cleared. A new ID will be generated on next data transfer.'
                          );
                        }
                      }
                    ]
                  );
                } catch (error: any) {
                  console.error('Error clearing device ID:', error);
                  Alert.alert(
                    'Operation Failed',
                    'Error: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Clear Device ID</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Lighthouse Data</Text>
            
            <TouchableOpacity 
              style={[styles.button, styles.getPoseButton]}
              onPress={async () => {
                try {
                  // Check if QR ID is entered
                  if (!homedockQrId) {
                    Alert.alert(
                      'Missing QR ID',
                      'Please enter a Homedock QR ID first to filter lighthouse data'
                    );
                    return;
                  }
                  
                  // Show loading message
                  Alert.alert(
                    'Fetching Lighthouse Data',
                    `Retrieving lighthouse data for QR ID: ${homedockQrId}...`
                  );
                  
                  // Make the API call with the QR ID as a parameter
                  const result = await NativeModules.DomainUtils.getPoseDataByQrId(homedockQrId);
                  console.log('Lighthouse data:', result);
                  
                  // Show result from filtering
                  if (result && result.found) {
                    Alert.alert(
                      'Lighthouse Data Retrieved',
                      `Found lighthouse data for QR ID: ${homedockQrId}\n\n` +
                      `Position:\n` +
                      `px = ${result.px.toFixed(4)}\n` +
                      `py = ${result.py.toFixed(4)}\n` +
                      `pz = ${result.pz.toFixed(4)}\n\n` +
                      `Rotation:\n` +
                      `yaw = ${result.yaw.toFixed(4)}`
                    );
                  } else {
                    Alert.alert(
                      'QR ID Not Found',
                      `No lighthouse data found matching QR ID: ${homedockQrId}`
                    );
                  }
                } catch (error: any) {
                  console.error('Error getting lighthouse data:', error);
                  Alert.alert(
                    'Error',
                    'Failed to get lighthouse data: ' + (error.message || 'Unknown error')
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Get Lighthouse Data</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Test Series</Text>
            <TouchableOpacity style={styles.button} onPress={handleTestSeries}>
              <Text style={styles.buttonText}>Test Series</Text>
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
});

export default ConfigScreen; 