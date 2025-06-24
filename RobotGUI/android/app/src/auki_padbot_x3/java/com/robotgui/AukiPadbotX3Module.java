package com.robotgui;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class AukiPadbotX3Module extends ReactContextBaseJavaModule {
    private static final String TAG = "AukiPadbotX3Module";
    private final ExecutorService executorService = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String endpoint;
    private boolean isInitialized = false;
    private final ReactApplicationContext reactContext;

    public AukiPadbotX3Module(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        Log.d(TAG, "AukiPadbotX3Module constructor called");
    }

    @Override
    public String getName() {
        return "AukiPadbotX3Utils";
    }

    private synchronized void ensureInitialized() {
        if (!isInitialized) {
            try {
                Log.d(TAG, "Initializing AukiPadbotX3Module");
                ConfigManager configManager = ConfigManager.INSTANCE;
                if (configManager != null) {
                    this.endpoint = configManager.getNestedString("auki_padbot_x3.endpoint", "");
                    Log.d(TAG, "AukiPadbotX3Module initialized with endpoint: " + endpoint);
                    isInitialized = true;
                } else {
                    Log.e(TAG, "ConfigManager is null during initialization");
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in AukiPadbotX3Module initialization: " + e.getMessage());
            }
        }
    }

    @ReactMethod
    public void getItems(Promise promise) {
        Log.d(TAG, "getItems called");
        ensureInitialized();
        
        if (!isInitialized) {
            promise.reject("INIT_ERROR", "AukiPadbotX3Module not properly initialized");
            return;
        }
        
        if (endpoint.isEmpty()) {
            promise.reject("CONFIG_ERROR", "Endpoint URL is empty");
            return;
        }

        executorService.execute(() -> {
            try {
                Log.d(TAG, "Fetching items from endpoint: " + endpoint);
                
                HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setRequestMethod("GET");
                
                if (connection.getResponseCode() == HttpURLConnection.HTTP_OK) {
                    StringBuilder response = new StringBuilder();
                    try (BufferedReader br = new BufferedReader(
                            new InputStreamReader(connection.getInputStream(), "utf-8"))) {
                        String responseLine;
                        while ((responseLine = br.readLine()) != null) {
                            response.append(responseLine.trim());
                        }
                    }
                    
                    JSONObject jsonResponse = new JSONObject(response.toString());
                    JSONArray items = jsonResponse.getJSONArray("items");
                    Log.d(TAG, "Retrieved " + items.length() + " items");
                    
                    // Process items into appropriate format
                    WritableArray processedItems = Arguments.createArray();
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject item = items.getJSONObject(i);
                        
                        // Skip items with no name
                        String name = item.optString("Name", "");
                        if (name.isEmpty()) {
                            continue;
                        }
                        
                        String description = item.optString("Description", "");
                        
                        WritableMap processedItem = Arguments.createMap();
                        processedItem.putString("name", name);
                        processedItem.putString("description", description);
                        
                        // Add id and image fields
                        String id = item.optString("id", "");
                        String image = item.optString("Image", "");
                        if (!id.isEmpty()) {
                            processedItem.putString("id", id);
                        }
                        if (!image.isEmpty()) {
                            processedItem.putString("image", image);
                        }
                        
                        WritableMap poseMap = Arguments.createMap();
                        
                        // Check if Pose is null before trying to access it
                        if (!item.isNull("Pose")) {
                            JSONObject pose = item.getJSONObject("Pose");
                            poseMap.putDouble("x", pose.optDouble("px", 0));
                            poseMap.putDouble("y", pose.optDouble("py", 0));
                            poseMap.putDouble("z", pose.optDouble("pz", 0));
                        } else {
                            // Default position for items without pose
                            poseMap.putDouble("x", 0);
                            poseMap.putDouble("y", 0);
                            poseMap.putDouble("z", 0);
                            Log.d(TAG, "Item " + name + " has no pose information, using default");
                        }
                        
                        // For compatibility with existing code, use eslCode as a unique identifier
                        processedItem.putString("eslCode", "AUKI_PADBOT_X3_" + i);
                        processedItem.putMap("pose", poseMap);
                        
                        processedItems.pushMap(processedItem);
                    }
                    
                    Log.d(TAG, "Successfully processed " + processedItems.size() + " items");
                    mainHandler.post(() -> promise.resolve(processedItems));
                } else {
                    String errorMsg = "Failed to get items. Response code: " + connection.getResponseCode();
                    Log.e(TAG, errorMsg);
                    mainHandler.post(() -> promise.reject("FETCH_ERROR", errorMsg));
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in getItems: " + e.getMessage(), e);
                mainHandler.post(() -> promise.reject("ITEMS_ERROR", "Error getting items: " + e.getMessage()));
            }
        });
    }
} 