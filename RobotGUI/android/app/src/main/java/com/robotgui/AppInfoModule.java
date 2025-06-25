package com.robotgui;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Callback;
import com.facebook.react.module.annotations.ReactModule;

@ReactModule(name = AppInfoModule.NAME)
public class AppInfoModule extends ReactContextBaseJavaModule {
    public static final String NAME = "AppInfo";

    public AppInfoModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public String getAppVariant() {
        // This will be replaced with BuildConfig.APP_VARIANT by the build process
        return BuildConfig.APP_VARIANT;
    }

    @ReactMethod
    public void getAppVariantAsync(Callback callback) {
        callback.invoke(BuildConfig.APP_VARIANT);
    }
} 