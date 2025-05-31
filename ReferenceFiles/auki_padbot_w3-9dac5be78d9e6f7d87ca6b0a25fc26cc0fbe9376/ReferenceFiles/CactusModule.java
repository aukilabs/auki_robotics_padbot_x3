package com.robotgui;

import android.util.Log;
import com.facebook.react.bridge.*;
import org.json.JSONObject;
import org.json.JSONArray;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.os.Handler;
import android.os.Looper;

public class CactusModule extends ReactContextBaseJavaModule {
    private static final String TAG = "CactusModule";
    private final ExecutorService executorService = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String backendUrl;
    private String identity;
    private String password;
    private String domainId;
    private boolean isInitialized = false;

    public CactusModule(ReactApplicationContext reactContext) {
        super(reactContext);
        Log.d(TAG, "CactusModule constructor called");
    }

    private synchronized void ensureInitialized() {
        if (!isInitialized) {
            try {
                Log.d(TAG, "Initializing CactusModule");
                ConfigManager configManager = ConfigManager.INSTANCE;
                if (configManager != null) {
                    this.backendUrl = configManager.getNestedString("cactus.backend_url", "");
                    this.identity = configManager.getNestedString("cactus.identity", "");
                    this.password = configManager.getNestedString("cactus.password", "");
                    this.domainId = configManager.getNestedString("cactus.domain_id", "");
                    
                    Log.d(TAG, "Config loaded - Backend URL: " + (backendUrl.isEmpty() ? "empty" : "set") + 
                              ", Identity: " + (identity.isEmpty() ? "empty" : "set") + 
                              ", Password: " + (password.isEmpty() ? "empty" : "set") +
                              ", Domain ID: " + (domainId.isEmpty() ? "empty" : "set"));
                    
                    isInitialized = true;
                } else {
                    Log.e(TAG, "ConfigManager is null during initialization");
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in CactusModule initialization: " + e.getMessage());
                e.printStackTrace();
            }
        }
    }

    @Override
    public String getName() {
        return "CactusUtils";
    }

    private JSONObject authWithPassword() {
        try {
            String url = backendUrl + "/api/collections/users/auth-with-password";
            Log.d(TAG, "Authenticating with URL: " + url);

            JSONObject data = new JSONObject()
                .put("identity", identity)
                .put("password", password);

            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);

            try (java.io.OutputStream os = connection.getOutputStream()) {
                byte[] input = data.toString().getBytes("utf-8");
                os.write(input, 0, input.length);
            }

            if (connection.getResponseCode() == HttpURLConnection.HTTP_OK) {
                StringBuilder response = new StringBuilder();
                try (BufferedReader br = new BufferedReader(
                        new InputStreamReader(connection.getInputStream(), "utf-8"))) {
                    String responseLine;
                    while ((responseLine = br.readLine()) != null) {
                        response.append(responseLine.trim());
                    }
                }
                Log.d(TAG, "Authentication successful");
                return new JSONObject(response.toString());
            } else {
                Log.e(TAG, "Auth failed with response code: " + connection.getResponseCode());
                StringBuilder errorResponse = new StringBuilder();
                try (BufferedReader br = new BufferedReader(
                        new InputStreamReader(connection.getErrorStream(), "utf-8"))) {
                    String responseLine;
                    while ((responseLine = br.readLine()) != null) {
                        errorResponse.append(responseLine.trim());
                    }
                }
                Log.e(TAG, "Auth error response: " + errorResponse.toString());
                throw new Exception("Authentication failed: " + errorResponse.toString());
            }
        } catch (Exception e) {
            Log.e(TAG, "Auth error: " + e.getMessage());
            e.printStackTrace();
            return null;
        }
    }

