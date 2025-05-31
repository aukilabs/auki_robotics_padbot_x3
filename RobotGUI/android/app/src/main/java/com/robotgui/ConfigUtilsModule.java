package com.robotgui;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import com.facebook.react.bridge.*;

public class ConfigUtilsModule extends ReactContextBaseJavaModule {
    private static final String TAG = "ConfigUtilsModule";
    private final SharedPreferences sharedPreferences;
    private static final String PREFS_NAME = "ChargingStationPrefs";
    private static final String KEY_X = "charging_station_x";
    private static final String KEY_Y = "charging_station_y";
    
    public ConfigUtilsModule(ReactApplicationContext reactContext) {
        super(reactContext);
        sharedPreferences = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @Override
    public String getName() {
        return "ConfigUtils";
    }

    @ReactMethod
    public void getChargingStationCoordinates(Promise promise) {
        try {
            // Get charging station coordinates from SharedPreferences
            double x = Double.longBitsToDouble(sharedPreferences.getLong(KEY_X, Double.doubleToLongBits(0.0)));
            double y = Double.longBitsToDouble(sharedPreferences.getLong(KEY_Y, Double.doubleToLongBits(0.0)));
            
            WritableMap coords = Arguments.createMap();
            coords.putDouble("x", x);
            coords.putDouble("y", y);
            
            promise.resolve(coords);
        } catch (Exception e) {
            Log.e(TAG, "Error getting charging station coordinates: " + e.getMessage(), e);
            promise.reject("CONFIG_ERROR", "Failed to get charging station coordinates: " + e.getMessage());
        }
    }

    @ReactMethod
    public void saveChargingStationCoordinates(double x, double y, Promise promise) {
        try {
            // Save charging station coordinates to SharedPreferences
            SharedPreferences.Editor editor = sharedPreferences.edit();
            editor.putLong(KEY_X, Double.doubleToRawLongBits(x));
            editor.putLong(KEY_Y, Double.doubleToRawLongBits(y));
            boolean success = editor.commit();
            
            Log.d(TAG, "Saved charging station coordinates: x=" + x + ", y=" + y + ", success=" + success);
            promise.resolve(success);
        } catch (Exception e) {
            Log.e(TAG, "Error saving charging station coordinates: " + e.getMessage(), e);
            promise.reject("CONFIG_ERROR", "Failed to save charging station coordinates: " + e.getMessage());
        }
    }
} 