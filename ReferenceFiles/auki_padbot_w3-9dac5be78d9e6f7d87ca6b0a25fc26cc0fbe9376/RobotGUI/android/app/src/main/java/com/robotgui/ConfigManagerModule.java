package com.robotgui;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import android.util.Log;

public class ConfigManagerModule extends ReactContextBaseJavaModule {
    private static final String TAG = "ConfigManagerModule";
    private final ConfigManager configManager;

    public ConfigManagerModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.configManager = ConfigManager.INSTANCE;
    }

    @Override
    public String getName() {
        return "ConfigManagerModule";
    }

    @ReactMethod
    public void getFloat(String key, float defaultValue, Promise promise) {
        try {
            String value = configManager.getNestedString(key, String.valueOf(defaultValue));
            float floatValue = Float.parseFloat(value);
            promise.resolve(floatValue);
        } catch (Exception e) {
            Log.e(TAG, "Error getting float value for key: " + key, e);
            promise.reject("CONFIG_ERROR", "Failed to get float value: " + e.getMessage());
        }
    }

    @ReactMethod
    public void getString(String key, String defaultValue, Promise promise) {
        try {
            String value = configManager.getNestedString(key, defaultValue);
            promise.resolve(value);
        } catch (Exception e) {
            Log.e(TAG, "Error getting string value for key: " + key, e);
            promise.reject("CONFIG_ERROR", "Failed to get string value: " + e.getMessage());
        }
    }

    @ReactMethod
    public void getInt(String key, int defaultValue, Promise promise) {
        try {
            int value = configManager.getInt(key, defaultValue);
            promise.resolve(value);
        } catch (Exception e) {
            Log.e(TAG, "Error getting int value for key: " + key, e);
            promise.reject("CONFIG_ERROR", "Failed to get int value: " + e.getMessage());
        }
    }

    @ReactMethod
    public void getBoolean(String key, boolean defaultValue, Promise promise) {
        try {
            String value = configManager.getNestedString(key, String.valueOf(defaultValue));
            boolean boolValue = Boolean.parseBoolean(value);
            promise.resolve(boolValue);
        } catch (Exception e) {
            Log.e(TAG, "Error getting boolean value for key: " + key, e);
            promise.reject("CONFIG_ERROR", "Failed to get boolean value: " + e.getMessage());
        }
    }

    @ReactMethod
    public void getSpeeds(Promise promise) {
        try {
            WritableMap speeds = Arguments.createMap();
            
            // Get speeds as strings from config
            String patrolSpeed = configManager.getNestedString("speeds.patrol", "0.3");
            String productSearchSpeed = configManager.getNestedString("speeds.product_search", "0.7");
            String defaultSpeed = configManager.getNestedString("speeds.default", "0.5");
            
            // Parse the strings to doubles
            try {
                speeds.putDouble("patrol", Double.parseDouble(patrolSpeed));
            } catch (NumberFormatException e) {
                Log.w(TAG, "Invalid patrol speed format: " + patrolSpeed + ", using default 0.3");
                speeds.putDouble("patrol", 0.3);
            }
            
            try {
                speeds.putDouble("productSearch", Double.parseDouble(productSearchSpeed));
            } catch (NumberFormatException e) {
                Log.w(TAG, "Invalid product search speed format: " + productSearchSpeed + ", using default 0.7");
                speeds.putDouble("productSearch", 0.7);
            }
            
            try {
                speeds.putDouble("default", Double.parseDouble(defaultSpeed));
            } catch (NumberFormatException e) {
                Log.w(TAG, "Invalid default speed format: " + defaultSpeed + ", using default 0.5");
                speeds.putDouble("default", 0.5);
            }
            
            promise.resolve(speeds);
        } catch (Exception e) {
            Log.e(TAG, "Error getting speeds from config", e);
            promise.reject("CONFIG_ERROR", "Failed to get speeds: " + e.getMessage());
        }
    }

    @ReactMethod
    public void getAutoPromotionEnabled(Promise promise) {
        try {
            // Get auto promotion enabled setting from config with default value of false
            String autoPromotionValue = configManager.getNestedString("features.auto_promotion_enabled", "false");
            boolean autoPromotionEnabled = Boolean.parseBoolean(autoPromotionValue);
            
            Log.d(TAG, "Auto promotion enabled: " + autoPromotionEnabled);
            promise.resolve(autoPromotionEnabled);
        } catch (Exception e) {
            Log.e(TAG, "Error getting auto promotion setting from config", e);
            // Default to false if there's an error
            promise.resolve(false);
        }
    }
} 