package com.robotgui;

import android.util.Log;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import org.greenrobot.eventbus.Subscribe;
import org.greenrobot.eventbus.ThreadMode;

import cn.inbot.basiclib.RobotBasicClient;
import cn.inbot.basiclib.domain.ReceiveDataVo;
import cn.inbot.basiclib.event.OnRobotBasicClientConnectedEvent;
import cn.inbot.basiclib.event.OnRobotBasicClientDisconnectedEvent;
import cn.inbot.basiclib.event.ReceiveBatteryInfoEvent;
import cn.inbot.basiclib.event.ReceiveAutoChargingStatusEvent;
import cn.inbot.basiclib.util.EventBusUtils;
import cn.inbot.basiclib.constant.AutoChargeStatus;
import com.robotgui.PadbotUtils;

import java.util.HashMap;
import java.util.Map;

public class PadbotModule extends ReactContextBaseJavaModule {
    private static final String TAG = "PadbotModule";
    private static final String FLAG = "GoTu";
    
    private final ReactApplicationContext reactContext;
    private RobotBasicClient robotBasicClient;
    private boolean isInitialized = false;
    private int lastBatteryPercentage = -1;
    private boolean lastChargingState = false;
    private boolean isCharging = false;

    public PadbotModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "PadbotModule";
    }

    @Override
    public Map<String, Object> getConstants() {
        final Map<String, Object> constants = new HashMap<>();
        constants.put("DEFAULT_BATTERY_LEVEL", -1);
        return constants;
    }

    @ReactMethod
    public void initialize(Promise promise) {
        try {
            Log.d(TAG, "Initializing PadbotModule...");
            
            // Only register once
            if (!isInitialized) {
                // Register with EventBus
                EventBusUtils.register(this);
                
                // Connect to RobotBasicClient
                RobotBasicClient.getInstance().connect(reactContext.getApplicationContext(), FLAG);
                
                isInitialized = true;
                Log.d(TAG, "PadbotModule initialized successfully");
                
                // We can't check initial charging status programmatically
                // We'll have to rely on events
                Log.d(TAG, "Initial charging status will be determined by events");
            } else {
                Log.d(TAG, "PadbotModule already initialized");
            }
            
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Error initializing PadbotModule: " + e.getMessage(), e);
            promise.reject("PADBOT_INIT_ERROR", "Error initializing PadbotModule: " + e.getMessage());
        }
    }

    @ReactMethod
    public void getBatteryStatus(Promise promise) {
        try {
            if (!isInitialized) {
                Log.w(TAG, "PadbotModule not initialized, initializing now...");
                try {
                    // Initialize directly
                    EventBusUtils.register(this);
                    RobotBasicClient.getInstance().connect(reactContext.getApplicationContext(), FLAG);
                    isInitialized = true;
                    Log.d(TAG, "PadbotModule initialized successfully");
                } catch (Exception e) {
                    Log.e(TAG, "Error initializing in getBatteryStatus: " + e.getMessage(), e);
                }
            }
            
            // Return current battery info (even if initialization just failed)
            sendCachedBatteryInfo(promise);
        } catch (Exception e) {
            Log.e(TAG, "Error getting battery status: " + e.getMessage(), e);
            promise.reject("PADBOT_BATTERY_ERROR", "Error getting battery status: " + e.getMessage());
        }
    }
    
    private void sendCachedBatteryInfo(Promise promise) {
        WritableMap batteryInfo = Arguments.createMap();
        batteryInfo.putInt("percentage", lastBatteryPercentage);
        batteryInfo.putBoolean("charging", lastChargingState);
        batteryInfo.putBoolean("isInitialValue", lastBatteryPercentage == -1);
        
        promise.resolve(batteryInfo);
    }

    @ReactMethod
    public void cleanup() {
        try {
            if (isInitialized) {
                Log.d(TAG, "Cleaning up PadbotModule...");
                EventBusUtils.unregister(this);
                // Don't disconnect RobotBasicClient as other components might be using it
                isInitialized = false;
                Log.d(TAG, "PadbotModule cleaned up successfully");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error during PadbotModule cleanup: " + e.getMessage(), e);
        }
    }

    /**
     * Battery information event handler
     */
    @Subscribe(threadMode = ThreadMode.MAIN)
    public void onEvent(ReceiveBatteryInfoEvent event) {
        try {
            Log.d(TAG, "Received battery event: " + event.getPercentage() + "%");
            
            // Extract battery information
            int powerPercentage = event.getPercentage();
            // The Padbot API may or may not have isCharging() method, adjust as needed
            boolean isCharging = false; // Default to false if method doesn't exist
            // If the isCharging method exists, uncomment the line below:
            // isCharging = event.isCharging(); 
            
            // Cache the values
            lastBatteryPercentage = powerPercentage;
            lastChargingState = isCharging;
            
            // Create event data to send to React Native
            WritableMap params = Arguments.createMap();
            params.putInt("percentage", powerPercentage);
            params.putBoolean("charging", isCharging);
            
            // Emit event to React Native
            sendEvent("batteryUpdate", params);
        } catch (Exception e) {
            Log.e(TAG, "Error processing battery event: " + e.getMessage(), e);
        }
    }
    
    /**
     * Connection event handler
     */
    @Subscribe(threadMode = ThreadMode.MAIN)
    public void onEvent(OnRobotBasicClientConnectedEvent event) {
        Log.d(TAG, "Robot client connected");
        
        try {
            robotBasicClient = RobotBasicClient.getInstance();
            
            // Notify React Native
            WritableMap params = Arguments.createMap();
            params.putBoolean("connected", true);
            sendEvent("robotConnectionUpdate", params);
        } catch (Exception e) {
            Log.e(TAG, "Error handling connection event: " + e.getMessage(), e);
        }
    }
    
    /**
     * Disconnection event handler
     */
    @Subscribe(threadMode = ThreadMode.MAIN)
    public void onEvent(OnRobotBasicClientDisconnectedEvent event) {
        Log.d(TAG, "Robot client disconnected");
        
        // Notify React Native
        WritableMap params = Arguments.createMap();
        params.putBoolean("connected", false);
        sendEvent("robotConnectionUpdate", params);
    }
    
    /**
     * Auto-charging status event handler
     */
    @Subscribe(threadMode = ThreadMode.MAIN)
    public void onEvent(ReceiveAutoChargingStatusEvent event) {
        try {
            Log.d(TAG, "Received charging status event: " + event.getStatus());
            
            // Update charging state based on status
            boolean isCharging = event.getStatus() == AutoChargeStatus.CHARGING;
            PadbotUtils.setCharging(isCharging);
            
            // Send simple event to React Native
            WritableMap params = Arguments.createMap();
            params.putBoolean("isCharging", isCharging);
            
            // Emit event to React Native
            sendEvent("chargingUpdate", params);
        } catch (Exception e) {
            Log.e(TAG, "Error processing charging status: " + e.getMessage(), e);
        }
    }
    
    /**
     * Send event to JavaScript
     */
    private void sendEvent(String eventName, WritableMap params) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(eventName, params);
        } catch (Exception e) {
            Log.e(TAG, "Error sending event to React Native: " + e.getMessage(), e);
        }
    }

    @ReactMethod
    public void isCharging(Promise promise) {
        // Return the cached value from events
        promise.resolve(isCharging);
    }
    
    /**
     * Start auto-charging process
     * @param promise Promise to resolve when charging starts
     */
    @ReactMethod
    public void startAutoCharging(Promise promise) {
        try {
            Log.d(TAG, "PadbotModule.startAutoCharging called");
            
            // Get an instance of RobotControlManager
            cn.inbot.basiclib.RobotControlManager controlManager = cn.inbot.basiclib.RobotControlManager.getInstance();
            if (controlManager != null) {
                Log.d(TAG, "Calling RobotControlManager.startAutoCharging()");
                
                // Call the method
                controlManager.startAutoCharging();
                Log.d(TAG, "Auto-charging started successfully");
                
                // Resolve the promise
                promise.resolve(true);
            } else {
                Log.e(TAG, "RobotControlManager is null, cannot start auto-charging");
                promise.reject("AUTO_CHARGING_ERROR", "RobotControlManager is null");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error starting auto-charging: " + e.getMessage(), e);
            promise.reject("AUTO_CHARGING_ERROR", "Failed to start auto-charging: " + e.getMessage(), e);
        }
    }
} 