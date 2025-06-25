package com.robotgui;

import android.os.Handler;
import android.os.Looper;
import android.os.HandlerThread;
import android.util.Log;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class BatteryMonitorModule extends ReactContextBaseJavaModule {
    private static final String MODULE_NAME = "BatteryMonitor";
    private static final String EVENT_NAME = "BatteryStatusUpdate";
    private static final String TAG = "BatteryMonitor";
    private HandlerThread batteryThread;
    private Handler batteryHandler;
    private boolean isMonitoring = false;
    private static final int CHECK_INTERVAL = 30000; // 30 seconds
    private final ReactApplicationContext reactContext;

    public BatteryMonitorModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        batteryThread = new HandlerThread("BatteryMonitorThread");
        batteryThread.start();
        batteryHandler = new Handler(batteryThread.getLooper());
    }

    @Override
    public String getName() {
        return MODULE_NAME;
    }

    private void logToFile(String message) {
        try {
            File logFile = new File(reactContext.getFilesDir(), "debug_log.txt");
            FileWriter writer = new FileWriter(logFile, true);
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US);
            String timestamp = sdf.format(new Date());
            writer.append(String.format("%s - %s\n", timestamp, message));
            writer.flush();
            writer.close();
        } catch (IOException e) {
            Log.e(TAG, "Error writing to log file: " + e.getMessage());
        }
    }

    private void sendEvent(String eventName, WritableMap params) {
        getReactApplicationContext()
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, params);
    }

    private final Runnable batteryCheckRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isMonitoring) return;

            try {
                // Get power status from SlamtecUtils
                WritableMap powerStatus = Arguments.createMap();
                // Call the native method to get power status
                // This is a placeholder - you'll need to implement the actual power status check
                double batteryPercentage = 100.0; // Replace with actual value
                String dockingStatus = "unknown"; // Replace with actual value
                boolean isCharging = false; // Replace with actual value

                powerStatus.putDouble("batteryPercentage", batteryPercentage);
                powerStatus.putString("dockingStatus", dockingStatus);
                powerStatus.putBoolean("isCharging", isCharging);

                // Log battery status
                String logMessage = String.format("Battery Check - Level: %.1f%%, Docking: %s, Charging: %s",
                    batteryPercentage, dockingStatus, isCharging);
                logToFile(logMessage);

                // Send the event to JavaScript
                sendEvent(EVENT_NAME, powerStatus);

                // Schedule next check
                batteryHandler.postDelayed(this, CHECK_INTERVAL);
            } catch (Exception e) {
                // Log error and stop monitoring
                String errorMessage = "Battery check failed: " + e.getMessage();
                logToFile(errorMessage);
                Log.e(TAG, errorMessage);
                isMonitoring = false;
            }
        }
    };

    @ReactMethod
    public void startMonitoring() {
        if (!isMonitoring) {
            isMonitoring = true;
            logToFile("Starting battery monitoring");
            batteryHandler.post(batteryCheckRunnable);
        }
    }

    @ReactMethod
    public void stopMonitoring() {
        if (isMonitoring) {
            isMonitoring = false;
            logToFile("Stopping battery monitoring");
            batteryHandler.removeCallbacks(batteryCheckRunnable);
        }
    }

    @ReactMethod
    public void getCurrentStatus(Promise promise) {
        try {
            // Get current power status
            WritableMap powerStatus = Arguments.createMap();
            // Call the native method to get power status
            // This is a placeholder - you'll need to implement the actual power status check
            double batteryPercentage = 100.0; // Replace with actual value
            String dockingStatus = "unknown"; // Replace with actual value
            boolean isCharging = false; // Replace with actual value

            powerStatus.putDouble("batteryPercentage", batteryPercentage);
            powerStatus.putString("dockingStatus", dockingStatus);
            powerStatus.putBoolean("isCharging", isCharging);

            // Log current status
            String logMessage = String.format("Current Battery Status - Level: %.1f%%, Docking: %s, Charging: %s",
                batteryPercentage, dockingStatus, isCharging);
            logToFile(logMessage);

            promise.resolve(powerStatus);
        } catch (Exception e) {
            String errorMessage = "Error getting battery status: " + e.getMessage();
            logToFile(errorMessage);
            Log.e(TAG, errorMessage);
            promise.reject("ERROR", e.getMessage());
        }
    }
} 