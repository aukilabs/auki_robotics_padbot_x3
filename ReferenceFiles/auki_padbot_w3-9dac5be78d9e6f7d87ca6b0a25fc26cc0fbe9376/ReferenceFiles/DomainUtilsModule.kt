package com.robotgui

import android.content.Context
import android.util.Log
import com.facebook.react.bridge.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import java.io.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.yaml.snakeyaml.Yaml
import android.util.Base64
import android.os.Environment
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.app.Activity
import android.content.Intent
import java.util.regex.Pattern
import com.robotgui.SlamtecUtilsModule

class DomainUtilsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val TAG = "DomainUtilsModule"
    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private val sharedPreferences = reactContext.getSharedPreferences("DomainAuth", Context.MODE_PRIVATE)
    private val STORAGE_PERMISSION_CODE = 1001
    private val baseUrl = "https://dds.posemesh.org/api/v1/domains"

    private var posemeshToken: String?
        get() = sharedPreferences.getString("posemesh_token", null)
        set(value) = sharedPreferences.edit().putString("posemesh_token", value).apply()

    private var ddsToken: String?
        get() = sharedPreferences.getString("dds_token", null)
        set(value) = sharedPreferences.edit().putString("dds_token", value).apply()

    private var domainInfo: String?
        get() = sharedPreferences.getString("domain_info", null)
        set(value) = sharedPreferences.edit().putString("domain_info", value).apply()

    override fun getName(): String = "DomainUtils"

    override fun initialize() {
        super.initialize()
    }

    @ReactMethod
    fun getDomainData(promise: Promise) {
        scope.launch {
            try {
                // Example domain data
                val response = Arguments.createMap().apply {
                    putString("domainId", "example-domain")
                    putString("name", "Example Domain")
                    putString("type", "test")
                }
                promise.resolve(response)
            } catch (e: Exception) {
                promise.reject("DOMAIN_ERROR", "Error getting domain data: ${e.message}")
            }
        }
    }

    @ReactMethod
    fun getStoredCredentials(promise: Promise) {
        val credentials = Arguments.createMap().apply {
            putString("email", sharedPreferences.getString("email", ""))
            putString("password", sharedPreferences.getString("password", ""))
            putString("domainId", sharedPreferences.getString("domain_id", ""))
        }
        promise.resolve(credentials)
    }

    @ReactMethod
    fun saveEmail(email: String, promise: Promise) {
        sharedPreferences.edit().putString("email", email).apply()
        promise.resolve(true)
    }

    @ReactMethod
    fun saveDomainId(domainId: String, promise: Promise) {
        sharedPreferences.edit().putString("domain_id", domainId).apply()
        promise.resolve(true)
    }

    @ReactMethod
    fun savePassword(password: String, promise: Promise) {
        sharedPreferences.edit().putString("password", password).apply()
        promise.resolve(true)
    }

    @ReactMethod
    fun refreshToken(promise: Promise) {
        scope.launch {
            try {
                logToFile("Starting token refresh...")
                
                // Get stored credentials
                val email = sharedPreferences.getString("email", "") ?: ""
                val password = sharedPreferences.getString("password", "") ?: ""
                val domainId = sharedPreferences.getString("domain_id", "") ?: ""
                
                logToFile("Refreshing token with email: $email, domainId: $domainId")
                
                if (email.isEmpty() || password.isEmpty() || domainId.isEmpty()) {
                    val errorMsg = "Missing stored credentials for token refresh"
                    logToFile(errorMsg)
                    throw Exception(errorMsg)
                }
                
                // Perform full re-authentication flow (same as testTokenValidity and authenticate)
                
                // 1. Authenticate with Posemesh
                val url1 = URL("https://api.posemesh.org/user/login")
                logToFile("Posemesh user login URL: $url1")
                
                val connection1 = url1.openConnection() as HttpURLConnection
                
                val body1 = JSONObject().apply {
                    put("email", email)
                    put("password", password)
                }

                connection1.apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Accept", "application/json")
                    doOutput = true
                    outputStream.write(body1.toString().toByteArray())
                }

                val responseCode1 = connection1.responseCode
                logToFile("Posemesh user login response code: $responseCode1")

                if (responseCode1 !in 200..299) {
                    val errorMessage = "Token refresh: Failed to authenticate posemesh account: $responseCode1"
                    logToFile(errorMessage)
                    throw Exception(errorMessage)
                }

                val response1 = connection1.inputStream.bufferedReader().readText()
                logToFile("Posemesh user login response: ${response1.take(200)}${if (response1.length > 200) "..." else ""}")
                
                val repJson1 = JSONObject(response1)
                val posemeshTokenValue = repJson1.getString("access_token")
                posemeshToken = posemeshTokenValue
                logToFile("Posemesh token received (first 10 chars): ${posemeshTokenValue.take(10)}...")

                // 2. Auth DDS
                val url2 = URL("https://api.posemesh.org/service/domains-access-token")
                logToFile("DDS authentication URL: $url2")
                
                val connection2 = url2.openConnection() as HttpURLConnection
                
                connection2.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $posemeshToken")
                }

                val responseCode2 = connection2.responseCode
                logToFile("DDS authentication response code: $responseCode2")

                if (responseCode2 !in 200..299) {
                    val errorMessage = "Token refresh: Failed to authenticate domain dds: $responseCode2"
                    logToFile(errorMessage)
                    throw Exception(errorMessage)
                }

                val response2 = connection2.inputStream.bufferedReader().readText()
                logToFile("DDS authentication response: $response2")
                
                val repJson2 = JSONObject(response2)
                val ddsTokenValue = repJson2.getString("access_token")
                ddsToken = ddsTokenValue
                logToFile("DDS token received (first 10 chars): ${ddsTokenValue.take(10)}...")

                // 3. Auth Domain
                val url3 = URL("https://dds.posemesh.org/api/v1/domains/$domainId/auth")
                logToFile("Domain authentication URL: $url3")
                
                val connection3 = url3.openConnection() as HttpURLConnection
                
                connection3.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $ddsToken")
                }

                val responseCode3 = connection3.responseCode
                logToFile("Domain authentication response code: $responseCode3")

                if (responseCode3 !in 200..299) {
                    val errorMessage = "Token refresh: Failed to authenticate domain access: $responseCode3"
                    logToFile(errorMessage)
                    throw Exception(errorMessage)
                }

                val response3 = connection3.inputStream.bufferedReader().readText()
                logToFile("Domain authentication response: ${response3.take(200)}${if (response3.length > 200) "..." else ""}")
                
                // Update stored domain info
                domainInfo = response3
                logToFile("Updated domain info after token refresh")
                
                // Return the updated domain info
                logToFile("Token refresh completed successfully")
                promise.resolve(domainInfo)
            } catch (e: Exception) {
                Log.e(TAG, "Token refresh failed", e)
                logToFile("Token refresh failed: ${e.message}")
                promise.reject("REFRESH_ERROR", "Token refresh failed: ${e.message}")
            }
        }
    }

    @ReactMethod
    fun authenticate(email: String?, password: String?, domainId: String?, promise: Promise) {
        scope.launch {
            try {
                val finalEmail = email ?: sharedPreferences.getString("email", "") ?: ""
                val finalPassword = password ?: sharedPreferences.getString("password", "") ?: ""
                val finalDomainId = domainId ?: sharedPreferences.getString("domain_id", "") ?: ""

                logToFile("Starting authentication with email: $finalEmail, domainId: $finalDomainId")

                if (finalEmail.isEmpty() || finalPassword.isEmpty() || finalDomainId.isEmpty()) {
                    logToFile("Missing credentials for authentication")
                    promise.reject("AUTH_ERROR", "Missing credentials")
                    return@launch
                }

                // 1. Auth User Posemesh
                val url1 = URL("https://api.posemesh.org/user/login")
                logToFile("Posemesh user login URL: $url1")
                
                val connection1 = url1.openConnection() as HttpURLConnection
                
                val body1 = JSONObject().apply {
                    put("email", finalEmail)
                    put("password", finalPassword)
                }

                connection1.apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Accept", "application/json")
                    doOutput = true
                    outputStream.write(body1.toString().toByteArray())
                }

                val responseCode1 = connection1.responseCode
                logToFile("Posemesh user login response code: $responseCode1")

                if (responseCode1 !in 200..299) {
                    val errorMessage = "Failed to authenticate posemesh account: $responseCode1"
                    logToFile(errorMessage)
                    promise.reject("AUTH_ERROR", errorMessage)
                    return@launch
                }

                val response1 = connection1.inputStream.bufferedReader().readText()
                logToFile("Posemesh user login response: ${response1.take(200)}${if (response1.length > 200) "..." else ""}")
                
                val repJson1 = JSONObject(response1)
                val posemeshTokenValue = repJson1.getString("access_token")
                posemeshToken = posemeshTokenValue
                logToFile("Posemesh token received (first 10 chars): ${posemeshTokenValue.take(10)}...")

                // 2. Auth DDS
                val url2 = URL("https://api.posemesh.org/service/domains-access-token")
                logToFile("DDS authentication URL: $url2")
                
                val connection2 = url2.openConnection() as HttpURLConnection
                
                connection2.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $posemeshToken")
                }

                val responseCode2 = connection2.responseCode
                logToFile("DDS authentication response code: $responseCode2")

                if (responseCode2 !in 200..299) {
                    val errorMessage = "Failed to authenticate domain dds: $responseCode2"
                    logToFile(errorMessage)
                    promise.reject("AUTH_ERROR", errorMessage)
                    return@launch
                }

                val response2 = connection2.inputStream.bufferedReader().readText()
                logToFile("DDS authentication response: $response2")
                
                val repJson2 = JSONObject(response2)
                val ddsTokenValue = repJson2.getString("access_token")
                ddsToken = ddsTokenValue
                logToFile("DDS token received (first 10 chars): ${ddsTokenValue.take(10)}...")

                // 3. Auth Domain
                val url3 = URL("https://dds.posemesh.org/api/v1/domains/$finalDomainId/auth")
                logToFile("Domain authentication URL: $url3")
                
                val connection3 = url3.openConnection() as HttpURLConnection
                
                connection3.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $ddsToken")
                }

                val responseCode3 = connection3.responseCode
                logToFile("Domain authentication response code: $responseCode3")

                if (responseCode3 !in 200..299) {
                    val errorMessage = "Failed to authenticate domain access: $responseCode3"
                    logToFile(errorMessage)
                    promise.reject("AUTH_ERROR", errorMessage)
                    return@launch
                }

                val response3 = connection3.inputStream.bufferedReader().readText()
                logToFile("Domain authentication response: ${response3.take(200)}${if (response3.length > 200) "..." else ""}")
                
                domainInfo = response3

                // Parse domain info to get server URL
                val domainInfoObj = JSONObject(response3)
                val accessToken = domainInfoObj.getString("access_token")
                logToFile("Domain access token received (first 10 chars): ${accessToken.take(10)}...")
                
                val domainServerObj = domainInfoObj.optJSONObject("domain_server")
                if (domainServerObj != null) {
                    val domainServer = domainServerObj.optString("url", "")
                    logToFile("Domain server URL: $domainServer")
                } else {
                    logToFile("Warning: domain_server object not found in response")
                }

                // After successful authentication, download the map in a separate coroutine
                scope.launch {
                    try {
                        Log.d(TAG, "Authentication successful, downloading map...")
                        logToFile("Authentication successful, downloading map...")
                        
                        // Download map directly without using Promise
                        downloadMapAfterAuth()
                    } catch (e: Exception) {
                        Log.e(TAG, "Error downloading map after authentication: ${e.message}", e)
                        logToFile("Error downloading map after authentication: ${e.message}")
                    }
                }

                // Return response with domain server URL
                val result = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putString("message", "Domain Server: ${domainInfoObj.optJSONObject("domain_server")?.optString("url", "N/A") ?: "N/A"}")
                }
                logToFile("Authentication completed successfully")
                promise.resolve(result)

            } catch (e: Exception) {
                Log.e(TAG, "Authentication error: ${e.message}", e)
                logToFile("Authentication error: ${e.message}")
                promise.reject("AUTH_ERROR", "Authentication error: ${e.message}")
            }
        }
    }

    @ReactMethod
    fun clearStoredCredentials(promise: Promise) {
        sharedPreferences.edit().clear().apply()
        promise.resolve(null)
    }

    @ReactMethod
    fun clearDeviceId(promise: Promise) {
        try {
            logToFile("Clearing stored device ID")
            sharedPreferences.edit().remove("unique_device_id").apply()
            logToFile("Device ID cleared successfully")
            promise.resolve(true)
        } catch (e: Exception) {
            logToFile("Error clearing device ID: ${e.message}")
            promise.reject("CLEAR_ERROR", "Failed to clear device ID: ${e.message}")
        }
    }

    @ReactMethod
    fun getConfig(promise: Promise) {
        val config = Arguments.createMap().apply {
            putString("email", ConfigManager.getString("email"))
            putString("domain_id", ConfigManager.getString("domain_id"))
            putString("slam_ip", ConfigManager.getString("slam_ip"))
            putInt("slam_port", ConfigManager.getInt("slam_port"))
            putInt("timeout_ms", ConfigManager.getInt("timeout_ms"))
            
            // Add patrol points
            val patrolPoints = Arguments.createArray()
            for (i in 1..4) {
                val pointKey = "patrol.point$i"
                ConfigManager.getDoubleArray(pointKey)?.let { coords ->
                    if (coords.size >= 3) {
                        val point = Arguments.createMap().apply {
                            putString("name", "Patrol Point $i")
                            putDouble("x", coords[0])
                            putDouble("y", coords[1])
                            putDouble("yaw", coords[2])
                        }
                        patrolPoints.pushMap(point)
                    }
                }
            }
            putArray("patrol_points", patrolPoints)
        }
        promise.resolve(config)
    }

    @ReactMethod
    fun requestStoragePermission(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("PERMISSION_ERROR", "Activity is null")
            return
        }

        ActivityCompat.requestPermissions(
            activity,
            arrayOf(
                Manifest.permission.WRITE_EXTERNAL_STORAGE,
                Manifest.permission.READ_EXTERNAL_STORAGE
            ),
            STORAGE_PERMISSION_CODE
        )
        promise.resolve(true)
    }

    @ReactMethod
    fun getNavmeshCoord(coords: ReadableMap, promise: Promise) {
        scope.launch {
            try {
                // Get fresh token
                val token = getToken() ?: throw Exception("Failed to get token")
                
                // Now proceed with navmesh request
                val result = getNavmeshCoordWithToken(coords)
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "Error in getNavmeshCoord: ${e.message}", e)
                promise.reject("NAVMESH_ERROR", "Error getting navmesh coord: ${e.message}")
            }
        }
    }

    @ReactMethod
    fun getStcmMap(resolution: Int = 20, promise: Promise) {
        scope.launch {
            try {
                val domainId = sharedPreferences.getString("domain_id", "") ?: ""
                val domainInfoStr = domainInfo ?: throw Exception("No domain info available")
                val domainInfoObj = JSONObject(domainInfoStr)
                val accessToken = domainInfoObj.getString("access_token")
                val domainServerObj = domainInfoObj.getJSONObject("domain_server")
                val domainServerUrl = domainServerObj.getString("url")

                // Get map endpoint from config
                val url = ConfigManager.getNestedString("domain.map_endpoint")
                Log.d(TAG, "Using map endpoint: $url")

                val client = OkHttpClient()
                
                val requestBody = JSONObject().apply {
                    put("domainId", domainId)
                    put("domainServerUrl", domainServerUrl)
                    put("height", 0.1)
                    put("fileType", "stcm")  // Request STCM format
                    put("pixelsPerMeter", resolution)
                }

                Log.d(TAG, "Sending request: ${requestBody.toString()}")

                val mediaType = "application/json".toMediaType()
                val request = Request.Builder()
                    .url(url)
                    .post(requestBody.toString().toRequestBody(mediaType))
                    .addHeader("Authorization", "Bearer $accessToken")
                    .build()

                val response = client.newCall(request).execute()
                if (!response.isSuccessful) {
                    val errorBody = response.body?.string() ?: "No error body"
                    val error = Exception("Failed to download map: ${response.code}\nRequest Body: ${requestBody.toString()}\nError Body: $errorBody")
                    error.printStackTrace()
                    throw error
                }

                // Get content type to determine how to process the response
                val contentType = response.header("Content-Type", "")
                Log.d(TAG, "Response content type: $contentType")

                var stcmData: ByteArray? = null

                if (contentType?.contains("multipart/form-data") == true) {
                    // Handle multipart response
                    val responseBody = response.body?.string() ?: throw Exception("Empty response body")
                    
                    // Get the boundary from the Content-Type header
                    val boundaryPattern = Pattern.compile("boundary=([^;\\s]+)")
                    val boundaryMatcher = boundaryPattern.matcher(contentType)
                    if (!boundaryMatcher.find()) {
                        throw Exception("Could not find boundary in Content-Type header")
                    }
                    val boundary = "--${boundaryMatcher.group(1)}"
                    
                    // Split the data using the boundary marker
                    val parts = responseBody.split(boundary)
                    
                    // Find the part containing the STCM data
                    for (part in parts) {
                        if (part.contains("name=\"img\"")) {
                            val headerEnd = part.indexOf("\r\n\r\n")
                            if (headerEnd > 0) {
                                // Extract the base64 encoded data after the header
                                val base64Data = part.substring(headerEnd + 4).trim()
                                
                                // Clean up any whitespace or newlines that might be in the base64 string
                                val cleanBase64 = base64Data.replace("\\s+".toRegex(), "")
                                
                                // Decode the base64 data
                                stcmData = Base64.decode(cleanBase64, Base64.DEFAULT)
                                Log.d(TAG, "Successfully decoded ${cleanBase64.length} bytes of base64 data to ${stcmData.size} bytes of binary STCM data")
                                break
                            }
                        }
                    }
                } else {
                    // If not multipart, assume the entire content is the STCM data
                    stcmData = response.body?.bytes()
                    Log.d(TAG, "Received ${stcmData?.size ?: 0} bytes of STCM data")
                }

                if (stcmData == null) {
                    throw Exception("Failed to extract STCM data from response")
                }

                // Save the STCM file to Downloads/Gotu directory
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val cactusDir = File(downloadsDir, "Gotu")
                if (!cactusDir.exists()) {
                    cactusDir.mkdirs()
                }

                // Use a simple filename without timestamp
                val stcmFile = File(cactusDir, "map.stcm")
                stcmFile.writeBytes(stcmData)

                Log.d(TAG, "STCM map saved to: ${stcmFile.absolutePath}")

                val result = Arguments.createMap().apply {
                    putString("filePath", stcmFile.absolutePath)
                    putInt("fileSize", stcmData.size)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "Error downloading STCM map", e)
                promise.reject("DOWNLOAD_ERROR", e.message ?: "Unknown error")
            }
        }
    }

    @ReactMethod
    fun getDomainInfo(promise: Promise) {
        if (domainInfo.isNullOrEmpty()) {
            promise.reject("DOMAIN_INFO_ERROR", "Domain info not available")
            return
        }
        promise.resolve(domainInfo)
    }

    @ReactMethod
    fun downloadAndProcessMap(promise: Promise) {
        scope.launch {
            try {
                Log.d(TAG, "Starting downloadAndProcessMap")
                // Call the existing method that downloads and processes the map
                downloadMapAfterAuth()
                Log.d(TAG, "Map download and processing completed successfully")
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "Error in downloadAndProcessMap: ${e.message}", e)
                promise.reject("MAP_ERROR", "Failed to download and process map: ${e.message}")
            }
        }
    }

    @ReactMethod
    fun fetchDomainData(name: String, dataType: String, promise: Promise) {
        scope.launch {
            try {
                val domainInfoStr = domainInfo ?: throw Exception("No domain info available")
                val domainInfoObj = JSONObject(domainInfoStr)
                val accessToken = domainInfoObj.getString("access_token")
                val domainServerObj = domainInfoObj.getJSONObject("domain_server")
                val domainServerUrl = domainServerObj.getString("url")
                val domainId = domainInfoObj.getString("id")
                
                Log.d(TAG, "Fetching domain data: name=$name, dataType=$dataType")
                
                // Step 1: Get metadata
                val metadataUrl = "$domainServerUrl/api/v1/domains/$domainId/data?name=$name&data_type=$dataType"
                Log.d(TAG, "Metadata URL: $metadataUrl")
                
                val client = OkHttpClient()
                val metadataRequest = Request.Builder()
                    .url(metadataUrl)
                    .addHeader("Authorization", "Bearer $accessToken")
                    .build()
                
                val metadataResponse = client.newCall(metadataRequest).execute()
                if (!metadataResponse.isSuccessful) {
                    throw Exception("Failed to get metadata: ${metadataResponse.code}")
                }
                
                val metadataJson = JSONObject(metadataResponse.body?.string() ?: "")
                val dataArray = metadataJson.optJSONArray("data")
                
                if (dataArray == null || dataArray.length() == 0) {
                    throw Exception("No data found with name=$name and type=$dataType")
                }
                
                val metadata = dataArray.getJSONObject(0)
                val metadataId = metadata.getString("id")
                
                Log.d(TAG, "Found metadata with ID: $metadataId")
                
                // Step 2: Get actual data using metadata ID
                val dataUrl = "$domainServerUrl/api/v1/domains/$domainId/data/$metadataId?raw=1"
                Log.d(TAG, "Data URL: $dataUrl")
                
                val dataRequest = Request.Builder()
                    .url(dataUrl)
                    .addHeader("Authorization", "Bearer $accessToken")
                    .addHeader("Accept", "multipart/form-data")
                    .build()
                
                val dataResponse = client.newCall(dataRequest).execute()
                if (!dataResponse.isSuccessful) {
                    throw Exception("Failed to get data: ${dataResponse.code}")
                }
                
                val rawData = dataResponse.body?.string() ?: ""
                Log.d(TAG, "Retrieved data: $rawData")
                
                // Convert to React Native object
                val result = Arguments.createMap()
                val metadataMap = Arguments.createMap()
                
                // Add metadata fields
                metadataMap.putString("id", metadata.optString("id", ""))
                metadataMap.putString("name", metadata.optString("name", ""))
                metadataMap.putString("data_type", metadata.optString("data_type", ""))
                metadataMap.putString("created_at", metadata.optString("created_at", ""))
                
                result.putMap("metadata", metadataMap)
                result.putString("data", rawData)
                
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "Error fetching domain data: ${e.message}", e)
                promise.reject("FETCH_DATA_ERROR", "Failed to fetch domain data: ${e.message}")
            }
        }
    }
    
    @ReactMethod
    fun getRobotCall(promise: Promise) {
        // Convenience method to fetch robot_call data
        fetchDomainData("robot_call", "robot_pose_json", promise)
    }

    @ReactMethod
    fun testTokenValidity(promise: Promise) {
        scope.launch {
            try {
                logToFile("Starting token validation...")
                
                // Check if we have domain info
                val domainInfoStr = domainInfo ?: throw Exception("No domain info available")
                logToFile("Domain info from storage: $domainInfoStr")
                
                // Instead of testing existing token validity, try a re-authentication approach
                // This mimics what the ConfigScreen does
                val email = sharedPreferences.getString("email", "") ?: ""
                val password = sharedPreferences.getString("password", "") ?: ""
                val domainId = sharedPreferences.getString("domain_id", "") ?: ""
                
                logToFile("Re-authenticating with email: $email, domainId: $domainId")
                
                if (email.isEmpty() || password.isEmpty() || domainId.isEmpty()) {
                    val errorMsg = "Missing stored credentials for token validation"
                    logToFile(errorMsg)
                    throw Exception(errorMsg)
                }
                
                // 1. Re-authenticate with Posemesh
                val url1 = URL("https://api.posemesh.org/user/login")
                logToFile("Posemesh user login URL: $url1")
                
                val connection1 = url1.openConnection() as HttpURLConnection
                
                val body1 = JSONObject().apply {
                    put("email", email)
                    put("password", password)
                }

                connection1.apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Accept", "application/json")
                    doOutput = true
                    outputStream.write(body1.toString().toByteArray())
                }

                val responseCode1 = connection1.responseCode
                logToFile("Posemesh user login response code: $responseCode1")

                if (responseCode1 !in 200..299) {
                    val errorMessage = "Token validation: Failed to authenticate posemesh account: $responseCode1"
                    logToFile(errorMessage)
                    throw Exception(errorMessage)
                }

                val response1 = connection1.inputStream.bufferedReader().readText()
                logToFile("Posemesh user login response: ${response1.take(200)}${if (response1.length > 200) "..." else ""}")
                
                val repJson1 = JSONObject(response1)
                val posemeshTokenValue = repJson1.getString("access_token")
                posemeshToken = posemeshTokenValue
                logToFile("Posemesh token received (first 10 chars): ${posemeshTokenValue.take(10)}...")

                // 2. Auth DDS
                val url2 = URL("https://api.posemesh.org/service/domains-access-token")
                logToFile("DDS authentication URL: $url2")
                
                val connection2 = url2.openConnection() as HttpURLConnection
                
                connection2.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $posemeshToken")
                }

                val responseCode2 = connection2.responseCode
                logToFile("DDS authentication response code: $responseCode2")

                if (responseCode2 !in 200..299) {
                    val errorMessage = "Token validation: Failed to authenticate domain dds: $responseCode2"
                    logToFile(errorMessage)
                    throw Exception(errorMessage)
                }

                val response2 = connection2.inputStream.bufferedReader().readText()
                logToFile("DDS authentication response: $response2")
                
                val repJson2 = JSONObject(response2)
                val ddsTokenValue = repJson2.getString("access_token")
                ddsToken = ddsTokenValue
                logToFile("DDS token received (first 10 chars): ${ddsTokenValue.take(10)}...")

                // 3. Auth Domain
                val url3 = URL("https://dds.posemesh.org/api/v1/domains/$domainId/auth")
                logToFile("Domain authentication URL: $url3")
                
                val connection3 = url3.openConnection() as HttpURLConnection
                
                connection3.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $ddsToken")
                }

                val responseCode3 = connection3.responseCode
                logToFile("Domain authentication response code: $responseCode3")

                if (responseCode3 !in 200..299) {
                    val errorMessage = "Token validation: Failed to authenticate domain access: $responseCode3"
                    logToFile(errorMessage)
                    throw Exception(errorMessage)
                }

                val response3 = connection3.inputStream.bufferedReader().readText()
                logToFile("Domain authentication response: ${response3.take(200)}${if (response3.length > 200) "..." else ""}")
                
                // Update the stored domain info with new credentials
                domainInfo = response3
                logToFile("Updated domain info after token validation")
                
                // If we reached here, token validation was successful
                logToFile("Token validation successful via re-authentication")
                val result = Arguments.createMap()
                result.putBoolean("valid", true)
                result.putString("message", "Token is valid")
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "Token validation error: ${e.message}", e)
                logToFile("Token validation error: ${e.message}")
                promise.reject("TOKEN_VALIDATION_ERROR", "Token validation failed: ${e.message}")
            }
        }
    }

    // Add this helper method for logging to file
    private fun logToFile(message: String) {
        try {
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val logFile = File(downloadsDir, "debug_log.txt")
            val timestamp = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS").format(java.util.Date())
            val logMessage = "[$timestamp] $message\n"
            
            if (!logFile.exists()) {
                logFile.createNewFile()
            }
            
            // Append to file
            FileWriter(logFile, true).use { writer ->
                writer.append(logMessage)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error writing to debug log file: ${e.message}", e)
        }
    }

    @ReactMethod
    fun writeRobotCall(jsonData: String, method: String = "PUT", dataId: String? = null, promise: Promise) {
        scope.launch {
            try {
                logToFile("Starting writeRobotCall with method: $method, dataId: $dataId")
                val domainInfoStr = domainInfo ?: throw Exception("No domain info available")
                val domainInfoObj = JSONObject(domainInfoStr)
                val accessToken = domainInfoObj.getString("access_token")
                val domainServerObj = domainInfoObj.getJSONObject("domain_server")
                val domainServerUrl = domainServerObj.getString("url")
                val domainId = domainInfoObj.getString("id")
                
                Log.d(TAG, "Writing robot call data with method: $method, data: $jsonData")
                logToFile("Writing robot call data with method: $method, data: $jsonData")
                
                // Create the multipart form data with data_id if provided
                val dataName = if (method == "PUT" && dataId != null) {
                    dataId  // Use the provided dataId for PUT operations
                } else {
                    "robot_call"  // Default name
                }
                val dataType = "robot_pose_json"
                
                logToFile("Using name as dataName: $dataName")
                
                // Set up the multipart request body
                val requestBody = MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart(dataName, null, 
                        RequestBody.create("application/octet-stream".toMediaType(), jsonData))
                    .build()
                
                // API endpoint URL
                val url = "$domainServerUrl/api/v1/domains/$domainId/data?data_type=$dataType"
                Log.d(TAG, "Sending $method request to: $url")
                logToFile("Sending $method request to: $url")
                
                // Create and execute the request
                val client = OkHttpClient()
                val request = Request.Builder()
                    .url(url)
                    .method(method, requestBody)
                    .addHeader("Authorization", "Bearer $accessToken")
                    .build()
                
                val response = client.newCall(request).execute()
                logToFile("Write response code: ${response.code}")
                
                if (!response.isSuccessful) {
                    val errorMsg = "Failed to write robot call data: ${response.code}"
                    logToFile(errorMsg)
                    throw Exception(errorMsg)
                }
                
                val responseBody = response.body?.string() ?: ""
                Log.d(TAG, "Write response: $responseBody")
                logToFile("Write response: $responseBody")
                
                // Return success result
                val result = Arguments.createMap()
                result.putString("method", method)
                result.putString("formFieldName", dataName)
                result.putString("response", responseBody)
                
                // If this was a POST, try to extract the data_id from the response
                if (method == "POST") {
                    try {
                        val responseJson = JSONObject(responseBody)
                        if (responseJson.has("id")) {
                            val newDataId = responseJson.getString("id")
                            result.putString("dataId", newDataId)
                            logToFile("New data_id created: $newDataId")
                        }
                    } catch (e: Exception) {
                        logToFile("Could not parse data_id from response: ${e.message}")
                    }
                }
                
                logToFile("writeRobotCall completed successfully")
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "Error writing robot call data: ${e.message}", e)
                logToFile("Error writing robot call data: ${e.message}")
                promise.reject("WRITE_DATA_ERROR", "Failed to write robot call data: ${e.message}")
            }
        }
    }

    @ReactMethod
    fun getRobotPoseDataId(promise: Promise) {
        scope.launch {
            try {
                logToFile("Getting robot pose data ID")
                val domainInfoStr = domainInfo ?: throw Exception("No domain info available")
                val domainInfoObj = JSONObject(domainInfoStr)
                val accessToken = domainInfoObj.getString("access_token")
                val domainServerObj = domainInfoObj.getJSONObject("domain_server")
                val domainServerUrl = domainServerObj.getString("url")
                val domainId = domainInfoObj.getString("id")
                
                // Get device ID to search for data
                val deviceId = getUniqueDeviceId()
                val dataType = "reported_pose_json"
                
                logToFile("Checking for existing pose data with deviceId: $deviceId")
                
                // Get data list to find existing entries
                val url = "$domainServerUrl/api/v1/domains/$domainId/data?name=$deviceId&data_type=$dataType"
                logToFile("Fetching data from: $url")
                
                val client = OkHttpClient()
                val request = Request.Builder()
                    .url(url)
                    .addHeader("Authorization", "Bearer $accessToken")
                    .get()
                    .build()
                
                val response = client.newCall(request).execute()
                
                if (!response.isSuccessful) {
                    val errorMsg = "Failed to get pose data: ${response.code}"
                    logToFile(errorMsg)
                    throw Exception(errorMsg)
                }
                
                val responseBody = response.body?.string() ?: ""
                logToFile("Get response: $responseBody")
                
                // Parse response to find data_id
                val responseJson = JSONObject(responseBody)
                val dataArray = responseJson.optJSONArray("data")
                
                val result = Arguments.createMap()
                
                if (dataArray != null && dataArray.length() > 0) {
                    // Found existing data
                    val dataObj = dataArray.getJSONObject(0)
                    val dataId = dataObj.getString("id")
                    
                    logToFile("Found existing pose data with ID: $dataId")
                    
                    result.putBoolean("exists", true)
                    result.putString("dataId", dataId)
                    result.putString("deviceId", deviceId)
                } else {
                    // No existing data found
                    logToFile("No existing pose data found for device ID: $deviceId")
                    
                    result.putBoolean("exists", false)
                    result.putString("deviceId", deviceId)
                }
                
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "Error getting robot pose data ID: ${e.message}", e)
                logToFile("Error getting robot pose data ID: ${e.message}")
                promise.reject("GET_DATA_ID_ERROR", "Failed to get robot pose data ID: ${e.message}")
            }
        }
    }

    @ReactMethod
    fun writeRobotPose(jsonData: String, method: String = "PUT", dataId: String? = null, promise: Promise) {
        scope.launch {
            try {
                logToFile("Starting writeRobotPose with method: $method, dataId: $dataId")
                val domainInfoStr = domainInfo ?: throw Exception("No domain info available")
                val domainInfoObj = JSONObject(domainInfoStr)
                val accessToken = domainInfoObj.getString("access_token")
                val domainServerObj = domainInfoObj.getJSONObject("domain_server")
                val domainServerUrl = domainServerObj.getString("url")
                val domainId = domainInfoObj.getString("id")
                
                Log.d(TAG, "Writing robot pose data with method: $method, data: $jsonData")
                logToFile("Writing robot pose data with method: $method, data: $jsonData")
                
                // Create the multipart form data with unique device ID or data ID
                val dataName = if (method == "PUT" && dataId != null) {
                    dataId
                } else {
                    getUniqueDeviceId()
                }
                val dataType = "reported_pose_json"
                
                logToFile("Using name as dataName: $dataName")
                
                // Set up the multipart request body
                val requestBody = MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart(dataName, null, 
                        RequestBody.create("application/octet-stream".toMediaType(), jsonData))
                    .build()
                
                // API endpoint URL
                val url = "$domainServerUrl/api/v1/domains/$domainId/data?data_type=$dataType"
                Log.d(TAG, "Sending $method request to: $url")
                logToFile("Sending $method request to: $url")
                
                // Create and execute the request
                val client = OkHttpClient()
                val request = Request.Builder()
                    .url(url)
                    .method(method, requestBody)
                    .addHeader("Authorization", "Bearer $accessToken")
                    .build()
                
                val response = client.newCall(request).execute()
                logToFile("Write response code: ${response.code}")
                
                if (!response.isSuccessful) {
                    val errorMsg = "Failed to write robot pose data: ${response.code}"
                    logToFile(errorMsg)
                    throw Exception(errorMsg)
                }
                
                val responseBody = response.body?.string() ?: ""
                Log.d(TAG, "Write response: $responseBody")
                logToFile("Write response: $responseBody")
                
                // Return success result
                val result = Arguments.createMap()
                result.putString("method", method)
                result.putString("formFieldName", dataName)
                result.putString("response", responseBody)
                
                // If this was a POST, try to extract the data_id from the response
                if (method == "POST") {
                    try {
                        val responseJson = JSONObject(responseBody)
                        if (responseJson.has("id")) {
                            val newDataId = responseJson.getString("id")
                            result.putString("dataId", newDataId)
                            logToFile("New data_id created: $newDataId")
                        }
                    } catch (e: Exception) {
                        logToFile("Could not parse data_id from response: ${e.message}")
                    }
                }
                
                logToFile("writeRobotPose completed successfully")
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "Error writing robot pose data: ${e.message}", e)
                logToFile("Error writing robot pose data: ${e.message}")
                promise.reject("WRITE_POSE_ERROR", "Failed to write robot pose data: ${e.message}")
            }
        }
    }

    // Helper method to download map after authentication without using Promise
    private suspend fun downloadMapAfterAuth() {
        try {
            val domainId = sharedPreferences.getString("domain_id", "") ?: ""
            val domainInfoStr = domainInfo ?: throw Exception("No domain info available")
            val domainInfoObj = JSONObject(domainInfoStr)
            val accessToken = domainInfoObj.getString("access_token")
            val domainServerObj = domainInfoObj.getJSONObject("domain_server")
            val domainServerUrl = domainServerObj.getString("url")

            // Get map endpoint from config
            val url = ConfigManager.getNestedString("domain.map_endpoint")
            Log.d(TAG, "Using map endpoint: $url")

            val client = OkHttpClient()
            
            val requestBody = JSONObject().apply {
                put("domainId", domainId)
                put("domainServerUrl", domainServerUrl)
                put("height", 0.1)
                put("fileType", "stcm")  // Request STCM format
                put("pixelsPerMeter", 20)
            }

            Log.d(TAG, "Sending request: ${requestBody.toString()}")

            val mediaType = "application/json".toMediaType()
            val request = Request.Builder()
                .url(url)
                .post(requestBody.toString().toRequestBody(mediaType))
                .addHeader("Authorization", "Bearer $accessToken")
                .build()

            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                val errorBody = response.body?.string() ?: "No error body"
                Log.e(TAG, "Failed to download map: ${response.code}\nRequest Body: ${requestBody.toString()}\nError Body: $errorBody")
                return
            }

            // Get content type to determine how to process the response
            val contentType = response.header("Content-Type", "")
            Log.d(TAG, "Response content type: $contentType")

            var stcmData: ByteArray? = null

            if (contentType?.contains("multipart/form-data") == true) {
                // Handle multipart response
                val responseBody = response.body?.string() ?: throw Exception("Empty response body")
                
                // Get the boundary from the Content-Type header
                val boundaryPattern = Pattern.compile("boundary=([^;\\s]+)")
                val boundaryMatcher = boundaryPattern.matcher(contentType)
                if (!boundaryMatcher.find()) {
                    Log.e(TAG, "Could not find boundary in Content-Type header")
                    return
                }
                val boundary = "--${boundaryMatcher.group(1)}"
                
                // Split the data using the boundary marker
                val parts = responseBody.split(boundary)
                
                // Find the part containing the STCM data
                for (part in parts) {
                    if (part.contains("name=\"img\"")) {
                        val headerEnd = part.indexOf("\r\n\r\n")
                        if (headerEnd > 0) {
                            // Extract the base64 encoded data after the header
                            val base64Data = part.substring(headerEnd + 4).trim()
                            
                            // Clean up any whitespace or newlines that might be in the base64 string
                            val cleanBase64 = base64Data.replace("\\s+".toRegex(), "")
                            
                            // Decode the base64 data
                            stcmData = Base64.decode(cleanBase64, Base64.DEFAULT)
                            Log.d(TAG, "Successfully decoded ${cleanBase64.length} bytes of base64 data to ${stcmData.size} bytes of binary STCM data")
                            break
                        }
                    }
                }
            } else {
                // If not multipart, assume the entire content is the STCM data
                stcmData = response.body?.bytes()
                Log.d(TAG, "Received ${stcmData?.size ?: 0} bytes of STCM data")
            }

            if (stcmData == null) {
                Log.e(TAG, "Failed to extract STCM data from response")
                return
            }

            // Save the STCM file to Downloads/Gotu directory
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val cactusDir = File(downloadsDir, "Gotu")
            if (!cactusDir.exists()) {
                cactusDir.mkdirs()
            }

            // Use a simple filename without timestamp
            val stcmFile = File(cactusDir, "map.stcm")
            stcmFile.writeBytes(stcmData)

            Log.d(TAG, "STCM map saved to: ${stcmFile.absolutePath}")
            
            // Now perform the additional steps after downloading the map
            try {
                val slamIp = ConfigManager.getString("slam_ip", "127.0.0.1")
                val slamPort = ConfigManager.getInt("slam_port", 1448)
                val baseUrl = "http://$slamIp:$slamPort"
                
                // Step 1: Housekeeping - clear old data
                Log.d(TAG, "Clearing old POIs and map data")
                clearPOIs(baseUrl)
                clearMap(baseUrl)
                
                // Step 2: Upload the new map
                Log.d(TAG, "Uploading new map: ${stcmFile.absolutePath}")
                uploadMap(baseUrl, stcmFile.absolutePath)
                
                // Step 3: Update Homedock location
                val homedock = ConfigManager.getDoubleArray("homedock")
                if (homedock != null && homedock.size >= 6) {
                    Log.d(TAG, "Setting home dock at [${homedock[0]}, ${homedock[1]}, ${homedock[2]}, ${homedock[3]}, ${homedock[4]}, ${homedock[5]}]")
                    clearHomeDocks(baseUrl)
                    setHomeDock(baseUrl, homedock[0], homedock[1], homedock[2], homedock[3], homedock[4], homedock[5])
                    
                    // Step 4: Update robot pose based on Homedock
                    val pose = calculatePose(homedock)
                    Log.d(TAG, "Setting robot pose at [${pose[0]}, ${pose[1]}, ${pose[2]}, ${pose[3]}, ${pose[4]}, ${pose[5]}]")
                    setPose(baseUrl, pose[0], pose[1], pose[2], pose[3], pose[4], pose[5])
                } else {
                    Log.e(TAG, "No valid homedock configuration found")
                }
                
                // Step 5: Ensure map is persistent
                Log.d(TAG, "Saving persistent map")
                savePersistentMap(baseUrl)
                
                Log.d(TAG, "Map processing completed successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Error during map processing steps: ${e.message}", e)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error downloading map after authentication", e)
        }
    }
    
    // Helper methods for map processing
    
    private fun clearPOIs(baseUrl: String) {
        try {
            val url = URL("$baseUrl/api/core/artifact/v1/pois")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "DELETE"
            val responseCode = connection.responseCode
            Log.d(TAG, "Clear POIs response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing POIs: ${e.message}", e)
        }
    }
    
    private fun clearMap(baseUrl: String) {
        try {
            val url = URL("$baseUrl/api/core/slam/v1/maps")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "DELETE"
            val responseCode = connection.responseCode
            Log.d(TAG, "Clear map response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing map: ${e.message}", e)
        }
    }
    
    private fun uploadMap(baseUrl: String, filePath: String) {
        try {
            val file = File(filePath)
            if (!file.exists()) {
                Log.e(TAG, "Map file does not exist: $filePath")
                return
            }
            
            val url = URL("$baseUrl/api/core/slam/v1/maps/stcm")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "PUT"
            connection.setRequestProperty("Content-Type", "application/octet-stream")
            connection.doOutput = true
            
            FileInputStream(file).use { input ->
                connection.outputStream.use { output ->
                    val buffer = ByteArray(4096)
                    var bytesRead: Int
                    var totalBytes = 0
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        output.write(buffer, 0, bytesRead)
                        totalBytes += bytesRead
                    }
                    Log.d(TAG, "Uploaded $totalBytes bytes")
                }
            }
            
            val responseCode = connection.responseCode
            Log.d(TAG, "Upload map response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error uploading map: ${e.message}", e)
        }
    }
    
    private fun clearHomeDocks(baseUrl: String) {
        try {
            val url = URL("$baseUrl/api/core/slam/v1/homepose")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "DELETE"
            val responseCode = connection.responseCode
            Log.d(TAG, "Clear home docks response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing home docks: ${e.message}", e)
        }
    }
    
    private fun setHomeDock(baseUrl: String, x: Double, y: Double, z: Double, yaw: Double, pitch: Double, roll: Double) {
        try {
            val url = URL("$baseUrl/api/core/slam/v1/homepose")
            val connection = url.openConnection() as HttpURLConnection
            
            val body = JSONObject().apply {
                put("x", x)
                put("y", y)
                put("z", z)
                put("yaw", yaw)
                put("pitch", pitch)
                put("roll", roll)
            }
            
            connection.requestMethod = "PUT"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            
            connection.outputStream.use { os ->
                os.write(body.toString().toByteArray())
            }
            
            val responseCode = connection.responseCode
            Log.d(TAG, "Set home dock response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error setting home dock: ${e.message}", e)
        }
    }
    
    private fun setPose(baseUrl: String, x: Double, y: Double, z: Double, yaw: Double, pitch: Double, roll: Double) {
        try {
            val url = URL("$baseUrl/api/core/slam/v1/localization/pose")
            val connection = url.openConnection() as HttpURLConnection
            
            val body = JSONObject().apply {
                put("x", x)
                put("y", y)
                put("z", z)
                put("yaw", yaw)
                put("pitch", pitch)
                put("roll", roll)
            }
            
            connection.requestMethod = "PUT"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            
            connection.outputStream.use { os ->
                os.write(body.toString().toByteArray())
            }
            
            val responseCode = connection.responseCode
            Log.d(TAG, "Set pose response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error setting pose: ${e.message}", e)
        }
    }
    
    private fun savePersistentMap(baseUrl: String) {
        try {
            val url = URL("$baseUrl/api/core/slam/v1/maps/persistent")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "PUT"
            
            val responseCode = connection.responseCode
            Log.d(TAG, "Save persistent map response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error saving persistent map: ${e.message}", e)
        }
    }
    
    private fun calculatePose(homedock: DoubleArray, distanceInMeters: Double = 0.2): DoubleArray {
        val x = homedock[0]
        val y = homedock[1]
        val z = homedock[2]
        val yaw = homedock[3]
        val pitch = homedock[4]
        val roll = homedock[5]
        
        val dx = distanceInMeters * Math.cos(yaw)
        val dz = distanceInMeters * Math.sin(yaw)
        
        return doubleArrayOf(
            x + dx,  // new x
            y,       // y remains unchanged
            z + dz,  // new z
            yaw,     // yaw remains unchanged
            pitch,   // pitch remains unchanged
            roll     // roll remains unchanged
        )
    }

    private fun writeInt(out: FileOutputStream, value: Int) {
        out.write(byteArrayOf(
            (value and 0xFF).toByte(),
            ((value shr 8) and 0xFF).toByte(),
            ((value shr 16) and 0xFF).toByte(),
            ((value shr 24) and 0xFF).toByte()
        ))
    }

    private fun writeShort(out: FileOutputStream, value: Int) {
        out.write(byteArrayOf(
            (value and 0xFF).toByte(),
            ((value shr 8) and 0xFF).toByte()
        ))
    }

    private suspend fun getToken(): String? {
        try {
            val email = sharedPreferences.getString("email", "") ?: ""
            val password = sharedPreferences.getString("password", "") ?: ""
            val domainId = sharedPreferences.getString("domain_id", "") ?: ""

            if (email.isEmpty() || password.isEmpty() || domainId.isEmpty()) {
                Log.e(TAG, "Missing credentials")
                return null
            }

            // 1. Auth User Posemesh
            val url1 = URL("https://api.posemesh.org/user/login")
            val connection1 = url1.openConnection() as HttpURLConnection
            
            val body1 = JSONObject().apply {
                put("email", email)
                put("password", password)
            }

            connection1.apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
                doOutput = true
                outputStream.write(body1.toString().toByteArray())
            }

            if (connection1.responseCode !in 200..299) {
                Log.e(TAG, "Failed to authenticate posemesh account")
                return null
            }

            val response1 = connection1.inputStream.bufferedReader().readText()
            val repJson1 = JSONObject(response1)
            val posemeshToken = repJson1.getString("access_token")

            // 2. Auth DDS
            val url2 = URL("https://api.posemesh.org/service/domains-access-token")
            val connection2 = url2.openConnection() as HttpURLConnection
            
            connection2.apply {
                requestMethod = "POST"
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $posemeshToken")
            }

            if (connection2.responseCode !in 200..299) {
                Log.e(TAG, "Failed to authenticate domain dds")
                return null
            }

            val response2 = connection2.inputStream.bufferedReader().readText()
            val repJson2 = JSONObject(response2)
            val ddsToken = repJson2.getString("access_token")

            // 3. Auth Domain
            val url3 = URL("https://dds.posemesh.org/api/v1/domains/$domainId/auth")
            val connection3 = url3.openConnection() as HttpURLConnection
            
            connection3.apply {
                requestMethod = "POST"
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $ddsToken")
            }

            if (connection3.responseCode !in 200..299) {
                Log.e(TAG, "Failed to authenticate domain access")
                return null
            }

            val response3 = connection3.inputStream.bufferedReader().readText()
            domainInfo = response3

            // Parse domain info to get access token
            val domainInfoObj = JSONObject(response3)
            return domainInfoObj.getString("access_token")
        } catch (e: Exception) {
            Log.e(TAG, "Error getting token: ${e.message}")
            return null
        }
    }

    private fun getNavmeshCoordWithToken(coords: ReadableMap): ReadableMap {
        val domainInfoStr = domainInfo ?: throw Exception("Domain info not found")
        val domainInfoObj = JSONObject(domainInfoStr)
        val accessToken = domainInfoObj.getString("access_token")
        val domainServerObj = domainInfoObj.getJSONObject("domain_server")
        val domainServer = domainServerObj.getString("url")
        val domainId = sharedPreferences.getString("domain_id", "") ?: throw Exception("Domain ID not found")

        // Get input coordinates and transform Z
        val inputX = coords.getDouble("x")
        var inputZ = coords.getDouble("z")
        inputZ = if (inputZ > 0) -Math.abs(inputZ) else Math.abs(inputZ)

        val url = URL(ConfigManager.getNestedString("domain.navmesh_endpoint"))
        val connection = url.openConnection() as HttpURLConnection

        val body = JSONObject().apply {
            put("domainId", domainId)
            put("domainServerUrl", domainServer)
            put("target", JSONObject().apply {
                put("x", inputX)
                put("y", 0)
                put("z", inputZ)
            })
            put("radius", 0.5)
        }

        connection.apply {
            requestMethod = "POST"
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $accessToken")
            setRequestProperty("Accept", "application/json")
            doOutput = true
            outputStream.write(body.toString().toByteArray())
        }

        val responseCode = connection.responseCode
        if (responseCode !in 200..299) {
            val errorStream = connection.errorStream
            val errorResponse = errorStream?.bufferedReader()?.readText() ?: "No error details available"
            Log.e(TAG, "Navmesh validation failed: $responseCode\nError: $errorResponse")
            throw Exception("Failed to get navmesh coord: $responseCode\nError: $errorResponse")
        }

        val response = connection.inputStream.bufferedReader().readText()
        val responseJson = JSONObject(response)
        val restrictedCoords = responseJson.getJSONObject("restricted")

        // Get coordinates exactly as in Python
        val x1 = inputX
        val z1 = inputZ
        val x2 = restrictedCoords.getDouble("x")
        var z2 = restrictedCoords.getDouble("z")

        // Calculate deltas exactly as in Python
        val deltaX = x1 - x2
        val deltaZ = z1 - z2

        // Transform z2 exactly as in Python
        z2 = if (z2 > 0) -Math.abs(z2) else Math.abs(z2)

        // Calculate yaw exactly as in Python
        var yaw = Math.atan2(deltaZ, deltaX)
        yaw = Math.round(yaw * 100.0) / 100.0  // Round to 2 decimal places first
        yaw = if (yaw > 0) -Math.abs(yaw) else Math.abs(yaw)  // Then negate if positive
        
        // Reverse yaw by 180 degrees (π radians)
        yaw += Math.PI
        // Normalize yaw to [-π, π]
        if (yaw > Math.PI) {
            yaw -= 2 * Math.PI
        } else if (yaw < -Math.PI) {
            yaw += 2 * Math.PI
        }

        return Arguments.createMap().apply {
            putDouble("x", x2)
            putDouble("z", z2)
            putDouble("yaw", yaw)
            // Add debug information
            putMap("debug", Arguments.createMap().apply {
                putMap("productCoords", Arguments.createMap().apply {
                    putDouble("x", coords.getDouble("x"))
                    putDouble("z", coords.getDouble("z"))
                })
                putMap("transformedCoords", Arguments.createMap().apply {
                    putDouble("x", inputX)
                    putDouble("z", inputZ)
                })
                putMap("navmeshResult", Arguments.createMap().apply {
                    putDouble("x", x2)
                    putDouble("z", z2)
                    putDouble("yaw", yaw)
                    putDouble("deltaX", deltaX)
                    putDouble("deltaZ", deltaZ)
                })
            })
        }
    }

    private fun getUniqueDeviceId(): String {
        // First check if we've already stored an ID
        var deviceId = sharedPreferences.getString("unique_device_id", null)
        
        if (deviceId != null) {
            logToFile("Using existing stored device ID: $deviceId")
            return deviceId
        }
        
        logToFile("No existing device ID found, generating new ID")
        
        try {
            // Check if we have the permission
            val hasWifiPermission = ContextCompat.checkSelfPermission(
                reactApplicationContext,
                Manifest.permission.ACCESS_WIFI_STATE
            ) == PackageManager.PERMISSION_GRANTED
            
            if (!hasWifiPermission) {
                logToFile("ACCESS_WIFI_STATE permission not granted - add it to the manifest")
            } else {
                logToFile("ACCESS_WIFI_STATE permission is granted, attempting to get MAC address")
            }
            
            // Try to get the WiFi MAC address
            val wifiManager = reactApplicationContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
            val wifiInfo = wifiManager.connectionInfo
            val macAddress = wifiInfo?.macAddress
            
            logToFile("Raw MAC address from WifiManager: $macAddress")
            
            if (macAddress != null && macAddress != "02:00:00:00:00:00" && macAddress != "00:00:00:00:00:00") {
                // Use MAC address if available (sanitize it for use as an identifier)
                deviceId = "padbot-" + macAddress.replace(":", "")
                logToFile("Using WiFi MAC address for device ID: $deviceId")
            } else {
                // Some Android versions return a placeholder MAC address (privacy protection)
                // Try alternative method
                logToFile("Invalid MAC from WifiManager, trying NetworkInterface approach")
                val networkInterfaces = java.net.NetworkInterface.getNetworkInterfaces()
                var foundMac = false
                
                while (networkInterfaces.hasMoreElements() && !foundMac) {
                    val networkInterface = networkInterfaces.nextElement()
                    val interfaceName = networkInterface.name
                    
                    logToFile("Checking network interface: $interfaceName")
                    
                    // Look for the wlan0 interface which is typically the WiFi interface
                    if (interfaceName.equals("wlan0", ignoreCase = true)) {
                        val mac = networkInterface.hardwareAddress
                        if (mac != null && mac.isNotEmpty()) {
                            val macStringBuilder = StringBuilder()
                            for (b in mac) {
                                macStringBuilder.append(String.format("%02X", b))
                            }
                            
                            deviceId = "padbot-" + macStringBuilder.toString()
                            foundMac = true
                            logToFile("Retrieved MAC address via NetworkInterface: $deviceId")
                        } else {
                            logToFile("wlan0 interface found but no hardware address available")
                        }
                    }
                }
                
                if (!foundMac) {
                    // Fallback to UUID if we can't get MAC address
                    val uuid = java.util.UUID.randomUUID().toString()
                    deviceId = "padbot-" + uuid.substring(0, 8)
                    logToFile("Fallback to UUID for device ID: $deviceId (truncated from $uuid)")
                }
            }
        } catch (e: Exception) {
            // If any error occurs, fall back to UUID
            val uuid = java.util.UUID.randomUUID().toString()
            deviceId = "padbot-" + uuid.substring(0, 8)
            logToFile("Exception getting MAC address, using UUID: ${e.message}")
            logToFile("Generated truncated UUID: $deviceId (from $uuid)")
            e.printStackTrace()
        }
        
        // Store whatever ID we generated
        deviceId = deviceId ?: "padbot-default-${System.currentTimeMillis().toString().substring(0, 8)}"
        sharedPreferences.edit().putString("unique_device_id", deviceId).apply()
        logToFile("Generated and saved new device ID: $deviceId")
        
        return deviceId
    }

    @ReactMethod
    fun getDeviceIdentifiers(promise: Promise) {
        scope.launch {
            try {
                val deviceId = getUniqueDeviceId()
                
                // Extract MAC address from device ID if possible
                var macAddress = ""
                if (deviceId.startsWith("padbot-")) {
                    macAddress = deviceId.substring(7) // Remove "padbot-" prefix
                }
                
                val result = Arguments.createMap().apply {
                    putString("deviceId", deviceId)
                    putString("macAddress", macAddress)
                }
                
                logToFile("Device identifiers retrieved: deviceId=$deviceId, macAddress=$macAddress")
                
                // Return on main thread
                withContext(Dispatchers.Main) {
                    promise.resolve(result)
                }
            } catch (e: Exception) {
                logToFile("Error getting device identifiers: ${e.message}")
                withContext(Dispatchers.Main) {
                    promise.reject("DEVICE_ID_ERROR", "Failed to get device identifiers: ${e.message}")
                }
            }
        }
    }
} 