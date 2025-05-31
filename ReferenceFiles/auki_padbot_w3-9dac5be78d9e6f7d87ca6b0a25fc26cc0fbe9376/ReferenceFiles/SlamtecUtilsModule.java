package com.robotgui;

import android.util.Log;
import com.facebook.react.bridge.*;
import org.json.JSONObject;
import org.json.JSONArray;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.os.Handler;
import android.os.Looper;
import java.util.List;
import java.util.Map;
import android.graphics.BitmapFactory;
import com.facebook.react.modules.core.DeviceEventManagerModule;

public class SlamtecUtilsModule extends ReactContextBaseJavaModule {
    private static final String TAG = "SlamtecUtilsModule";
    private final ExecutorService executorService = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ConfigManager configManager;
    private final String SLAM_IP;
    private final int SLAM_PORT;
    private final int TIMEOUT_MS;
    private final String BASE_URL;

    public SlamtecUtilsModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.configManager = ConfigManager.INSTANCE;
        this.SLAM_IP = configManager.getString("slam_ip", "127.0.0.1");
        this.SLAM_PORT = configManager.getInt("slam_port", 1448);
        this.TIMEOUT_MS = configManager.getInt("timeout_ms", 1000);
        this.BASE_URL = "http://" + SLAM_IP + ":" + SLAM_PORT;
    }

    @Override
    public String getName() {
        return "SlamtecUtils";
    }

    @ReactMethod
    public void checkConnection(Promise promise) {
        executorService.execute(() -> {
            try {
                WritableMap response = Arguments.createMap();
                String url = BASE_URL + "/api/core/system/v1/robot/health";
                
                try {
                    HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setConnectTimeout(TIMEOUT_MS);
                    connection.setReadTimeout(TIMEOUT_MS);
                    connection.setRequestMethod("GET");

                    try {
                        connection.connect();
                        int responseCode = connection.getResponseCode();
                        response.putInt("responseCode", responseCode);
                        
                        if (responseCode == HttpURLConnection.HTTP_OK) {
                            StringBuilder result = new StringBuilder();
                            try (java.io.BufferedReader reader = new java.io.BufferedReader(
                                    new java.io.InputStreamReader(connection.getInputStream()))) {
                                String line;
                                while ((line = reader.readLine()) != null) {
                                    result.append(line);
                                }
                            }
                            
                            JSONObject health = new JSONObject(result.toString());
                            response.putString("response", result.toString());
                            response.putString("status", !health.optBoolean("hasError", false) ? 
                                "Robot health check successful" : "Robot has errors");
                            response.putBoolean("slamApiAvailable", !health.optBoolean("hasError", false));
                        } else {
                            response.putString("error", "Health check failed with code: " + responseCode);
                            response.putString("status", "Robot health check failed");
                            response.putBoolean("slamApiAvailable", false);
                        }
                    } finally {
                        connection.disconnect();
                    }
                } catch (Exception e) {
                    response.putString("error", "Connection error: " + e.getMessage());
                    response.putString("status", "Cannot connect to robot");
                    response.putBoolean("slamApiAvailable", false);
                }

                response.putBoolean("deviceFound", response.getBoolean("slamApiAvailable"));
                mainHandler.post(() -> promise.resolve(response));
                
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("SLAM_ERROR", "Fatal error: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void getCurrentPose(Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + "/api/core/slam/v1/localization/pose";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(TIMEOUT_MS);
                connection.setReadTimeout(TIMEOUT_MS);
                connection.setRequestMethod("GET");

                try {
                    WritableMap response = Arguments.createMap();
                    connection.connect();
                    
                    if (connection.getResponseCode() == HttpURLConnection.HTTP_OK) {
                        StringBuilder result = new StringBuilder();
                        try (java.io.BufferedReader reader = new java.io.BufferedReader(
                                new java.io.InputStreamReader(connection.getInputStream()))) {
                            String line;
                            while ((line = reader.readLine()) != null) {
                                result.append(line);
                            }
                        }
                        
                        JSONObject pose = new JSONObject(result.toString());
                        response.putDouble("x", pose.optDouble("x", 0.0));
                        response.putDouble("y", pose.optDouble("y", 0.0));
                        response.putDouble("yaw", pose.optDouble("yaw", 0.0));
                        mainHandler.post(() -> promise.resolve(response));
                    } else {
                        final int code = connection.getResponseCode();
                        mainHandler.post(() -> promise.reject("POSE_ERROR", "Failed to get pose: " + code));
                    }
                } finally {
                    connection.disconnect();
                }
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("POSE_ERROR", "Error getting pose: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void navigate(double x, double y, double yaw, Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + "/api/core/motion/v1/actions";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                
                JSONObject actionOptions = new JSONObject()
                    .put("action_name", "slamtec.agent.actions.MoveToAction")
                    .put("options", new JSONObject()
                        .put("target", new JSONObject()
                            .put("x", x)
                            .put("y", y)
                            .put("z", 0))
                        .put("move_options", new JSONObject()
                            .put("mode", 0)
                            .put("flags", new JSONArray().put("with_yaw"))
                            .put("yaw", yaw)
                            .put("acceptable_precision", 0)
                            .put("fail_retry_count", 0)));

                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                try (java.io.OutputStream os = connection.getOutputStream()) {
                    byte[] input = actionOptions.toString().getBytes("utf-8");
                    os.write(input, 0, input.length);
                }

                if (connection.getResponseCode() >= 200 && connection.getResponseCode() <= 204) {
                    StringBuilder result = new StringBuilder();
                    try (java.io.BufferedReader reader = new java.io.BufferedReader(
                            new java.io.InputStreamReader(connection.getInputStream()))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            result.append(line);
                        }
                    }
                    JSONObject response = new JSONObject(result.toString());
                    monitorAction(response.getString("action_id"), promise);
                } else {
                    final int responseCode = connection.getResponseCode();
                    mainHandler.post(() -> promise.reject("NAVIGATION_ERROR", "Navigation failed: " + responseCode));
                }
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("NAVIGATION_ERROR", "Error during navigation: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void navigateProduct(double x, double y, double yaw, Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + "/api/core/motion/v1/actions";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                
                JSONObject actionOptions = new JSONObject()
                    .put("action_name", "slamtec.agent.actions.MoveToAction")
                    .put("options", new JSONObject()
                        .put("target", new JSONObject()
                            .put("x", x)
                            .put("y", y)
                            .put("z", 0))
                        .put("move_options", new JSONObject()
                            .put("mode", 0)
                            .put("flags", new JSONArray()
                                .put("with_yaw")
                                .put("precise"))
                            .put("yaw", yaw)
                            .put("acceptable_precision", 0.5)
                            .put("fail_retry_count", 3)));

                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                try (java.io.OutputStream os = connection.getOutputStream()) {
                    byte[] input = actionOptions.toString().getBytes("utf-8");
                    os.write(input, 0, input.length);
                }

                if (connection.getResponseCode() >= 200 && connection.getResponseCode() <= 204) {
                    StringBuilder result = new StringBuilder();
                    try (java.io.BufferedReader reader = new java.io.BufferedReader(
                            new java.io.InputStreamReader(connection.getInputStream()))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            result.append(line);
                        }
                    }
                    JSONObject response = new JSONObject(result.toString());
                    monitorAction(response.getString("action_id"), promise);
                } else {
                    final int responseCode = connection.getResponseCode();
                    mainHandler.post(() -> promise.reject("NAVIGATION_ERROR", "Navigation failed: " + responseCode));
                }
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("NAVIGATION_ERROR", "Error during navigation: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void navigateToWaypoint(ReadableMap waypoint, Promise promise) {
        ReadableMap pose = waypoint.getMap("pose");
        if (pose != null) {
            navigate(
                pose.getDouble("x"),
                pose.getDouble("y"),
                pose.getDouble("yaw"),
                promise
            );
        } else {
            promise.reject("NAVIGATION_ERROR", "Invalid waypoint format");
        }
    }

    @ReactMethod
    public void navigateToProduct(ReadableMap waypoint, Promise promise) {
        ReadableMap pose = waypoint.getMap("pose");
        if (pose != null) {
            navigateProduct(
                pose.getDouble("x"),
                pose.getDouble("y"),
                pose.getDouble("yaw"),
                promise
            );
        } else {
            promise.reject("NAVIGATION_ERROR", "Invalid waypoint format");
        }
    }

    private void createPOI(double x, double y, double yaw, String displayName, Promise promise) {
        try {
            String url = BASE_URL + "/api/core/artifact/v1/pois";
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            
            JSONObject body = new JSONObject()
                .put("id", java.util.UUID.randomUUID().toString())
                .put("pose", new JSONObject()
                    .put("x", x)
                    .put("y", y)
                    .put("yaw", yaw))
                .put("metadata", new JSONObject()
                    .put("display_name", displayName)
                    .put("type", "")
                    .put("group", ""));

            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            
            try (java.io.OutputStream os = connection.getOutputStream()) {
                byte[] input = body.toString().getBytes("utf-8");
                os.write(input, 0, input.length);
            }

            if (connection.getResponseCode() >= 200 && connection.getResponseCode() <= 204) {
                Log.d(TAG, "Successfully created POI: " + displayName);
            } else {
                Log.e(TAG, "Failed to create POI: " + displayName + ", code: " + connection.getResponseCode());
            }
        } catch (Exception e) {
            Log.e(TAG, "Error creating POI: " + e.getMessage());
        }
    }

    private void initializeDefaultPOIs(Promise promise) {
        try {
            Log.d(TAG, "Starting POI initialization...");
            // Initialize all patrol points from config
            for (int i = 1; i <= 4; i++) {
                String pointKey = "patrol.point" + i;
                double[] poiData = configManager.getDoubleArray(pointKey);
                if (poiData != null && poiData.length >= 3) {
                    Log.d(TAG, String.format("Creating POI %d at [%.2f, %.2f, %.2f]", i, poiData[0], poiData[1], poiData[2]));
                    createPOI(
                        poiData[0],  // x
                        poiData[1],  // y
                        poiData[2],  // yaw
                        "Patrol Point " + i,
                        promise
                    );
                } else {
                    Log.d(TAG, "No valid POI data for point " + i);
                }
            }
            Log.d(TAG, "POI initialization complete");
        } catch (Exception e) {
            Log.e(TAG, "Error initializing POIs: " + e.getMessage());
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void getPOIs(Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + "/api/core/artifact/v1/pois";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("GET");
                connection.setRequestProperty("Content-Type", "application/json");

                if (connection.getResponseCode() == HttpURLConnection.HTTP_OK) {
                    StringBuilder result = new StringBuilder();
                    try (java.io.BufferedReader reader = new java.io.BufferedReader(
                            new java.io.InputStreamReader(connection.getInputStream()))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            result.append(line);
                        }
                    }
                    
                    String response = result.toString();
                    Log.d(TAG, "Raw POIs response: " + response);
                    
                    mainHandler.post(() -> {
                        try {
                            JSONArray jsonArray = new JSONArray(response);
                            Log.d(TAG, "Successfully parsed as JSONArray with " + jsonArray.length() + " items");
                            
                            WritableArray poisArray = Arguments.createArray();
                            if (jsonArray.length() == 0) {
                                Log.d(TAG, "No POIs found, initializing default POIs");
                                
                                // Initialize default POIs
                                initializeDefaultPOIs(promise);
                                
                                // Return empty array for now, next getPOIs call will return the new POIs
                                promise.resolve(poisArray);
                            } else {
                                for (int i = 0; i < jsonArray.length(); i++) {
                                    JSONObject poi = jsonArray.getJSONObject(i);
                                    poisArray.pushMap(convertJsonToWritableMap(poi));
                                    Log.d(TAG, "Added POI: " + poi.toString());
                                }
                                promise.resolve(poisArray);
                            }
                        } catch (Exception e) {
                            String errorMsg = "Failed to parse response.\nRaw response: " + response + 
                                            "\nParse error: " + e.getMessage();
                            Log.e(TAG, errorMsg);
                            promise.reject("JSON_ERROR", errorMsg);
                        }
                    });
                } else {
                    String errorMsg = "Failed to get POIs: " + connection.getResponseCode();
                    Log.e(TAG, errorMsg);
                    mainHandler.post(() -> promise.reject("POI_ERROR", errorMsg));
                }
            } catch (Exception e) {
                String errorMsg = "Error getting POIs: " + e.getMessage();
                Log.e(TAG, errorMsg);
                mainHandler.post(() -> promise.reject("POI_ERROR", errorMsg));
            }
        });
    }

    @ReactMethod
    public void goHome(Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + "/api/core/motion/v1/actions";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                
                JSONObject actionOptions = new JSONObject()
                    .put("action_name", "slamtec.agent.actions.GoHomeAction")
                    .put("gohome_options", new JSONObject()
                        .put("flags", "dock")
                        .put("back_to_landing", true)
                        .put("charging_retry_count", 3));

                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                try (java.io.OutputStream os = connection.getOutputStream()) {
                    byte[] input = actionOptions.toString().getBytes("utf-8");
                    os.write(input, 0, input.length);
                }

                if (connection.getResponseCode() == HttpURLConnection.HTTP_OK) {
                    StringBuilder result = new StringBuilder();
                    try (java.io.BufferedReader reader = new java.io.BufferedReader(
                            new java.io.InputStreamReader(connection.getInputStream()))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            result.append(line);
                        }
                    }
                    JSONObject response = new JSONObject(result.toString());
                    monitorAction(response.getString("action_id"), promise);
                } else {
                    final int responseCode = connection.getResponseCode();
                    mainHandler.post(() -> promise.reject("HOME_ERROR", "Go home command failed: " + responseCode));
                }
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("HOME_ERROR", "Error during go home: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void uploadMap(String filePath, Promise promise) {
        executorService.execute(() -> {
            try {
                File file = new File(filePath);
                Log.d(TAG, "Attempting to upload map from: " + file.getAbsolutePath());
                Log.d(TAG, "File exists: " + file.exists());
                Log.d(TAG, "File size: " + file.length() + " bytes");
                
                if (!file.exists()) {
                    mainHandler.post(() -> promise.reject("MAP_ERROR", "Map file does not exist at: " + file.getAbsolutePath()));
                    return;
                }

                String url = BASE_URL + "/api/core/slam/v1/maps/stcm";
                Log.d(TAG, "Uploading to URL: " + url);
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                
                connection.setRequestMethod("PUT");
                connection.setRequestProperty("Content-Type", "application/octet-stream");
                connection.setDoOutput(true);

                try (java.io.FileInputStream fileInputStream = new java.io.FileInputStream(file);
                     java.io.OutputStream outputStream = connection.getOutputStream()) {
                    byte[] buffer = new byte[4096];
                    int bytesRead;
                    int totalBytes = 0;
                    while ((bytesRead = fileInputStream.read(buffer)) != -1) {
                        outputStream.write(buffer, 0, bytesRead);
                        totalBytes += bytesRead;
                    }
                    Log.d(TAG, "Uploaded " + totalBytes + " bytes");
                }

                int responseCode = connection.getResponseCode();
                Log.d(TAG, "Upload response code: " + responseCode);
                
                if (responseCode >= 200 && responseCode <= 204) {
                    mainHandler.post(() -> promise.resolve(true));
                } else {
                    final int code = responseCode;
                    mainHandler.post(() -> promise.reject("MAP_ERROR", "Failed to upload map: " + code));
                }
            } catch (Exception e) {
                Log.e(TAG, "Error uploading map: " + e.getMessage(), e);
                mainHandler.post(() -> promise.reject("MAP_ERROR", "Error uploading map: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void setHomeDock(double x, double y, double z, double yaw, double pitch, double roll, Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + "/api/core/slam/v1/homepose";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                
                JSONObject body = new JSONObject()
                    .put("x", x)
                    .put("y", y)
                    .put("z", z)
                    .put("yaw", yaw)
                    .put("pitch", pitch)
                    .put("roll", roll);

                connection.setRequestMethod("PUT");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                try (java.io.OutputStream os = connection.getOutputStream()) {
                    byte[] input = body.toString().getBytes("utf-8");
                    os.write(input, 0, input.length);
                }

                if (connection.getResponseCode() >= 200 && connection.getResponseCode() <= 204) {
                    mainHandler.post(() -> promise.resolve(true));
                } else {
                    final int responseCode = connection.getResponseCode();
                    mainHandler.post(() -> promise.reject("HOMEDOCK_ERROR", "Failed to set home dock: " + responseCode));
                }
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("HOMEDOCK_ERROR", "Error setting home dock: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void clearMap(Promise promise) {
        sendDeleteRequest("/api/core/slam/v1/maps", "MAP_CLEAR_ERROR", promise);
    }

    @ReactMethod
    public void clearPOIs(Promise promise) {
        sendDeleteRequest("/api/core/artifact/v1/pois", "POI_CLEAR_ERROR", promise);
    }

    @ReactMethod
    public void clearHomeDocks(Promise promise) {
        sendDeleteRequest("/api/core/slam/v1/homedocks", "HOMEDOCK_CLEAR_ERROR", promise);
    }

    @ReactMethod
    public void setPose(double x, double y, double z, double yaw, double pitch, double roll, Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + "/api/core/slam/v1/localization/pose";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                
                JSONObject body = new JSONObject()
                    .put("x", x)
                    .put("y", y)
                    .put("z", z)
                    .put("yaw", yaw)
                    .put("pitch", pitch)
                    .put("roll", roll);

                connection.setRequestMethod("PUT");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                try (java.io.OutputStream os = connection.getOutputStream()) {
                    byte[] input = body.toString().getBytes("utf-8");
                    os.write(input, 0, input.length);
                }

                if (connection.getResponseCode() >= 200 && connection.getResponseCode() <= 204) {
                    mainHandler.post(() -> promise.resolve(true));
                } else {
                    final int responseCode = connection.getResponseCode();
                    mainHandler.post(() -> promise.reject("POSE_ERROR", "Failed to set pose: " + responseCode));
                }
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("POSE_ERROR", "Error setting pose: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void setMaxLineSpeed(String speedStr, Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + "/api/core/system/v1/parameter";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                
                JSONObject body = new JSONObject()
                    .put("param", "base.max_moving_speed")
                    .put("value", speedStr);

                connection.setRequestMethod("PUT");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                try (java.io.OutputStream os = connection.getOutputStream()) {
                    byte[] input = body.toString().getBytes("utf-8");
                    os.write(input, 0, input.length);
                }

                if (connection.getResponseCode() >= 200 && connection.getResponseCode() <= 204) {
                    mainHandler.post(() -> promise.resolve(true));
                } else {
                    final int responseCode = connection.getResponseCode();
                    mainHandler.post(() -> promise.reject("SPEED_ERROR", "Failed to set max speed: " + responseCode));
                }
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("SPEED_ERROR", "Error setting max speed: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void processAndUploadMap(ReadableMap settings, Promise promise) {
        executorService.execute(() -> {
            try {
                // Extract settings
                double homeDockX = settings.getDouble("homeDockX");
                double homeDockY = settings.getDouble("homeDockY");
                double homeDockYaw = settings.getDouble("homeDockYaw");
                
                // Check if home dock coordinates are valid (non-zero)
                boolean validHomeDock = (Math.abs(homeDockX) > 0.001 || Math.abs(homeDockY) > 0.001);
                
                // If home dock coordinates are not valid, try to use the homedock from config.yaml
                if (!validHomeDock) {
                    Log.d(TAG, "Home dock coordinates not valid, trying to use homedock from config");
                    
                    // Try to get homedock from config
                    double[] homedock = configManager.getDoubleArray("homedock");
                    
                    if (homedock != null && homedock.length >= 6) {
                        homeDockX = homedock[0];
                        homeDockY = homedock[1];
                        homeDockYaw = homedock[3]; // yaw is at index 3
                        Log.d(TAG, String.format("Using homedock from config: [%.4f, %.4f, %.4f, %.4f, %.4f, %.4f]", 
                            homedock[0], homedock[1], homedock[2], homedock[3], homedock[4], homedock[5]));
                        validHomeDock = true;
                    } else {
                        // Use default coordinates instead of patrol points
                        Log.d(TAG, "No valid homedock in config, using default coordinates [0, 0, 0]");
                        homeDockX = 0.0;
                        homeDockY = 0.0;
                        homeDockYaw = 0.0;
                        validHomeDock = true;
                    }
                }
                
                // Store final coordinates for use in lambda
                final double finalHomeDockX = homeDockX;
                final double finalHomeDockY = homeDockY;
                final double finalHomeDockYaw = homeDockYaw;
                
                // Get the STCM map from DomainUtils
                Log.d(TAG, "Retrieving STCM map from DomainUtils...");
                
                try {
                    // Get ReactApplicationContext
                    ReactApplicationContext context = getReactApplicationContext();
                    
                    // Try to get DomainUtilsModule directly
                    if (context != null) {
                        // Check if the module is registered
                        if (context.hasNativeModule(DomainUtilsModule.class)) {
                            DomainUtilsModule domainUtils = context.getNativeModule(DomainUtilsModule.class);
                            
                            if (domainUtils != null) {
                                Log.d(TAG, "Successfully obtained DomainUtilsModule");
                                
                                // Call getStcmMap and get the result
                                domainUtils.getStcmMap(20, new Promise() {
                                    @Override
                                    public void resolve(Object value) {
                                        try {
                                            if (value instanceof ReadableMap) {
                                                ReadableMap stcmMapResult = (ReadableMap) value;
                                                String imagePath = stcmMapResult.getString("filePath");
                                                
                                                try {
                                                    // Execute operations sequentially
                                                    clearMapSync();
                                                    clearPOIsSync();
                                                    
                                                    // Upload new map
                    File stcmFile = new File(imagePath);
                    if (!stcmFile.exists()) {
                        throw new Exception("Map file not found");
                    }
                                                    Log.d(TAG, "Uploading STCM map from: " + stcmFile.getAbsolutePath());
                                                    uploadMapSync(stcmFile.getAbsolutePath());
                    
                                                    // Skip clearing home docks as it's causing 404 errors
                                                    // clearHomeDocksSync();
                    
                                                    // Set home dock directly
                                                    setHomeDockSync(finalHomeDockX, finalHomeDockY, 0, finalHomeDockYaw, 0, 0);
                    
                                                    try {
                    double[] pose = calculatePose(new double[]{
                                                            finalHomeDockX, finalHomeDockY, 0,
                                                            finalHomeDockYaw, 0, 0
                                                        });
                                                        setPoseSync(pose[0], pose[1], pose[2], pose[3], pose[4], pose[5]);
                                                    } catch (Exception e) {
                                                        // Log error but continue with the process
                                                        Log.e(TAG, "Error setting pose: " + e.getMessage() + ". Continuing with map upload.");
                                                    }
                                                    
                                                    try {
                                                        savePersistentMapSync();
                                                    } catch (Exception e) {
                                                        // Log error but continue with the process
                                                        Log.e(TAG, "Error saving persistent map: " + e.getMessage() + ". Continuing with process.");
                                                    }
                    
                    // Success - all operations completed
                        WritableMap response = Arguments.createMap();
                        response.putString("status", "success");
                        response.putString("message", "Map processed and uploaded successfully");
                                                    mainHandler.post(() -> promise.resolve(response));
                                                } catch (Exception e) {
                                                    Log.e(TAG, "Error during map processing: " + e.getMessage(), e);
                                                    mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", e.getMessage()));
                                                }
                                            } else {
                                                mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Unexpected result type from getStcmMap"));
                                            }
                                        } catch (Exception e) {
                                            Log.e(TAG, "Error processing map result: " + e.getMessage(), e);
                                            mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Error processing map result: " + e.getMessage()));
                                        }
                                    }
                                    
                                    @Override
                                    public void reject(String code, String message) {
                                        mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Error retrieving STCM map: " + message));
                                    }
                                    
                                    @Override
                                    public void reject(String code, Throwable e) {
                                        mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Error retrieving STCM map: " + e.getMessage(), e));
                                    }
                                    
                                    @Override
                                    public void reject(String code, String message, Throwable e) {
                                        mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Error retrieving STCM map: " + message, e));
                                    }
                                    
                                    @Override
                                    public void reject(Throwable e) {
                                        mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Error retrieving STCM map: " + e.getMessage(), e));
                                    }
                                    
                                    @Override
                                    public void reject(String code) {
                                        mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Error retrieving STCM map: " + code));
                                    }
                                    
                                    @Override
                                    public void reject(String code, WritableMap userInfo) {
                                        mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Error retrieving STCM map", userInfo));
                                    }
                                    
                                    @Override
                                    public void reject(String code, String message, WritableMap userInfo) {
                                        mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Error retrieving STCM map: " + message));
                                    }
                                    
                                    @Override
                                    public void reject(String code, String message, Throwable e, WritableMap userInfo) {
                                        mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Error retrieving STCM map: " + message, e));
                                    }
                                    
                                    @Override
                                    public void reject(String code, Throwable e, WritableMap userInfo) {
                                        mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Error retrieving STCM map: " + e.getMessage(), e));
                                    }
                                    
                                    @Override
                                    public void reject(Throwable e, WritableMap userInfo) {
                                        mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", "Error retrieving STCM map: " + e.getMessage(), e));
                                    }
                                });
                                return;
                            } else {
                                Log.e(TAG, "DomainUtilsModule is null even though it's registered");
                            }
                        } else {
                            Log.e(TAG, "DomainUtilsModule is not registered in ReactContext");
                        }
                    } else {
                        Log.e(TAG, "ReactApplicationContext is null");
                    }
                    
                    // If we reach here, we couldn't get DomainUtilsModule properly
                    Log.e(TAG, "Proceeding without map due to issues with DomainUtilsModule");
                    
                    // Skip map upload but still set home dock and pose
                    // Skip clearing home docks as it's causing 404 errors
                    // clearHomeDocksSync();
                    
                    // Set home dock directly
                    setHomeDockSync(finalHomeDockX, finalHomeDockY, 0, finalHomeDockYaw, 0, 0);
                    
                    try {
                        double[] pose = calculatePose(new double[]{
                            finalHomeDockX, finalHomeDockY, 0,
                            finalHomeDockYaw, 0, 0
                        });
                        setPoseSync(pose[0], pose[1], pose[2], pose[3], pose[4], pose[5]);
                    } catch (Exception e) {
                        // Log error but continue with the process
                        Log.e(TAG, "Error setting pose: " + e.getMessage() + ". Continuing with process.");
                    }
                    
                    // Success - partial operations completed
                    WritableMap response = Arguments.createMap();
                    response.putString("status", "partial");
                    response.putString("message", "Home dock set but map not uploaded (DomainUtilsModule not available)");
                    mainHandler.post(() -> promise.resolve(response));
            } catch (Exception e) {
                    Log.e(TAG, "Error accessing DomainUtilsModule: " + e.getMessage(), e);
                    
                    try {
                        // Skip map upload but still set home dock and pose
                        // Skip clearing home docks as it's causing 404 errors
                        // clearHomeDocksSync();
                        
                        // Set home dock directly
                        setHomeDockSync(finalHomeDockX, finalHomeDockY, 0, finalHomeDockYaw, 0, 0);
                        
                        try {
                            double[] pose = calculatePose(new double[]{
                                finalHomeDockX, finalHomeDockY, 0,
                                finalHomeDockYaw, 0, 0
                            });
                            setPoseSync(pose[0], pose[1], pose[2], pose[3], pose[4], pose[5]);
                        } catch (Exception ex) {
                            // Log error but continue with the process
                            Log.e(TAG, "Error setting pose: " + ex.getMessage() + ". Continuing with process.");
                        }
                        
                        // Success - partial operations completed
                        WritableMap response = Arguments.createMap();
                        response.putString("status", "partial");
                        response.putString("message", "Home dock set but map not uploaded (Error: " + e.getMessage() + ")");
                        mainHandler.post(() -> promise.resolve(response));
                    } catch (Exception ex) {
                        Log.e(TAG, "Error during fallback processing: " + ex.getMessage(), ex);
                        mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", ex.getMessage()));
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Error processing map: " + e.getMessage(), e);
                mainHandler.post(() -> promise.reject("MAP_PROCESS_ERROR", e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void savePersistentMap(Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + "/api/core/slam/v1/maps/persistent";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("PUT");

                if (connection.getResponseCode() >= 200 && connection.getResponseCode() <= 204) {
                    mainHandler.post(() -> promise.resolve(true));
                } else {
                    final int responseCode = connection.getResponseCode();
                    mainHandler.post(() -> promise.reject("MAP_ERROR", "Failed to save persistent map: " + responseCode));
                }
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("MAP_ERROR", "Error saving persistent map: " + e.getMessage()));
            }
        });
    }

    private double[] calculatePose(double[] homedock, double distanceInMeters) {
        double x = homedock[0];
        double y = homedock[1];
        double z = homedock[2];
        double yaw = homedock[3];
        double pitch = homedock[4];
        double roll = homedock[5];
        
        double dx = distanceInMeters * Math.cos(yaw);
        double dz = distanceInMeters * Math.sin(yaw);
        
        return new double[] {
            x + dx,  // new x
            y,       // y remains unchanged
            z + dz,  // new z
            yaw,     // yaw remains unchanged
            pitch,   // pitch remains unchanged
            roll     // roll remains unchanged
        };
    }

    private double[] calculatePose(double[] homedock) {
        return calculatePose(homedock, 0.2);
    }

    private void sendDeleteRequest(String endpoint, String errorCode, Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + endpoint;
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("DELETE");
                connection.setRequestProperty("Content-Type", "application/json");

                final int responseCode = connection.getResponseCode();
                if (responseCode >= 200 && responseCode <= 204) {
                    mainHandler.post(() -> promise.resolve(true));
                } else {
                    mainHandler.post(() -> promise.reject(errorCode, "Delete request failed: " + responseCode));
                }
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject(errorCode, "Error during delete: " + e.getMessage()));
            }
        });
    }

    private void monitorAction(String actionId, Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + "/api/core/motion/v1/actions/" + actionId;
                
                while (true) {
                    HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setRequestMethod("GET");
                    connection.setRequestProperty("Content-Type", "application/json");

                    if (connection.getResponseCode() == HttpURLConnection.HTTP_OK) {
                        StringBuilder result = new StringBuilder();
                        try (java.io.BufferedReader reader = new java.io.BufferedReader(
                                new java.io.InputStreamReader(connection.getInputStream()))) {
                            String line;
                            while ((line = reader.readLine()) != null) {
                                result.append(line);
                            }
                        }
                        
                        JSONObject response = new JSONObject(result.toString());
                        if (!response.has("action_name")) {
                            mainHandler.post(() -> promise.resolve(true));
                            break;
                        }
                    } else {
                        final int responseCode = connection.getResponseCode();
                        mainHandler.post(() -> promise.reject("ACTION_ERROR", "Action monitoring failed: " + responseCode));
                        break;
                    }

                    Thread.sleep(500); // Wait 500ms before next check
                }
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("ACTION_ERROR", "Error monitoring action: " + e.getMessage()));
            }
        });
    }

    private WritableMap convertJsonToWritableMap(JSONObject jsonObject) throws Exception {
        WritableMap map = Arguments.createMap();
        java.util.Iterator<String> iterator = jsonObject.keys();
        while (iterator.hasNext()) {
            String key = iterator.next();
            Object value = jsonObject.get(key);
            if (value instanceof JSONObject) {
                map.putMap(key, convertJsonToWritableMap((JSONObject) value));
            } else if (value instanceof JSONArray) {
                map.putArray(key, convertJsonToWritableArray((JSONArray) value));
            } else if (value instanceof Boolean) {
                map.putBoolean(key, (Boolean) value);
            } else if (value instanceof Integer) {
                map.putInt(key, (Integer) value);
            } else if (value instanceof Double) {
                map.putDouble(key, (Double) value);
            } else if (value instanceof String) {
                map.putString(key, (String) value);
            } else {
                map.putString(key, value.toString());
            }
        }
        return map;
    }

    private WritableArray convertJsonToWritableArray(JSONArray jsonArray) throws Exception {
        WritableArray array = Arguments.createArray();
        for (int i = 0; i < jsonArray.length(); i++) {
            Object value = jsonArray.get(i);
            if (value instanceof JSONObject) {
                array.pushMap(convertJsonToWritableMap((JSONObject) value));
            } else if (value instanceof JSONArray) {
                array.pushArray(convertJsonToWritableArray((JSONArray) value));
            } else if (value instanceof Boolean) {
                array.pushBoolean((Boolean) value);
            } else if (value instanceof Integer) {
                array.pushInt((Integer) value);
            } else if (value instanceof Double) {
                array.pushDouble((Double) value);
            } else if (value instanceof String) {
                array.pushString((String) value);
            } else {
                array.pushString(value.toString());
            }
        }
        return array;
    }

    @ReactMethod
    public void downloadYamlFile(Promise promise) {
        executorService.execute(() -> {
            try {
                String url = BASE_URL + "/api/core/slam/v1/maps/yaml";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("GET");

                if (connection.getResponseCode() == HttpURLConnection.HTTP_OK) {
                    // Create Gotu directory in home
                    File homeDir = new File(System.getProperty("user.home"));
                    File cactusDir = new File(homeDir, "Gotu");
                    if (!cactusDir.exists()) {
                        cactusDir.mkdirs();
                    }
                    
                    File yamlFile = new File(cactusDir, "map.yaml");
                    Log.d(TAG, "Saving YAML to: " + yamlFile.getAbsolutePath());
                    
                    try (java.io.BufferedReader reader = new java.io.BufferedReader(
                            new java.io.InputStreamReader(connection.getInputStream()));
                         java.io.FileWriter writer = new java.io.FileWriter(yamlFile)) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            writer.write(line + "\n");
                        }
                    }

                    WritableMap response = Arguments.createMap();
                    response.putString("yamlPath", yamlFile.getAbsolutePath());
                    mainHandler.post(() -> promise.resolve(response));
                } else {
                    final int responseCode = connection.getResponseCode();
                    mainHandler.post(() -> promise.reject("YAML_ERROR", "Failed to download YAML: " + responseCode));
                }
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("YAML_ERROR", "Error downloading YAML: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void readYamlFile(String yamlPath, Promise promise) {
        executorService.execute(() -> {
            try {
                File yamlFile = new File(yamlPath);
                if (!yamlFile.exists()) {
                    throw new Exception("YAML file does not exist");
                }

                StringBuilder content = new StringBuilder();
                try (java.io.BufferedReader reader = new java.io.BufferedReader(
                        new java.io.FileReader(yamlFile))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        content.append(line).append("\n");
                    }
                }

                WritableMap response = Arguments.createMap();
                response.putString("content", content.toString());
                mainHandler.post(() -> promise.resolve(response));
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("YAML_READ_ERROR", "Error reading YAML: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void downloadMapImage(Promise promise) {
        executorService.execute(() -> {
            try {
                // Create Gotu directory in home
                File homeDir = new File(System.getProperty("user.home"));
                File cactusDir = new File(homeDir, "Gotu");
                if (!cactusDir.exists()) {
                    cactusDir.mkdirs();
                }

                // Download BMP map
                String bmpUrl = BASE_URL + "/api/core/slam/v1/maps?format=bmp";
                Log.d(TAG, "Attempting to download map from: " + bmpUrl);
                
                HttpURLConnection bmpConnection = (HttpURLConnection) new URL(bmpUrl).openConnection();
                bmpConnection.setRequestMethod("GET");
                bmpConnection.setConnectTimeout(TIMEOUT_MS);
                bmpConnection.setReadTimeout(TIMEOUT_MS);

                int responseCode = bmpConnection.getResponseCode();
                Log.d(TAG, "Map download response code: " + responseCode);

                if (responseCode == HttpURLConnection.HTTP_OK) {
                    File bmpFile = new File(cactusDir, "map.bmp");
                    Log.d(TAG, "Saving BMP map to: " + bmpFile.getAbsolutePath());
                    
                    try (java.io.InputStream inputStream = bmpConnection.getInputStream();
                         java.io.FileOutputStream outputStream = new java.io.FileOutputStream(bmpFile)) {
                        byte[] buffer = new byte[4096];
                        int bytesRead;
                        int totalBytes = 0;
                        while ((bytesRead = inputStream.read(buffer)) != -1) {
                            outputStream.write(buffer, 0, bytesRead);
                            totalBytes += bytesRead;
                        }
                        Log.d(TAG, "Downloaded " + totalBytes + " bytes");
                    }

                    if (bmpFile.exists() && bmpFile.length() > 0) {
                        WritableMap response = Arguments.createMap();
                        response.putString("bmpPath", bmpFile.getAbsolutePath());
                        mainHandler.post(() -> promise.resolve(response));
                    } else {
                        throw new Exception("Downloaded file is empty or does not exist");
                    }
                } else {
                    // Try to read error message from response
                    StringBuilder errorMessage = new StringBuilder();
                    try (java.io.BufferedReader reader = new java.io.BufferedReader(
                            new java.io.InputStreamReader(bmpConnection.getErrorStream()))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            errorMessage.append(line);
                        }
                    } catch (Exception e) {
                        errorMessage.append("No error message available");
                    }
                    
                    String error = "Failed to download map. Response code: " + responseCode + 
                                 ", Error: " + errorMessage.toString();
                    Log.e(TAG, error);
                    mainHandler.post(() -> promise.reject("IMAGE_ERROR", error));
                }
            } catch (Exception e) {
                Log.e(TAG, "Error downloading map image: " + e.getMessage(), e);
                mainHandler.post(() -> promise.reject("IMAGE_ERROR", "Error downloading map image: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void getMapImageInfo(String imagePath, Promise promise) {
        try {
            File imageFile = new File(imagePath);
            if (!imageFile.exists()) {
                promise.reject("IMAGE_ERROR", "Image file does not exist");
                return;
            }

            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(imagePath, options);

            WritableMap result = Arguments.createMap();
            result.putInt("width", options.outWidth);
            result.putInt("height", options.outHeight);
            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("IMAGE_ERROR", "Failed to get image info: " + e.getMessage());
        }
    }

    @ReactMethod
    public void clearAndInitializePOIs(Promise promise) {
        executorService.execute(() -> {
            try {
                Log.d(TAG, "Starting POI reset process...");
                // First clear existing POIs
                String url = BASE_URL + "/api/core/artifact/v1/pois";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("DELETE");
                
                if (connection.getResponseCode() >= 200 && connection.getResponseCode() <= 204) {
                    Log.d(TAG, "Successfully cleared existing POIs");
                    // Initialize new POIs
                    initializeDefaultPOIs(promise);
                    mainHandler.post(() -> promise.resolve(true));
                } else {
                    String errorMsg = "Failed to clear POIs: " + connection.getResponseCode();
                    Log.e(TAG, errorMsg);
                    mainHandler.post(() -> promise.reject("POI_ERROR", errorMsg));
                }
            } catch (Exception e) {
                String errorMsg = "Error resetting POIs: " + e.getMessage();
                Log.e(TAG, errorMsg);
                mainHandler.post(() -> promise.reject("POI_ERROR", errorMsg));
            }
        });
    }

    @ReactMethod
    public void stopNavigation(Promise promise) {
        executorService.execute(() -> {
            try {
                Log.d(TAG, "Stopping current navigation...");
                String url = BASE_URL + "/api/core/motion/v1/actions/:current";
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("DELETE");
                
                if (connection.getResponseCode() >= 200 && connection.getResponseCode() <= 204) {
                    Log.d(TAG, "Successfully stopped navigation");
                    mainHandler.post(() -> promise.resolve(true));
                } else {
                    String errorMsg = "Failed to stop navigation: " + connection.getResponseCode();
                    Log.e(TAG, errorMsg);
                    mainHandler.post(() -> promise.reject("NAVIGATION_ERROR", errorMsg));
                }
            } catch (Exception e) {
                String errorMsg = "Error stopping navigation: " + e.getMessage();
                Log.e(TAG, errorMsg);
                mainHandler.post(() -> promise.reject("NAVIGATION_ERROR", errorMsg));
            }
        });
    }

    // Synchronous versions of the map operations to avoid multiple promise resolutions
    private void clearMapSync() throws Exception {
        String url = BASE_URL + "/api/core/slam/v1/maps";
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("DELETE");
        
        int responseCode = connection.getResponseCode();
        if (responseCode < 200 || responseCode > 204) {
            throw new Exception("Failed to clear map: " + responseCode);
        }
    }
    
    private void clearPOIsSync() throws Exception {
        String url = BASE_URL + "/api/core/slam/v1/pois";
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("DELETE");
        
        int responseCode = connection.getResponseCode();
        if (responseCode < 200 || responseCode > 204) {
            throw new Exception("Failed to clear POIs: " + responseCode);
        }
    }
    
    private void uploadMapSync(String filePath) throws Exception {
        File file = new File(filePath);
        Log.d(TAG, "Attempting to upload map from: " + file.getAbsolutePath());
        Log.d(TAG, "File exists: " + file.exists());
        Log.d(TAG, "File size: " + file.length() + " bytes");
        
        if (!file.exists()) {
            throw new Exception("Map file does not exist at: " + file.getAbsolutePath());
        }

        String url = BASE_URL + "/api/core/slam/v1/maps/stcm";
        Log.d(TAG, "Uploading to URL: " + url);
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        
        connection.setRequestMethod("PUT");
        connection.setRequestProperty("Content-Type", "application/octet-stream");
        connection.setDoOutput(true);

        try (java.io.FileInputStream fileInputStream = new java.io.FileInputStream(file);
             java.io.OutputStream outputStream = connection.getOutputStream()) {
            byte[] buffer = new byte[4096];
            int bytesRead;
            int totalBytes = 0;
            while ((bytesRead = fileInputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
                totalBytes += bytesRead;
            }
            Log.d(TAG, "Uploaded " + totalBytes + " bytes");
        }

        int responseCode = connection.getResponseCode();
        Log.d(TAG, "Upload response code: " + responseCode);
        
        if (responseCode < 200 || responseCode > 204) {
            throw new Exception("Failed to upload map: " + responseCode);
        }
    }
    
    private void clearHomeDocksSync() throws Exception {
        String url = BASE_URL + "/api/core/slam/v1/homepose";
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("DELETE");
        
        int responseCode = connection.getResponseCode();
        if (responseCode < 200 || responseCode > 204) {
            throw new Exception("Failed to clear home docks: " + responseCode);
        }
    }
    
    private void setHomeDockSync(double x, double y, double z, double yaw, double pitch, double roll) throws Exception {
        String url = BASE_URL + "/api/core/slam/v1/homepose";
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        
        JSONObject body = new JSONObject()
            .put("x", x)
            .put("y", y)
            .put("z", z)
            .put("yaw", yaw)
            .put("pitch", pitch)
            .put("roll", roll);
        
        connection.setRequestMethod("PUT");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setDoOutput(true);
        
        try (java.io.OutputStream os = connection.getOutputStream()) {
            byte[] input = body.toString().getBytes("utf-8");
            os.write(input, 0, input.length);
        }
        
        int responseCode = connection.getResponseCode();
        if (responseCode < 200 || responseCode > 204) {
            throw new Exception("Failed to set home dock: " + responseCode);
        }
    }
    
    private void setPoseSync(double x, double y, double z, double yaw, double pitch, double roll) throws Exception {
        String url = BASE_URL + "/api/core/slam/v1/localization/pose";
        Log.d(TAG, "Setting robot pose to: [" + x + ", " + y + ", " + z + ", " + yaw + ", " + pitch + ", " + roll + "]");
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        
        JSONObject body = new JSONObject()
            .put("x", x)
            .put("y", y)
            .put("z", z)
            .put("yaw", yaw)
            .put("pitch", pitch)
            .put("roll", roll);
        
        connection.setRequestMethod("PUT");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setDoOutput(true);
        
        try (java.io.OutputStream os = connection.getOutputStream()) {
            byte[] input = body.toString().getBytes("utf-8");
            os.write(input, 0, input.length);
        }
        
        int responseCode = connection.getResponseCode();
        Log.d(TAG, "Set pose response code: " + responseCode);
        
        if (responseCode < 200 || responseCode > 204) {
            throw new Exception("Failed to set pose: " + responseCode);
        }
    }
    
    private void savePersistentMapSync() throws Exception {
        String url = BASE_URL + "/api/core/slam/v1/maps/persistent";
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("PUT");
        
        int responseCode = connection.getResponseCode();
        if (responseCode < 200 || responseCode > 204) {
            throw new Exception("Failed to save persistent map: " + responseCode);
        }
    }
} 