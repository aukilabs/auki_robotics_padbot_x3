package com.robotgui;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import android.util.Log;

public class PadbotUtils extends ReactContextBaseJavaModule {
    private static final String TAG = "PadbotUtils";
    private final ReactApplicationContext reactContext;
    private static boolean isCharging = false;

    public PadbotUtils(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "PadbotUtils";
    }

    public static boolean isCharging() {
        return isCharging;
    }

    public static void setCharging(boolean charging) {
        isCharging = charging;
    }

    private void sendEvent(String eventName, Object params) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, params);
    }
} 