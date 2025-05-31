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
import java.util.Map;
import java.util.HashMap;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class CactusModule extends ReactContextBaseJavaModule {
    private static final String TAG = "CactusModule";
    private final ExecutorService executorService = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String backendUrl;
    private String identity;
    private String password;
    private String domainId;
    private boolean isInitialized = false;
    private static final String DEBUG_LOG_FILENAME = "debug_log.txt";

    public CactusModule(ReactApplicationContext reactContext) {
        super(reactContext);
        Log.d(TAG, "CactusModule constructor called");
    }

    // Utility method to write debug messages to file
    private void logToFile(String message) {
        try {
            ReactApplicationContext context = getReactApplicationContext();
            if (context != null) {
                FileUtilsModule fileUtils = new FileUtilsModule(context);
                String timestampedMessage = String.format("[CactusModule] %s", message);
                fileUtils.appendToFile(DEBUG_LOG_FILENAME, timestampedMessage, null);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to write to debug log: " + e.getMessage());
        }
    }

    // Add method to write logs to a file
    @ReactMethod
    public void writeLogToFile(String message, Promise promise) {
        executorService.execute(() -> {
            try {
                File downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                File logFile = new File(downloadsDir, "debug_log.txt");
                
                // Create timestamp
                SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US);
                String timestamp = dateFormat.format(new Date());
                
                // Format log message
                String logLine = timestamp + " [CactusModule] " + message + "\n";
                
                // Append to file
                FileWriter writer = new FileWriter(logFile, true);
                writer.append(logLine);
                writer.close();
                
                Log.d(TAG, "Wrote to log file: " + message);
                mainHandler.post(() -> promise.resolve(true));
            } catch (IOException e) {
                Log.e(TAG, "Error writing to log file: " + e.getMessage());
                mainHandler.post(() -> promise.reject("LOG_ERROR", "Failed to write to log file: " + e.getMessage()));
            }
        });
    }

    private synchronized void ensureInitialized() {
        if (!isInitialized) {
            try {
                Log.d(TAG, "Initializing CactusModule");
                logToFile("Initializing CactusModule");
                ConfigManager configManager = ConfigManager.INSTANCE;
                if (configManager != null) {
                    this.backendUrl = configManager.getNestedString("cactus.backend_url", "");
                    this.identity = configManager.getNestedString("cactus.identity", "");
                    this.password = configManager.getNestedString("cactus.password", "");
                    this.domainId = configManager.getNestedString("cactus.domain_id", "");
                    
                    String configStatus = "Config loaded - Backend URL: " + (backendUrl.isEmpty() ? "empty" : "set") + 
                              ", Identity: " + (identity.isEmpty() ? "empty" : "set") + 
                              ", Password: " + (password.isEmpty() ? "empty" : "set") +
                              ", Domain ID: " + (domainId.isEmpty() ? "empty" : "set");
                    Log.d(TAG, configStatus);
                    logToFile(configStatus);
                    
                    isInitialized = true;
                } else {
                    Log.e(TAG, "ConfigManager is null during initialization");
                    logToFile("ERROR: ConfigManager is null during initialization");
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in CactusModule initialization: " + e.getMessage());
                logToFile("ERROR in initialization: " + e.getMessage());
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
            logToFile("Authenticating with URL: " + url);

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
                logToFile("Authentication successful");
                return new JSONObject(response.toString());
            } else {
                Log.e(TAG, "Auth failed with response code: " + connection.getResponseCode());
                logToFile("ERROR: Auth failed with response code: " + connection.getResponseCode());
                StringBuilder errorResponse = new StringBuilder();
                try (BufferedReader br = new BufferedReader(
                        new InputStreamReader(connection.getErrorStream(), "utf-8"))) {
                    String responseLine;
                    while ((responseLine = br.readLine()) != null) {
                        errorResponse.append(responseLine.trim());
                    }
                }
                Log.e(TAG, "Auth error response: " + errorResponse.toString());
                logToFile("Auth error response: " + errorResponse.toString());
                throw new Exception("Authentication failed: " + errorResponse.toString());
            }
        } catch (Exception e) {
            Log.e(TAG, "Auth error: " + e.getMessage());
            logToFile("ERROR in authentication: " + e.getMessage());
            e.printStackTrace();
            return null;
        }
    }

    private String getDomainCollectionId(String token) throws Exception {
        String url = backendUrl + "/api/collections/Domains/records?filter=(DomainID='" + domainId + "')";
        Log.d(TAG, "Getting domain collection ID from URL: " + url);
        logToFile("Getting domain collection ID from URL: " + url);

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
                logToFile("Found domain collection ID: " + collectionId);
                return collectionId;
            }
            String errorMsg = "No domain found for ID: " + domainId;
            logToFile("ERROR: " + errorMsg);
            throw new Exception(errorMsg);
        }
        String errorMsg = "Failed to get domain collection ID. Response code: " + connection.getResponseCode();
        logToFile("ERROR: " + errorMsg);
        throw new Exception(errorMsg);
    }

    private JSONArray getESLData(String domainCollectionId, String token) throws Exception {
        String url = backendUrl + "/api/collections/ESLDomainData/records?filter=(domain='" + 
                    domainCollectionId + "')&perPage=100000";
        Log.d(TAG, "Getting ESL data from URL: " + url);
        logToFile("Getting ESL data from URL: " + url);

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
            logToFile("Retrieved " + items.length() + " ESL items");
            return items;
        }
        String errorMsg = "Failed to get ESL data. Response code: " + connection.getResponseCode();
        logToFile("ERROR: " + errorMsg);
        throw new Exception(errorMsg);
    }

    private JSONObject getDomainBarcodeNames(String domainCollectionId, String token) throws Exception {
        // First find the record ID for the domain
        String lookupUrl = backendUrl + "/api/collections/DomainBarcodeNames/records?filter=(domain='" + 
                     domainCollectionId + "')";
        Log.d(TAG, "Looking up DomainBarcodeNames record ID from URL: " + lookupUrl);
        logToFile("Looking up DomainBarcodeNames record ID from URL: " + lookupUrl);

        HttpURLConnection lookupConnection = (HttpURLConnection) new URL(lookupUrl).openConnection();
        lookupConnection.setRequestMethod("GET");
        lookupConnection.setRequestProperty("Authorization", "Bearer " + token);

        if (lookupConnection.getResponseCode() == HttpURLConnection.HTTP_OK) {
            StringBuilder response = new StringBuilder();
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(lookupConnection.getInputStream(), "utf-8"))) {
                String responseLine;
                while ((responseLine = br.readLine()) != null) {
                    response.append(responseLine.trim());
                }
            }
            JSONObject jsonResponse = new JSONObject(response.toString());
            JSONArray items = jsonResponse.getJSONArray("items");
            if (items.length() > 0) {
                String recordId = items.getJSONObject(0).getString("id");
                logToFile("Found DomainBarcodeNames record ID: " + recordId);
                
                // Now get the specific record using the correct endpoint format
                String url = backendUrl + "/api/collections/DomainBarcodeNames/records/" + recordId;
                Log.d(TAG, "Getting domain barcode names from URL: " + url);
                logToFile("Getting domain barcode names from URL: " + url);
                
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("GET");
                connection.setRequestProperty("Authorization", "Bearer " + token);
                
                if (connection.getResponseCode() == HttpURLConnection.HTTP_OK) {
                    StringBuilder recordResponse = new StringBuilder();
                    try (BufferedReader br = new BufferedReader(
                            new InputStreamReader(connection.getInputStream(), "utf-8"))) {
                        String recordLine;
                        while ((recordLine = br.readLine()) != null) {
                            recordResponse.append(recordLine.trim());
                        }
                    }
                    JSONObject record = new JSONObject(recordResponse.toString());
                    Log.d(TAG, "Successfully retrieved DomainBarcodeNames record");
                    logToFile("Successfully retrieved DomainBarcodeNames record");
                    return record;
                }
                String errorMsg = "Failed to get DomainBarcodeNames record. Response code: " + connection.getResponseCode();
                logToFile("ERROR: " + errorMsg);
                throw new Exception(errorMsg);
            }
            String errorMsg = "No DomainBarcodeNames found for domain: " + domainCollectionId;
            logToFile("ERROR: " + errorMsg);
            throw new Exception(errorMsg);
        }
        String errorMsg = "Failed to lookup DomainBarcodeNames. Response code: " + lookupConnection.getResponseCode();
        logToFile("ERROR: " + errorMsg);
        throw new Exception(errorMsg);
    }

    private Map<String, String> downloadAndParseCsv(String recordId, String collectionId, String filename, String token) throws Exception {
        String url = backendUrl + "/api/files/" + collectionId + "/" + recordId + "/" + filename;
        Log.d(TAG, "Downloading CSV from URL: " + url);
        logToFile("Downloading CSV from URL: " + url);

        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setConnectTimeout(30000); // 30 second timeout
        connection.setReadTimeout(30000);

        int responseCode = connection.getResponseCode();
        Log.d(TAG, "CSV HTTP response code: " + responseCode);
        logToFile("CSV HTTP response code: " + responseCode);

        if (responseCode == HttpURLConnection.HTTP_OK) {
            Map<String, String> lookupMap = new HashMap<>();
            StringBuilder csvPreview = new StringBuilder("CSV preview (first 5 lines):\n");
            int lineCount = 0;
            
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), "utf-8"))) {
                String line;
                // Skip header line
                boolean headerSkipped = false;
                
                while ((line = br.readLine()) != null) {
                    // Log the first few lines to see the structure
                    if (lineCount < 5) {
                        csvPreview.append(line).append("\n");
                        lineCount++;
                    }
                    
                    if (!headerSkipped) {
                        Log.d(TAG, "CSV header: " + line);
                        logToFile("CSV header: " + line);
                        headerSkipped = true;
                        continue;
                    }
                    
                    String[] values = line.split(",");
                    if (values.length < 7) {
                        logToFile("WARNING: CSV line has fewer than 7 columns: " + line);
                    }
                    
                    // Column 1 (index 0) is ESL Code
                    String eslCode = values[0].trim();
                    
                    // Column 4 (index 3) is Product Name, but check bounds first
                    String productName = values.length > 3 ? values[3].trim() : "";
                    
                    // Column 7 (index 6) is Barcode, but check bounds first
                    String barcode = "";
                    if (values.length > 6) {
                        barcode = values[6].trim();
                        // Remove .0 suffix from barcode if present
                        if (barcode.endsWith(".0")) {
                            barcode = barcode.substring(0, barcode.length() - 2);
                        }
                    }
                    
                    // Debug the first few mappings
                    if (lookupMap.size() < 3) {
                        Log.d(TAG, "Mapping example - ESL Code: '" + eslCode + "', Product Name: '" + productName + "', Barcode: '" + barcode + "'");
                        logToFile("Mapping example - ESL Code: '" + eslCode + "', Product Name: '" + productName + "', Barcode: '" + barcode + "'");
                    }
                    
                    if (!eslCode.isEmpty() && !productName.isEmpty()) {
                        // Map ESL code to product name
                        lookupMap.put(eslCode, productName);
                        
                        // Map barcode to product name if available
                        if (!barcode.isEmpty()) {
                            lookupMap.put(barcode, productName);
                        }
                    }
                }
            }
            
            Log.d(TAG, csvPreview.toString());
            logToFile(csvPreview.toString());
            
            Log.d(TAG, "Parsed CSV with " + lookupMap.size() + " entries");
            logToFile("Parsed CSV with " + lookupMap.size() + " entries");
            
            // Log some sample keys
            StringBuilder keys = new StringBuilder("Sample keys in lookup map: ");
            int count = 0;
            for (String key : lookupMap.keySet()) {
                if (count < 5) {
                    keys.append("'").append(key).append("', ");
                    count++;
                } else {
                    break;
                }
            }
            Log.d(TAG, keys.toString());
            logToFile(keys.toString());
            
            return lookupMap;
        }
        
        // Log error details
        String errorMsg = "Failed to download CSV. Response code: " + responseCode;
        if (responseCode != HttpURLConnection.HTTP_OK) {
            StringBuilder errorResponse = new StringBuilder();
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(connection.getErrorStream(), "utf-8"))) {
                String responseLine;
                while ((responseLine = br.readLine()) != null) {
                    errorResponse.append(responseLine.trim());
                }
            } catch (Exception e) {
                Log.e(TAG, "Error reading error stream: " + e.getMessage());
                logToFile("Error reading error stream: " + e.getMessage());
            }
            Log.e(TAG, "Error response: " + errorResponse.toString());
            logToFile("Error response: " + errorResponse.toString());
        }
        
        throw new Exception(errorMsg);
    }

    @ReactMethod
    public void getProducts(Promise promise) {
        Log.d(TAG, "getProducts called");
        logToFile("getProducts called");
        ensureInitialized();
        
        if (!isInitialized) {
            Log.e(TAG, "CactusModule not properly initialized");
            logToFile("ERROR: CactusModule not properly initialized");
            promise.reject("INIT_ERROR", "CactusModule not properly initialized");
            return;
        }

        executorService.execute(() -> {
            try {
                // First authenticate
                Log.d(TAG, "Attempting authentication");
                logToFile("Attempting authentication");
                JSONObject auth = authWithPassword();
                if (auth == null) {
                    Log.e(TAG, "Authentication failed - auth object is null");
                    logToFile("ERROR: Authentication failed - auth object is null");
                    mainHandler.post(() -> promise.reject("AUTH_ERROR", "Authentication failed"));
                    return;
                }
                String token = auth.getString("token");
                Log.d(TAG, "Authentication successful, got token");
                logToFile("Authentication successful, got token");

                // Get domain collection ID
                String domainCollectionId = getDomainCollectionId(token);
                Log.d(TAG, "Got domain collection ID: " + domainCollectionId);
                logToFile("Got domain collection ID: " + domainCollectionId);

                // Get ESL data
                JSONArray eslData = getESLData(domainCollectionId, token);
                Log.d(TAG, "Got ESL data, count: " + eslData.length());
                logToFile("Got ESL data, count: " + eslData.length());

                // Get CSV info from DomainBarcodeNames
                Map<String, String> barcodeToName;
                try {
                    // Get CSV info for domain
                    logToFile("Getting CSV info from DomainBarcodeNames");
                    JSONObject domainBarcodeNames = getDomainBarcodeNames(domainCollectionId, token);
                    String recordId = domainBarcodeNames.getString("id");
                    String collectionId = domainBarcodeNames.getString("collectionId");
                    String filename = domainBarcodeNames.getString("csv");
                    
                    Log.d(TAG, "Got CSV info - recordId: " + recordId + 
                            ", collectionId: " + collectionId + 
                            ", filename: " + filename);
                    logToFile("Got CSV info - recordId: " + recordId + 
                            ", collectionId: " + collectionId + 
                            ", filename: " + filename);
                    
                    // Download and parse CSV
                    logToFile("Downloading and parsing CSV file");
                    barcodeToName = downloadAndParseCsv(recordId, collectionId, filename, token);
                    Log.d(TAG, "Successfully parsed barcode CSV from DomainBarcodeNames");
                    logToFile("Successfully parsed barcode CSV from DomainBarcodeNames");
                } catch (Exception e) {
                    Log.e(TAG, "Error getting product data from CSV: " + e.getMessage(), e);
                    logToFile("ERROR getting product data from CSV: " + e.getMessage());
                    // NO FALLBACK - Reject with error instead
                    mainHandler.post(() -> promise.reject("CSV_ERROR", "Error getting product data from CSV: " + e.getMessage()));
                    return;
                }

                // Create final products array
                logToFile("Creating final products array from ESL data and barcode names");
                WritableArray products = Arguments.createArray();
                int matchedProducts = 0;
                int missingProducts = 0;
                
                for (int i = 0; i < eslData.length(); i++) {
                    JSONObject esl = eslData.getJSONObject(i);
                    String eslCode = esl.getString("eslCode");
                    JSONObject pose = esl.getJSONObject("pose");
                    
                    WritableMap product = Arguments.createMap();
                    
                    // First try the ESL code directly
                    String productName = barcodeToName.get(eslCode);
                    
                    // If not found and eslCode might be a barcode with .0 suffix, try removing it
                    if (productName == null && eslCode.endsWith(".0")) {
                        String cleanBarcode = eslCode.substring(0, eslCode.length() - 2);
                        productName = barcodeToName.get(cleanBarcode);
                        logToFile("Trying cleaned barcode: " + eslCode + " -> " + cleanBarcode);
                    }
                    
                    // If still not found, this is a missing product
                    if (productName == null) {
                        productName = "Unknown Product";
                        missingProducts++;
                        
                        // Log the first few missing products for debugging
                        if (missingProducts <= 5) {
                            logToFile("Missing product name for ESL code: " + eslCode);
                        } else if (missingProducts == 6) {
                            logToFile("(additional missing products not logged)");
                        }
                    } else {
                        matchedProducts++;
                    }
                    
                    product.putString("name", productName);
                    product.putString("eslCode", eslCode);
                    
                    WritableMap poseMap = Arguments.createMap();
                    poseMap.putDouble("x", pose.getDouble("px"));
                    poseMap.putDouble("y", pose.getDouble("py"));
                    poseMap.putDouble("z", pose.getDouble("pz"));
                    product.putMap("pose", poseMap);
                    
                    products.pushMap(product);
                }

                Log.d(TAG, "Successfully matched " + matchedProducts + " products, " + missingProducts + " missing");
                logToFile("Successfully matched " + matchedProducts + " products, " + missingProducts + " missing");
                mainHandler.post(() -> promise.resolve(products));
            } catch (Exception e) {
                Log.e(TAG, "Error in getProducts: " + e.getMessage(), e);
                logToFile("ERROR in getProducts: " + e.getMessage());
                mainHandler.post(() -> promise.reject("PRODUCTS_ERROR", "Error getting products: " + e.getMessage()));
            }
        });
    }
} 