    private String getDomainCollectionId(String token) throws Exception {
        String url = backendUrl + "/api/collections/Domains/records?filter=(DomainID='" + domainId + "')";
        Log.d(TAG, "Getting domain collection ID from URL: " + url);

        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Authorization", "Bearer " + token);

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
            if (items.length() > 0) {
                String collectionId = items.getJSONObject(0).getString("id");
                Log.d(TAG, "Found domain collection ID: " + collectionId);
                return collectionId;
            }
            throw new Exception("No domain found for ID: " + domainId);
        }
        throw new Exception("Failed to get domain collection ID. Response code: " + connection.getResponseCode());
    }

    private JSONArray getESLData(String domainCollectionId, String token) throws Exception {
        String url = backendUrl + "/api/collections/ESLDomainData/records?filter=(domain='" + 
                    domainCollectionId + "')&perPage=100000";
        Log.d(TAG, "Getting ESL data from URL: " + url);

        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Authorization", "Bearer " + token);

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
            Log.d(TAG, "Retrieved " + items.length() + " ESL items");
            return items;
        }
        throw new Exception("Failed to get ESL data. Response code: " + connection.getResponseCode());
    }

    private JSONArray getProductNames(String token) throws Exception {
        String url = backendUrl + "/api/collections/BarcodeNames/records?perPage=100000";
        Log.d(TAG, "Getting product names from URL: " + url);

        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Authorization", "Bearer " + token);

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
            Log.d(TAG, "Retrieved " + items.length() + " product names");
            return items;
        }
        throw new Exception("Failed to get product names. Response code: " + connection.getResponseCode());
    }

    @ReactMethod
    public void getProducts(Promise promise) {
        Log.d(TAG, "getProducts called");
        ensureInitialized();
        
        if (!isInitialized) {
            promise.reject("INIT_ERROR", "CactusModule not properly initialized");
            return;
        }

        executorService.execute(() -> {
            try {
                // First authenticate
                Log.d(TAG, "Attempting authentication");
                JSONObject auth = authWithPassword();
                if (auth == null) {
                    Log.e(TAG, "Authentication failed - auth object is null");
                    mainHandler.post(() -> promise.reject("AUTH_ERROR", "Authentication failed"));
                    return;
                }
                String token = auth.getString("token");
                Log.d(TAG, "Authentication successful, got token");

                // Get domain collection ID
                String domainCollectionId = getDomainCollectionId(token);
                Log.d(TAG, "Got domain collection ID: " + domainCollectionId);

                // Get ESL data
                JSONArray eslData = getESLData(domainCollectionId, token);
                Log.d(TAG, "Got ESL data, count: " + eslData.length());

                // Get product names
                JSONArray productNames = getProductNames(token);
                Log.d(TAG, "Got product names, count: " + productNames.length());

                // Create lookup map for product names
                JSONObject barcodeToName = new JSONObject();
                for (int i = 0; i < productNames.length(); i++) {
                    JSONObject product = productNames.getJSONObject(i);
                    barcodeToName.put(product.getString("barcode"), product.getString("Name"));
                }

                // Create final products array
                WritableArray products = Arguments.createArray();
                for (int i = 0; i < eslData.length(); i++) {
                    JSONObject esl = eslData.getJSONObject(i);
                    String eslCode = esl.getString("eslCode");
                    JSONObject pose = esl.getJSONObject("pose");
                    
                    WritableMap product = Arguments.createMap();
                    product.putString("name", barcodeToName.optString(eslCode, "Unknown Product"));
                    product.putString("eslCode", eslCode);
                    
                    WritableMap poseMap = Arguments.createMap();
                    poseMap.putDouble("x", pose.getDouble("px"));
                    poseMap.putDouble("y", pose.getDouble("py"));
                    poseMap.putDouble("z", pose.getDouble("pz"));
                    product.putMap("pose", poseMap);
                    
                    products.pushMap(product);
                }

                Log.d(TAG, "Successfully matched " + products.size() + " products");
                mainHandler.post(() -> promise.resolve(products));
            } catch (Exception e) {
                Log.e(TAG, "Error in getProducts: " + e.getMessage());
                mainHandler.post(() -> promise.reject("PRODUCTS_ERROR", "Error getting products: " + e.getMessage()));
            }
        });
    }
} 