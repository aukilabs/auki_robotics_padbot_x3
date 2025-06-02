package com.robotgui

import android.content.Context
import android.util.Log
import com.facebook.react.bridge.*
import kotlinx.coroutines.*
import org.json.JSONObject
import org.json.JSONArray
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
import java.text.SimpleDateFormat
import java.util.Date
import java.io.FileWriter
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.MultipartBody
import android.net.wifi.WifiManager
import java.net.NetworkInterface
import java.util.UUID

class DomainUtilsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val TAG = "DomainUtilsModule"
    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private val sharedPreferences = reactContext.getSharedPreferences("DomainAuth", Context.MODE_PRIVATE)
    private val STORAGE_PERMISSION_CODE = 1001
    //private val baseUrl = "https://dds.posemesh.org/api/v1/domains"
    private val baseUrl = "https://dds.auki.network/api/v1/domains"
    // Flag to prevent concurrent map downloads
    private val isDownloadingMap = AtomicBoolean(false)

    // Add singleton OkHttpClient at the top of the class
    private val httpClient: OkHttpClient by lazy { OkHttpClient() }

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
            putString("homedockQrId", sharedPreferences.getString("homedock_qr_id", ""))
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
    fun saveHomedockQrId(homedockQrId: String, promise: Promise) {
        sharedPreferences.edit().putString("homedock_qr_id", homedockQrId).apply()
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
                //val url1 = URL("https://api.posemesh.org/user/login")
                val url1 = URL("https://api.auki.network/user/login")
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
                    //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
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
                //val url2 = URL("https://api.posemesh.org/service/domains-access-token")
                val url2 = URL("https://api.auki.network/service/domains-access-token")
                logToFile("DDS authentication URL: $url2")
                
                val connection2 = url2.openConnection() as HttpURLConnection
                
                connection2.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $posemeshToken")
                    //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
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
                //val url3 = URL("https://dds.posemesh.org/api/v1/domains/$domainId/auth")
                val url3 = URL("https://dds.auki.network/api/v1/domains/$domainId/auth")
                logToFile("Domain authentication URL: $url3")
                
                val connection3 = url3.openConnection() as HttpURLConnection
                
                connection3.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $ddsToken")
                    //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
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
                //val url1 = URL("https://api.posemesh.org/user/login")
                val url1 = URL("https://api.auki.network/user/login")
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
                    //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
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
                //val url2 = URL("https://api.posemesh.org/service/domains-access-token")
                val url2 = URL("https://api.auki.network/service/domains-access-token")
                logToFile("DDS authentication URL: $url2")
                
                val connection2 = url2.openConnection() as HttpURLConnection
                
                connection2.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $posemeshToken")
                    //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
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
                //val url3 = URL("https://dds.posemesh.org/api/v1/domains/$domainId/auth")
                val url3 = URL("https://dds.auki.network/api/v1/domains/$domainId/auth")
                logToFile("Domain authentication URL: $url3")
                
                val connection3 = url3.openConnection() as HttpURLConnection
                
                connection3.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $ddsToken")
                    //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
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

    @ReactMethod
    fun authenticate(email: String?, password: String?, domainId: String?, promise: Promise) {
        scope.launch {
            try {
                val finalEmail = email ?: sharedPreferences.getString("email", "") ?: ""
                val finalPassword = password ?: sharedPreferences.getString("password", "") ?: ""
                val finalDomainId = domainId ?: sharedPreferences.getString("domain_id", "") ?: ""

                if (finalEmail.isEmpty() || finalPassword.isEmpty() || finalDomainId.isEmpty()) {
                    promise.reject("AUTH_ERROR", "Missing credentials")
                    return@launch
                }

                // 1. Auth User Posemesh
                //val url1 = URL("https://api.posemesh.org/user/login")
                val url1 = URL("https://api.auki.network/user/login")
                val connection1 = url1.openConnection() as HttpURLConnection
                
                val body1 = JSONObject().apply {
                    put("email", finalEmail)
                    put("password", finalPassword)
                }

                connection1.apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Accept", "application/json")
                    //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
                    doOutput = true
                    outputStream.write(body1.toString().toByteArray())
                }

                if (connection1.responseCode !in 200..299) {
                    promise.reject("AUTH_ERROR", "Failed to authenticate posemesh account")
                    return@launch
                }

                val response1 = connection1.inputStream.bufferedReader().readText()
                val repJson1 = JSONObject(response1)
                posemeshToken = repJson1.getString("access_token")

                // 2. Auth DDS
                //val url2 = URL("https://api.posemesh.org/service/domains-access-token")
                val url2 = URL("https://api.auki.network/service/domains-access-token")
                val connection2 = url2.openConnection() as HttpURLConnection
                
                connection2.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $posemeshToken")
                    //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
                }

                if (connection2.responseCode !in 200..299) {
                    promise.reject("AUTH_ERROR", "Failed to authenticate domain dds")
                    return@launch
                }

                val response2 = connection2.inputStream.bufferedReader().readText()
                val repJson2 = JSONObject(response2)
                ddsToken = repJson2.getString("access_token")

                // 3. Auth Domain
                //val url3 = URL("https://dds.posemesh.org/api/v1/domains/$finalDomainId/auth")
                val url3 = URL("https://dds.auki.network/api/v1/domains/$finalDomainId/auth")
                val connection3 = url3.openConnection() as HttpURLConnection
                
                connection3.apply {
                    requestMethod = "POST"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $ddsToken")
                    //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
                }

                if (connection3.responseCode !in 200..299) {
                    promise.reject("AUTH_ERROR", "Failed to authenticate domain access")
                    return@launch
                }

                val response3 = connection3.inputStream.bufferedReader().readText()
                domainInfo = response3

                // Parse domain info to get server URL
                val domainInfoObj = JSONObject(response3)
                val accessToken = domainInfoObj.getString("access_token")
                val domainServer = domainInfoObj.getString("domain_server")
                /*
                // After successful authentication, download the map in a separate coroutine
                scope.launch {
                    try {
                        Log.d(TAG, "Authentication successful, initiating map download...")
                        logToFile("Authentication successful, initiating map download...")
                        
                        // Only start the download if it's not already in progress
                        if (isDownloadingMap.compareAndSet(false, true)) {
                            try {
                                // Download map directly without using Promise
                                downloadMapAfterAuth()
                            } finally {
                                // Always reset the flag when done
                                isDownloadingMap.set(false)
                            }
                        } else {
                            Log.d(TAG, "Map download already in progress, skipping duplicate request after authentication")
                            logToFile("Map download already in progress, skipping duplicate request after authentication")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error downloading map after authentication: ${e.message}", e)
                        logToFile("Error downloading map after authentication: ${e.message}")
                    }
                }*/

                // Return response with domain server URL
                val result = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putString("message", "Domain Server: $domainServer")
                }
                promise.resolve(result)

            } catch (e: Exception) {
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

                // Save the STCM file to Downloads directory based on app variant
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val appDirName = if (reactApplicationContext.resources.getString(R.string.app_variant) == "gotu") "GoTu" else "CactusAssistant"
                val appDir = File(downloadsDir, appDirName)
                if (!appDir.exists()) {
                    appDir.mkdirs()
                }

                // Use a simple filename without timestamp
                val stcmFile = File(appDir, "map.stcm")
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
    fun downloadAndProcessMap(promise: Promise) {
        scope.launch {
            try {
                Log.d(TAG, "Starting downloadAndProcessMap")
                // Check if a map download is already in progress
                if (isDownloadingMap.compareAndSet(false, true)) {
                    try {
                        // Call the existing method that downloads and processes the map
                        downloadMapAfterAuth()
                        Log.d(TAG, "Map download and processing completed successfully")
                        promise.resolve(true)
                    } finally {
                        // Always reset the flag when done, regardless of success or failure
                        isDownloadingMap.set(false)
                    }
                } else {
                    // A download is already in progress
                    Log.d(TAG, "Map download already in progress, skipping duplicate request")
                    logToFile("Map download already in progress, skipping duplicate request")
                    promise.resolve(true) // Resolve with success since another download is handling it
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error in downloadAndProcessMap: ${e.message}", e)
                promise.reject("MAP_ERROR", "Failed to download and process map: ${e.message}")
            }
        }
    }

    // Helper method to download map after authentication without using Promise
    private suspend fun downloadMapAfterAuth() {
        // Only proceed if no download is in progress (additional safety check)
        if (!isDownloadingMap.get()) {
            Log.d(TAG, "Skipping downloadMapAfterAuth as flag indicates no download should be in progress")
            logToFile("Skipping downloadMapAfterAuth as flag indicates no download should be in progress")
            return
        }
        
        try {
            Log.d(TAG, "Starting downloadMapAfterAuth process")
            logToFile("Starting downloadMapAfterAuth process")
            val domainId = sharedPreferences.getString("domain_id", "") ?: ""
            val domainInfoStr = domainInfo ?: throw Exception("No domain info available")
            val domainInfoObj = JSONObject(domainInfoStr)
            val accessToken = domainInfoObj.getString("access_token")
            val domainServerObj = domainInfoObj.getJSONObject("domain_server")
            val domainServerUrl = domainServerObj.getString("url")

            // Get map endpoint from config
            val url = ConfigManager.getNestedString("domain.map_endpoint")
            Log.d(TAG, "Using map endpoint: $url")
            logToFile("Using map endpoint: $url")

            val client = OkHttpClient()
            
            val requestBody = JSONObject().apply {
                put("domainId", domainId)
                put("domainServerUrl", domainServerUrl)
                put("height", 0.1)
                put("fileType", "stcm")  // Request STCM format
                put("pixelsPerMeter", 20)
            }

            Log.d(TAG, "Sending map request: ${requestBody.toString()}")
            logToFile("Sending map request: ${requestBody.toString()}")

            val mediaType = "application/json".toMediaType()
            val request = Request.Builder()
                .url(url)
                .post(requestBody.toString().toRequestBody(mediaType))
                .addHeader("Authorization", "Bearer $accessToken")
                .build()

            Log.d(TAG, "Executing map download request")
            logToFile("Executing map download request")
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                val errorBody = response.body?.string() ?: "No error body"
                val errorMsg = "Failed to download map: ${response.code}\nRequest Body: ${requestBody.toString()}\nError Body: $errorBody"
                Log.e(TAG, errorMsg)
                logToFile(errorMsg)
                throw Exception(errorMsg)
            }

            // Get content type to determine how to process the response
            val contentType = response.header("Content-Type", "")
            Log.d(TAG, "Response content type: $contentType")
            logToFile("Response content type: $contentType")

            var stcmData: ByteArray? = null

            if (contentType?.contains("multipart/form-data") == true) {
                // Handle multipart response
                val responseBody = response.body?.string() ?: throw Exception("Empty response body")
                Log.d(TAG, "Processing multipart/form-data response")
                logToFile("Processing multipart/form-data response")
                
                // Get the boundary from the Content-Type header
                val boundaryPattern = Pattern.compile("boundary=([^;\\s]+)")
                val boundaryMatcher = boundaryPattern.matcher(contentType)
                if (!boundaryMatcher.find()) {
                    val errorMsg = "Could not find boundary in Content-Type header"
                    Log.e(TAG, errorMsg)
                    logToFile(errorMsg)
                    throw Exception(errorMsg)
                }
                val boundary = "--${boundaryMatcher.group(1)}"
                Log.d(TAG, "Found boundary: $boundary")
                logToFile("Found boundary: $boundary")
                
                // Split the data using the boundary marker
                val parts = responseBody.split(boundary)
                Log.d(TAG, "Split response into ${parts.size} parts")
                logToFile("Split response into ${parts.size} parts")
                
                // Find the part containing the STCM data
                for (part in parts) {
                    if (part.contains("name=\"img\"")) {
                        Log.d(TAG, "Found img part in multipart response")
                        logToFile("Found img part in multipart response")
                        val headerEnd = part.indexOf("\r\n\r\n")
                        if (headerEnd > 0) {
                            // Extract the base64 encoded data after the header
                            val base64Data = part.substring(headerEnd + 4).trim()
                            Log.d(TAG, "Extracted base64 data of length: ${base64Data.length}")
                            logToFile("Extracted base64 data of length: ${base64Data.length}")
                            
                            // Clean up any whitespace or newlines that might be in the base64 string
                            val cleanBase64 = base64Data.replace("\\s+".toRegex(), "")
                            
                            // Decode the base64 data
                            stcmData = Base64.decode(cleanBase64, Base64.DEFAULT)
                            Log.d(TAG, "Successfully decoded ${cleanBase64.length} bytes of base64 data to ${stcmData.size} bytes of binary STCM data")
                            logToFile("Successfully decoded ${cleanBase64.length} bytes of base64 data to ${stcmData.size} bytes of binary STCM data")
                            break
                        }
                    }
                }
            } else {
                // If not multipart, assume the entire content is the STCM data
                stcmData = response.body?.bytes()
                Log.d(TAG, "Received ${stcmData?.size ?: 0} bytes of raw STCM data")
                logToFile("Received ${stcmData?.size ?: 0} bytes of raw STCM data")
            }

            if (stcmData == null) {
                val errorMsg = "Failed to extract STCM data from response"
                Log.e(TAG, errorMsg)
                logToFile(errorMsg)
                throw Exception(errorMsg)
            }

            // Save the STCM file to Downloads directory based on app variant
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val appDirName = if (reactApplicationContext.resources.getString(R.string.app_variant) == "gotu") "GoTu" else "CactusAssistant"
            val appDir = File(downloadsDir, appDirName)
            if (!appDir.exists()) {
                appDir.mkdirs()
                Log.d(TAG, "Created $appDirName directory in Downloads folder")
                logToFile("Created $appDirName directory in Downloads folder")
            }

            // Use a simple filename without timestamp
            val stcmFile = File(appDir, "map.stcm")
            stcmFile.writeBytes(stcmData)
            Log.d(TAG, "STCM map saved to: ${stcmFile.absolutePath}")
            logToFile("STCM map saved to: ${stcmFile.absolutePath}")
            
            // Now perform the additional steps after downloading the map
            try {
                val slamIp = ConfigManager.getString("slam_ip", "127.0.0.1")
                val slamPort = ConfigManager.getInt("slam_port", 1448)
                val baseUrl = "http://$slamIp:$slamPort"
                Log.d(TAG, "Using SLAM API base URL: $baseUrl")
                logToFile("Using SLAM API base URL: $baseUrl")
                
                // Step 1: Housekeeping - clear old data
                Log.d(TAG, "Clearing old POIs and map data")
                logToFile("Clearing old POIs and map data")
                clearPOIs(baseUrl)
                clearMap(baseUrl)
                
                // Step 2: Upload the new map
                Log.d(TAG, "Uploading new map: ${stcmFile.absolutePath}")
                logToFile("Uploading new map: ${stcmFile.absolutePath}")
                uploadMap(baseUrl, stcmFile.absolutePath)
                
                // Step 3: Update Homedock location using the same process as the GetPose button
                try {
                    // Get the homedock QR ID from stored preferences
                    val homedockQrId = sharedPreferences.getString("homedock_qr_id", "")
                    if (!homedockQrId.isNullOrEmpty()) {
                        Log.d(TAG, "Found homedock_qr_id: $homedockQrId, getting pose data")
                        logToFile("Found homedock_qr_id: $homedockQrId, getting pose data")
                        
                        // Use the same method as GetPose button to retrieve the pose data
                        val poseData = getHomedockPoseFromQrId(homedockQrId)
                        
                        if (poseData != null) {
                            val px = poseData.getDouble("px")
                            val py = poseData.getDouble("py")
                            val pz = poseData.getDouble("pz")
                            val yaw = poseData.getDouble("yaw")
                            
                            Log.d(TAG, "Setting home dock from QR data: x=$px, y=$py, z=$pz, yaw=$yaw")
                            logToFile("Setting home dock from QR data: x=$px, y=$py, z=$pz, yaw=$yaw")
                            clearHomeDocks(baseUrl)
                            setHomeDock(baseUrl, px, py, pz, yaw, 0.0, 0.0)
                            
                            // Step 4: Update robot pose based on Homedock
                            val pose = calculatePose(doubleArrayOf(px, py, pz, yaw, 0.0, 0.0))
                            Log.d(TAG, "Setting robot pose from QR data: x=${pose[0]}, y=${pose[1]}, z=${pose[2]}, yaw=${pose[3]}")
                            logToFile("Setting robot pose from QR data: x=${pose[0]}, y=${pose[1]}, z=${pose[2]}, yaw=${pose[3]}")
                            setPose(baseUrl, pose[0], pose[1], pose[2], pose[3], pose[4], pose[5])
                        } else {
                            Log.d(TAG, "Failed to get pose data from QR ID, falling back to config")
                            logToFile("Failed to get pose data from QR ID, falling back to config")
                            fallbackToConfigHomedock(baseUrl)
                        }
                    } else {
                        Log.d(TAG, "No homedock_qr_id found, falling back to config")
                        logToFile("No homedock_qr_id found, falling back to config")
                        fallbackToConfigHomedock(baseUrl)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error setting home dock from QR ID: ${e.message}", e)
                    logToFile("Error setting home dock from QR ID: ${e.message}, falling back to config")
                    fallbackToConfigHomedock(baseUrl)
                }
                
                // Step 5: Ensure map is persistent
                Log.d(TAG, "Saving persistent map")
                logToFile("Saving persistent map")
                savePersistentMap(baseUrl)
                
                Log.d(TAG, "Map processing completed successfully")
                logToFile("Map processing completed successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Error during map processing steps: ${e.message}", e)
                logToFile("Error during map processing steps: ${e.message}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error downloading map after authentication", e)
            logToFile("Error downloading map after authentication: ${e.message}")
        }
    }
    
    // Add helper methods for storing/retrieving homedock data in SharedPreferences
    private fun saveHomedockData(x: Double, y: Double, z: Double, yaw: Double, pitch: Double, roll: Double) {
        sharedPreferences.edit()
            .putFloat("homedock_x", x.toFloat())
            .putFloat("homedock_y", y.toFloat())
            .putFloat("homedock_z", z.toFloat())
            .putFloat("homedock_yaw", yaw.toFloat())
            .putFloat("homedock_pitch", pitch.toFloat())
            .putFloat("homedock_roll", roll.toFloat())
            .putLong("homedock_saved_time", System.currentTimeMillis())
            .apply()
        logToFile("Saved homedock data to preferences: x=$x, y=$y, z=$z, yaw=$yaw")
    }
    
    private fun getStoredHomedockData(): DoubleArray? {
        // Check if we have stored homedock data
        if (!sharedPreferences.contains("homedock_x")) {
            return null
        }
        
        return doubleArrayOf(
            sharedPreferences.getFloat("homedock_x", 0f).toDouble(),
            sharedPreferences.getFloat("homedock_y", 0f).toDouble(),
            sharedPreferences.getFloat("homedock_z", 0f).toDouble(),
            sharedPreferences.getFloat("homedock_yaw", 0f).toDouble(),
            sharedPreferences.getFloat("homedock_pitch", 0f).toDouble(),
            sharedPreferences.getFloat("homedock_roll", 0f).toDouble()
        )
    }

    // Modify getHomedockPoseFromQrId to save the pose when successful
    private suspend fun getHomedockPoseFromQrId(qrId: String): WritableMap? {
        try {
            Log.d(TAG, "Getting pose data for QR ID: $qrId")
            logToFile("Getting pose data for QR ID: $qrId")
            
            // Get the domain ID and domain server from stored credentials/auth
            val domainId = sharedPreferences.getString("domain_id", "") ?: ""
            if (domainId.isEmpty()) {
                Log.d(TAG, "Missing domain ID")
                logToFile("Missing domain ID")
                return null
            }
            
            // Get domain info to extract the domain server URL
            val domainInfoStr = domainInfo ?: return null
            val domainInfoObj = JSONObject(domainInfoStr)
            val domainServerObj = domainInfoObj.getJSONObject("domain_server")
            val domainServer = domainServerObj.getString("url")
            val accessToken = domainInfoObj.getString("access_token")
            
            Log.d(TAG, "Fetching lighthouse data for QR ID: $qrId from domain server: $domainServer")
            logToFile("Fetching lighthouse data for QR ID: $qrId from domain server: $domainServer")
            
            // Construct the lighthouses endpoint URL
            val url = URL("$domainServer/api/v1/domains/$domainId/lighthouses")
            
            // Set up the connection
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $accessToken")
            
            val responseCode = connection.responseCode
            Log.d(TAG, "Get lighthouses response code: $responseCode")
            logToFile("Get lighthouses response code: $responseCode")
            
            if (responseCode !in 200..299) {
                Log.e(TAG, "Failed to get lighthouse data, response code: $responseCode")
                logToFile("Failed to get lighthouse data, response code: $responseCode")
                return null
            }
            
            // Read the full response
            val responseText = connection.inputStream.bufferedReader().readText()
            
            // Find the matching lighthouse by short_id
            val matchingLighthouse = findLighthouseByShortId(responseText, qrId)
            
            if (matchingLighthouse == null) {
                Log.d(TAG, "No lighthouse found with short_id: $qrId")
                logToFile("No lighthouse found with short_id: $qrId")
                return null
            }
            
            // Get original position values
            val px = matchingLighthouse.optDouble("px", 0.0)
            val py = matchingLighthouse.optDouble("py", 0.0)
            val pz = matchingLighthouse.optDouble("pz", 0.0)
            
            // Get original rotation values (quaternion)
            val rx = matchingLighthouse.optDouble("rx", 0.0)
            val ry = matchingLighthouse.optDouble("ry", 0.0)
            val rz = matchingLighthouse.optDouble("rz", 0.0)
            val rw = matchingLighthouse.optDouble("rw", 0.0)
            
            // Step 1 & 2: Swap py and pz, then invert the new py (which was pz)
            val transformedPy = -pz  // Swap and invert
            val transformedPz = py   // Just swap
            
            // Step 3: Convert quaternion to yaw
            val yaw = quaternionToYaw(rx, ry, rz, rw)
            
            // Log the transformation
            Log.d(TAG, "Transformed coordinates: Original (px=$px, py=$py, pz=$pz) -> Transformed (px=$px, py=$transformedPy, pz=$transformedPz)")
            Log.d(TAG, "Converted quaternion (rx=$rx, ry=$ry, rz=$rz, rw=$rw) -> yaw=$yaw")
            logToFile("Transformed coordinates: Original (px=$px, py=$py, pz=$pz) -> Transformed (px=$px, py=$transformedPy, pz=$transformedPz)")
            logToFile("Converted quaternion (rx=$rx, ry=$ry, rz=$rz, rw=$rw) -> yaw=$yaw")
            
            // Store the homedock data in SharedPreferences for future use
            saveHomedockData(px, transformedPy, transformedPz, yaw, 0.0, 0.0)
            
            // Create the result object
            val result = Arguments.createMap().apply {
                putDouble("px", px)
                putDouble("py", transformedPy)
                putDouble("pz", transformedPz)
                putDouble("yaw", yaw)
                putString("short_id", qrId)
            }
            
            return result
        } catch (e: Exception) {
            Log.e(TAG, "Error getting homedock pose from QR ID", e)
            logToFile("Error getting homedock pose from QR ID")
            return null
        }
    }
    
    // Update fallbackToConfigHomedock to use SharedPreferences instead of config.yaml
    private fun fallbackToConfigHomedock(baseUrl: String) {
        try {
            // Try to get homedock from SharedPreferences
            val storedHomedock = getStoredHomedockData()
            
            if (storedHomedock != null) {
                // Use stored homedock from SharedPreferences
                Log.d(TAG, "Setting home dock from stored preferences: x=${storedHomedock[0]}, y=${storedHomedock[1]}, z=${storedHomedock[2]}, yaw=${storedHomedock[3]}")
                logToFile("Setting home dock from stored preferences: x=${storedHomedock[0]}, y=${storedHomedock[1]}, z=${storedHomedock[2]}, yaw=${storedHomedock[3]}")
                clearHomeDocks(baseUrl)
                setHomeDock(baseUrl, storedHomedock[0], storedHomedock[1], storedHomedock[2], storedHomedock[3], storedHomedock[4], storedHomedock[5])
                
                // Update robot pose based on Homedock
                val pose = calculatePose(storedHomedock)
                Log.d(TAG, "Setting robot pose from stored prefs: x=${pose[0]}, y=${pose[1]}, z=${pose[2]}, yaw=${pose[3]}")
                logToFile("Setting robot pose from stored prefs: x=${pose[0]}, y=${pose[1]}, z=${pose[2]}, yaw=${pose[3]}")
                setPose(baseUrl, pose[0], pose[1], pose[2], pose[3], pose[4], pose[5])
            } else {
                Log.e(TAG, "No valid homedock data available in preferences")
                logToFile("No valid homedock data available in preferences")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error setting homedock from stored data", e)
            logToFile("Error setting homedock from stored data")
        }
    }

    private fun clearPOIs(baseUrl: String) {
        try {
            val url = URL("$baseUrl/api/core/artifact/v1/pois")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "DELETE"
            val responseCode = connection.responseCode
            Log.d(TAG, "Clear POIs response code: $responseCode")
            logToFile("Clear POIs response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing POIs: ${e.message}", e)
            logToFile("Error clearing POIs: ${e.message}")
        }
    }
    
    private fun clearMap(baseUrl: String) {
        try {
            val url = URL("$baseUrl/api/core/slam/v1/maps")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "DELETE"
            val responseCode = connection.responseCode
            Log.d(TAG, "Clear map response code: $responseCode")
            logToFile("Clear map response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing map: ${e.message}", e)
            logToFile("Error clearing map: ${e.message}")
        }
    }
    
    private fun uploadMap(baseUrl: String, filePath: String) {
        try {
            val file = File(filePath)
            if (!file.exists()) {
                Log.e(TAG, "Map file does not exist: $filePath")
                logToFile("Map file does not exist: $filePath")
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
                    logToFile("Uploaded $totalBytes bytes")
                }
            }
            
            val responseCode = connection.responseCode
            Log.d(TAG, "Upload map response code: $responseCode")
            logToFile("Upload map response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error uploading map: ${e.message}", e)
            logToFile("Error uploading map: ${e.message}")
        }
    }
    
    private fun clearHomeDocks(baseUrl: String) {
        try {
            val url = URL("$baseUrl/api/core/slam/v1/homedocks")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "DELETE"
            val responseCode = connection.responseCode
            Log.d(TAG, "Clear home docks response code: $responseCode")
            logToFile("Clear home docks response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing home docks: ${e.message}", e)
            logToFile("Error clearing home docks: ${e.message}")
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
            logToFile("Set home dock response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error setting home dock: ${e.message}", e)
            logToFile("Error setting home dock: ${e.message}")
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
            logToFile("Set pose response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error setting pose: ${e.message}", e)
            logToFile("Error setting pose: ${e.message}")
        }
    }
    
    private fun savePersistentMap(baseUrl: String) {
        try {
            // Updated endpoint and method based on Python example
            val url = URL("$baseUrl/api/multi-floor/map/v1/stcm/:save")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/octet-stream")
            
            val responseCode = connection.responseCode
            Log.d(TAG, "Save persistent map response code: $responseCode")
            logToFile("Save persistent map response code: $responseCode")
        } catch (e: Exception) {
            Log.e(TAG, "Error saving persistent map: ${e.message}", e)
            logToFile("Error saving persistent map: ${e.message}")
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
            //val url1 = URL("https://api.posemesh.org/user/login")
            val url1 = URL("https://api.auki.network/user/login")
            val connection1 = url1.openConnection() as HttpURLConnection
            
            val body1 = JSONObject().apply {
                put("email", email)
                put("password", password)
            }

            connection1.apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
                //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
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
            //val url2 = URL("https://api.posemesh.org/service/domains-access-token")
            val url2 = URL("https://api.auki.network/service/domains-access-token")
            val connection2 = url2.openConnection() as HttpURLConnection
            
            connection2.apply {
                requestMethod = "POST"
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $posemeshToken")
                //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
            }

            if (connection2.responseCode !in 200..299) {
                Log.e(TAG, "Failed to authenticate domain dds")
                return null
            }

            val response2 = connection2.inputStream.bufferedReader().readText()
            val repJson2 = JSONObject(response2)
            val ddsToken = repJson2.getString("access_token")

            // 3. Auth Domain
            //val url3 = URL("https://dds.posemesh.org/api/v1/domains/$domainId/auth")
            val url3 = URL("https://dds.auki.network/api/v1/domains/$domainId/auth")
            val connection3 = url3.openConnection() as HttpURLConnection
            
            connection3.apply {
                requestMethod = "POST"
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $ddsToken")
                //setRequestProperty("posemesh-client-id", getUniqueDeviceId())
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

    // Add this helper method for logging to file
    private fun logToFile(message: String) {
        try {
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val appDirName = if (reactApplicationContext.resources.getString(R.string.app_variant) == "gotu") "GoTu" else "CactusAssistant"
            val appDir = File(downloadsDir, appDirName)
            if (!appDir.exists()) {
                appDir.mkdirs()
            }
            val logFile = File(appDir, "debug_log.txt")
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

    // Add more domain-specific methods here

    @ReactMethod
    fun getRobotPose(promise: Promise) {
        scope.launch {
            try {
                // Get base URL and config for the robot
                val slamIp = ConfigManager.getString("slam_ip", "127.0.0.1")
                val slamPort = ConfigManager.getInt("slam_port", 1448)
                val baseUrl = "http://$slamIp:$slamPort"
                
                logToFile("Fetching robot pose data from $baseUrl")
                
                // 1. Get robot pose information from SLAM API
                val url = URL("$baseUrl/api/core/slam/v1/localization/pose")
                val connection = url.openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.setRequestProperty("Accept", "application/json")
                
                val responseCode = connection.responseCode
                logToFile("Get robot pose response code: $responseCode")
                
                if (responseCode !in 200..299) {
                    throw Exception("Failed to get robot pose, response code: $responseCode")
                }
                
                val responseText = connection.inputStream.bufferedReader().readText()
                logToFile("FULL RESPONSE: $responseText")
                
                // 2. Parse the response JSON
                val responseJson = JSONObject(responseText)
                
                // 3. Extract home dock QR ID if available (this will depend on the actual API response format)
                // For this example, we're assuming the QR ID is in a field called "qr_id" or similar
                val homedockQrId = if (responseJson.has("qr_id")) {
                    responseJson.getString("qr_id")
                } else {
                    // If the API doesn't directly provide QR ID, you may need to fetch it from a different endpoint
                    // or derive it from other data. For this example, we'll use a placeholder approach
                    
                    // Attempt to get QR ID from home dock information
                    val homedockUrl = URL("$baseUrl/api/core/slam/v1/homepose")
                    val homedockConnection = homedockUrl.openConnection() as HttpURLConnection
                    homedockConnection.requestMethod = "GET"
                    homedockConnection.setRequestProperty("Accept", "application/json")
                    
                    val homedockResponseCode = homedockConnection.responseCode
                    logToFile("Get homedock response code: $homedockResponseCode")
                    
                    if (homedockResponseCode in 200..299) {
                        val homedockResponse = homedockConnection.inputStream.bufferedReader().readText()
                        logToFile("FULL HOMEDOCK RESPONSE: $homedockResponse")
                        
                        val homedockJson = JSONObject(homedockResponse)
                        if (homedockJson.has("qr_id")) {
                            homedockJson.getString("qr_id")
                        } else {
                            // Generate a placeholder QR ID based on the home dock position
                            // This is just for demo purposes - in a real implementation, you would
                            // get this from the proper API or database
                            val x = homedockJson.optDouble("x", 0.0).toString().replace(".", "")
                            val y = homedockJson.optDouble("y", 0.0).toString().replace(".", "")
                            "QR${x}${y}"
                        }
                    } else {
                        // A fallback if we can't get the home dock info either
                        val storedQrId = sharedPreferences.getString("homedock_qr_id", "")
                        storedQrId ?: ""
                    }
                }
                
                // 4. Create the result object to return to React Native
                val result = Arguments.createMap().apply {
                    // Include the full pose data
                    putDouble("x", responseJson.optDouble("x", 0.0))
                    putDouble("y", responseJson.optDouble("y", 0.0))
                    putDouble("z", responseJson.optDouble("z", 0.0))
                    putDouble("yaw", responseJson.optDouble("yaw", 0.0))
                    putDouble("pitch", responseJson.optDouble("pitch", 0.0))
                    putDouble("roll", responseJson.optDouble("roll", 0.0))
                    
                    // Include the QR ID
                    putString("qrId", homedockQrId)
                    
                    // Include the raw response data
                    putString("rawData", responseText)
                }
                
                // Log the filtered response with the QR ID
                logToFile("FILTERED RESPONSE: QR ID = $homedockQrId, x=${responseJson.optDouble("x", 0.0)}, y=${responseJson.optDouble("y", 0.0)}, z=${responseJson.optDouble("z", 0.0)}")
                
                promise.resolve(result)
                
            } catch (e: Exception) {
                Log.e(TAG, "Error getting robot pose", e)
                logToFile("Error getting robot pose: ${e.message}")
                promise.reject("GET_POSE_ERROR", "Failed to get robot pose: ${e.message}")
            }
        }
    }

    @ReactMethod
    fun getPoseDataByQrId(qrId: String, promise: Promise) {
        scope.launch {
            try {
                // Get the domain ID and domain server from stored credentials/auth
                val domainId = sharedPreferences.getString("domain_id", "") ?: ""
                if (domainId.isEmpty()) {
                    throw Exception("Missing domain ID. Please authenticate first.")
                }
                
                // Get domain info to extract the domain server URL
                val domainInfoStr = domainInfo ?: throw Exception("No domain info available. Please authenticate first.")
                val domainInfoObj = JSONObject(domainInfoStr)
                val domainServerObj = domainInfoObj.getJSONObject("domain_server")
                val domainServer = domainServerObj.getString("url")
                val accessToken = domainInfoObj.getString("access_token")
                
                logToFile("Fetching lighthouse data for QR ID (short_id): $qrId from domain server: $domainServer")
                
                // Construct the lighthouses endpoint URL
                val url = URL("$domainServer/api/v1/domains/$domainId/lighthouses")
                logToFile("Lighthouses endpoint URL: $url")
                
                // Set up the connection
                val connection = url.openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.setRequestProperty("Accept", "application/json")
                connection.setRequestProperty("Authorization", "Bearer $accessToken")
                
                val responseCode = connection.responseCode
                
                if (responseCode !in 200..299) {
                    val errorMessage = if (responseCode == 404) {
                        "Lighthouse data not found (404). Domain ID may be incorrect."
                    } else {
                        "Failed to get lighthouse data, response code: $responseCode"
                    }
                    throw Exception(errorMessage)
                }
                
                // Read the full response
                val responseText = connection.inputStream.bufferedReader().readText()
                
                // Find the matching lighthouse by short_id
                val matchingLighthouse = findLighthouseByShortId(responseText, qrId)
                
                // Create the result object
                val result = Arguments.createMap().apply {
                    putBoolean("found", matchingLighthouse != null)
                    
                    if (matchingLighthouse != null) {
                        // Get original position values
                        val px = matchingLighthouse.optDouble("px", 0.0)
                        val py = matchingLighthouse.optDouble("py", 0.0)
                        val pz = matchingLighthouse.optDouble("pz", 0.0)
                        
                        // Get original rotation values (quaternion)
                        val rx = matchingLighthouse.optDouble("rx", 0.0)
                        val ry = matchingLighthouse.optDouble("ry", 0.0)
                        val rz = matchingLighthouse.optDouble("rz", 0.0)
                        val rw = matchingLighthouse.optDouble("rw", 0.0)
                        
                        // Step 1 & 2: Swap py and pz, then invert the new py (which was pz)
                        val transformedPy = -pz  // Swap and invert
                        val transformedPz = py   // Just swap
                        
                        // Step 3: Convert quaternion to yaw
                        val yaw = quaternionToYaw(rx, ry, rz, rw)
                        
                        // Log the transformation
                        logToFile("Transforming coordinates: Original (px=$px, py=$py, pz=$pz) -> Transformed (px=$px, py=$transformedPy, pz=$transformedPz)")
                        logToFile("Converting quaternion (rx=$rx, ry=$ry, rz=$rz, rw=$rw) -> yaw=$yaw")
                        
                        // Include the transformed lighthouse data
                        putDouble("px", px)
                        putDouble("py", transformedPy)
                        putDouble("pz", transformedPz)
                        putDouble("yaw", yaw)
                        
                        // Include original values for reference
                        putDouble("original_px", px)
                        putDouble("original_py", py)
                        putDouble("original_pz", pz)
                        putDouble("original_rx", rx)
                        putDouble("original_ry", ry)
                        putDouble("original_rz", rz)
                        putDouble("original_rw", rw)
                        
                        // Include additional lighthouse information
                        putString("id", matchingLighthouse.optString("id", ""))
                        putString("short_id", matchingLighthouse.optString("short_id", ""))
                    } else {
                        // Include default values if no match found
                        putDouble("px", 0.0)
                        putDouble("py", 0.0)
                        putDouble("pz", 0.0)
                        putDouble("yaw", 0.0)
                    }
                    
                    // Include the QR ID we searched for
                    putString("qrId", qrId)
                    
                    // Include the raw response data
                    putString("rawData", responseText)
                }
                
                // Log the filtered result
                if (matchingLighthouse != null) {
                    logToFile("FILTERED RESULT: Found lighthouse data for short_id: $qrId")
                    logToFile("Transformed lighthouse details: px=${result.getDouble("px")}, py=${result.getDouble("py")}, " +
                             "pz=${result.getDouble("pz")}, yaw=${result.getDouble("yaw")}")
                } else {
                    logToFile("FILTERED RESULT: No lighthouse data found for short_id: $qrId")
                }
                
                promise.resolve(result)
                
            } catch (e: Exception) {
                Log.e(TAG, "Error getting lighthouse data by QR ID", e)
                logToFile("Error getting lighthouse data by QR ID: ${e.message}")
                promise.reject("GET_LIGHTHOUSE_ERROR", "Failed to get lighthouse data: ${e.message}")
            }
        }
    }
    
    // Helper function to convert quaternion to yaw (-π to π)
    private fun quaternionToYaw(x: Double, y: Double, z: Double, w: Double): Double {
        // Calculate yaw (rotation around Y axis) from quaternion
        // Formula: atan2(2 * (w*y + x*z), 1 - 2 * (y*y + x*x))
        
        var yaw = Math.atan2(2.0 * (w * y + x * z), 1.0 - 2.0 * (y * y + x * x))
        
        // Rotate 180 degrees (add π radians)
        yaw += Math.PI
        
        // Round to 2 decimal places
        yaw = Math.round(yaw * 100.0) / 100.0
        
        // Normalize to range [-π, π]
        while (yaw > Math.PI) {
            yaw -= 2 * Math.PI
        }
        while (yaw < -Math.PI) {
            yaw += 2 * Math.PI
        }
        
        return yaw
    }
    
    // Helper method to find a lighthouse by short_id in the JSON response
    private fun findLighthouseByShortId(responseJson: String, shortId: String): JSONObject? {
        try {
            val responseObj = JSONObject(responseJson)
            
            // Check if it's a direct array or an object with poses field
            if (responseObj.has("poses")) {
                // Handle object with poses array
                val posesArray = responseObj.getJSONArray("poses")
                logToFile("Found 'poses' field with ${posesArray.length()} items")
                
                for (i in 0 until posesArray.length()) {
                    val lighthouse = posesArray.getJSONObject(i)
                    val lighthouseShortId = lighthouse.optString("short_id", "")
                    
                    if (lighthouseShortId.equals(shortId, ignoreCase = true)) {
                        logToFile("Found matching lighthouse with short_id: $shortId")
                        return lighthouse
                    }
                }
                
                logToFile("No lighthouse found with matching short_id in 'poses' array")
            } else {
                // Try parsing as direct array
                try {
                    val lighthousesArray = JSONArray(responseJson)
                    logToFile("Response contains an array of ${lighthousesArray.length()} lighthouses")
                    
                    // Iterate through all lighthouses to find matching short_id
                    for (i in 0 until lighthousesArray.length()) {
                        val lighthouse = lighthousesArray.getJSONObject(i)
                        val lighthouseShortId = lighthouse.optString("short_id", "")
                        
                        if (lighthouseShortId.equals(shortId, ignoreCase = true)) {
                            logToFile("Found matching lighthouse with short_id: $shortId")
                            return lighthouse
                        }
                    }
                    
                    logToFile("No lighthouse found with matching short_id in array")
                } catch (e: Exception) {
                    logToFile("Response is not an array and does not contain a 'poses' field")
                }
            }
            
            return null
            
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing lighthouse data", e)
            logToFile("Error parsing lighthouse data")
            return null
        }
    }

    @ReactMethod
    fun getRobotCall(promise: Promise) {
        // Convenience method to fetch robot_call data
        fetchDomainData("robot_call", "robot_pose_json", promise)
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
                //logToFile("Writing robot call data with method: $method, data: $jsonData")
                
                // Create the multipart form data with data_id if provided
                val dataName = if (method == "PUT" && dataId != null) {
                    dataId  // Use the provided dataId for PUT operations
                } else {
                    "robot_call"  // Default name
                }
                val dataType = "robot_pose_json"
                
                //logToFile("Using name as dataName: $dataName")
                
                // Set up the multipart request body
                val requestBody = MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart(dataName, null, 
                        RequestBody.create("application/octet-stream".toMediaType(), jsonData))
                    .build()
                
                // API endpoint URL
                val url = "$domainServerUrl/api/v1/domains/$domainId/data?data_type=$dataType"
                Log.d(TAG, "Sending $method request to: $url")
                //logToFile("Sending $method request to: $url")
                
                // Create and execute the request
                val client = httpClient
                val request = Request.Builder()
                    .url(url)
                    .method(method, requestBody)
                    .addHeader("Authorization", "Bearer $accessToken")
                    .build()
                
                val response = client.newCall(request).execute()
                val responseCode = response.code
                //logToFile("Robot call write response code: $responseCode")
                
                if (!response.isSuccessful) {
                    throw Exception("Failed to write robot call data: $responseCode")
                }
                
                val responseBody = response.body?.string()
                logToFile("Robot call write response: $responseBody")
                
                // Parse the response and create a map
                val responseObj = JSONObject(responseBody ?: "{}")
                val result = Arguments.createMap().apply {
                    putString("id", responseObj.optString("id", null))
                    putString("status", responseObj.optString("status", null))
                    putString("timestamp", responseObj.optString("timestamp", null))
                }
                
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "Error in writeRobotCall: ${e.message}", e)
                //logToFile("Error in writeRobotCall: ${e.message}")
                promise.reject("ROBOT_CALL_ERROR", "Error writing robot call data: ${e.message}")
            }
        }
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
    fun getDomainInfo(promise: Promise) {
        if (domainInfo.isNullOrEmpty()) {
            promise.reject("DOMAIN_INFO_ERROR", "Domain info not available")
            return
        }
        promise.resolve(domainInfo)
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
                
                // Step 1: Get metadata
                val metadataUrl = "$domainServerUrl/api/v1/domains/$domainId/data?name=$name&data_type=$dataType"
                val client = httpClient
                val metadataRequest = okhttp3.Request.Builder()
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
                // Step 2: Get actual data using metadata ID
                val dataUrl = "$domainServerUrl/api/v1/domains/$domainId/data/$metadataId?raw=1"
                val dataRequest = okhttp3.Request.Builder()
                    .url(dataUrl)
                    .addHeader("Authorization", "Bearer $accessToken")
                    .addHeader("Accept", "multipart/form-data")
                    .build()
                val dataResponse = client.newCall(dataRequest).execute()
                if (!dataResponse.isSuccessful) {
                    throw Exception("Failed to get data: ${dataResponse.code}")
                }
                val rawData = dataResponse.body?.string() ?: ""
                // Convert to React Native object
                val result = Arguments.createMap()
                val metadataMap = Arguments.createMap()
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

    private fun getUniqueDeviceId(): String {
        // First check if we already have a stored ID
        val storedId = sharedPreferences.getString("unique_device_id", null)
        if (storedId != null) {
            logToFile("Using existing stored device ID: $storedId")
            return storedId
        }

        logToFile("No existing device ID found, generating new ID")
        
        // Try to get MAC address
        var deviceId: String? = null
        
        try {
            // Check for permission
            if (reactApplicationContext.checkSelfPermission(android.Manifest.permission.ACCESS_WIFI_STATE) == PackageManager.PERMISSION_GRANTED) {
                val wifiManager = reactApplicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                val wifiInfo = wifiManager.connectionInfo
                val macAddress = wifiInfo.macAddress
                
                if (macAddress != null && macAddress != "02:00:00:00:00:00") {
                    deviceId = "padbot-${macAddress.replace(":", "")}"
                }
            } else {
                logToFile("ACCESS_WIFI_STATE permission not granted - requesting permission")
                // Request permission
                val activity = currentActivity
                if (activity != null) {
                    ActivityCompat.requestPermissions(
                        activity,
                        arrayOf(android.Manifest.permission.ACCESS_WIFI_STATE),
                        1001
                    )
                }
            }
        } catch (e: Exception) {
            logToFile("Exception getting MAC address, using UUID: ${e.message}")
        }
        
        // If MAC address failed, try network interfaces
        if (deviceId == null) {
            try {
                val networkInterfaces = NetworkInterface.getNetworkInterfaces()
                while (networkInterfaces.hasMoreElements()) {
                    val networkInterface = networkInterfaces.nextElement()
                    val macBytes = networkInterface.hardwareAddress
                    if (macBytes != null && macBytes.isNotEmpty()) {
                        val macAddress = macBytes.joinToString("") { "%02x".format(it) }
                        deviceId = "padbot-$macAddress"
                        break
                    }
                }
            } catch (e: Exception) {
                logToFile("Exception getting MAC from network interfaces: ${e.message}")
            }
        }
        
        // If all else fails, generate a UUID
        if (deviceId == null) {
            val uuid = UUID.randomUUID().toString()
            val truncatedUuid = uuid.substring(0, 8)
            deviceId = "padbot-$truncatedUuid"
            logToFile("Generated truncated UUID: $deviceId (from $uuid)")
        }
        
        // Store the ID for future use
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
                
                val client = httpClient
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
                //logToFile("Starting writeRobotPose with method: $method, dataId: $dataId")
                val domainInfoStr = domainInfo ?: throw Exception("No domain info available")
                val domainInfoObj = JSONObject(domainInfoStr)
                val accessToken = domainInfoObj.getString("access_token")
                val domainServerObj = domainInfoObj.getJSONObject("domain_server")
                val domainServerUrl = domainServerObj.getString("url")
                val domainId = domainInfoObj.getString("id")
                
                Log.d(TAG, "Writing robot pose data with method: $method, data: $jsonData")
                //logToFile("Writing robot pose data with method: $method, data: $jsonData")
                
                // Create the multipart form data with unique device ID or data ID
                val dataName = if (method == "PUT" && dataId != null) {
                    dataId
                } else {
                    getUniqueDeviceId()
                }
                val dataType = "reported_pose_json"
                
                //logToFile("Using name as dataName: $dataName")
                
                // Set up the multipart request body
                val requestBody = MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart(dataName, null, 
                        RequestBody.create("application/octet-stream".toMediaType(), jsonData))
                    .build()
                
                // API endpoint URL
                val url = "$domainServerUrl/api/v1/domains/$domainId/data?data_type=$dataType"
                Log.d(TAG, "Sending $method request to: $url")
                //logToFile("Sending $method request to: $url")
                
                // Create and execute the request
                val client = httpClient
                val request = Request.Builder()
                    .url(url)
                    .method(method, requestBody)
                    .addHeader("Authorization", "Bearer $accessToken")
                    .build()
                
                val response = client.newCall(request).execute()
                //logToFile("Write response code: ${response.code}")
                
                if (!response.isSuccessful) {
                    val errorMsg = "Failed to write robot pose data: ${response.code}"
                    logToFile(errorMsg)
                    throw Exception(errorMsg)
                }
                
                val responseBody = response.body?.string() ?: ""
                Log.d(TAG, "Write response: $responseBody")
                //logToFile("Write response: $responseBody")
                
                // Return success result
                val result = Arguments.createMap()
                result.putString("method", method)
                result.putString("formFieldName", dataName)
                result.putString("response", responseBody)
                
                // If this was a POST, try to extract the data_id from the response
                if (method == "POST") {
                    try {
                        val responseJson = JSONObject(responseBody)
                        if (responseJson.has("data")) {
                            val dataArray = responseJson.getJSONArray("data")
                            if (dataArray.length() > 0) {
                                val dataObj = dataArray.getJSONObject(0)
                                if (dataObj.has("id")) {
                                    val newDataId = dataObj.getString("id")
                                    result.putString("dataId", newDataId)
                                    logToFile("New data_id created: $newDataId")
                                }
                            }
                        }
                    } catch (e: Exception) {
                        logToFile("Could not parse data_id from response: ${e.message}")
                    }
                }
                
                //logToFile("writeRobotPose completed successfully")
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "Error writing robot pose data: ${e.message}", e)
                logToFile("Error writing robot pose data: ${e.message}")
                promise.reject("WRITE_POSE_ERROR", "Failed to write robot pose data: ${e.message}")
            }
        }
    }

    @ReactMethod
    fun getHomedockQrId(promise: Promise) {
        scope.launch {
            try {
                val homedockQrId = sharedPreferences.getString("homedock_qr_id", "")
                if (!homedockQrId.isNullOrEmpty()) {
                    Log.d(TAG, "Retrieved homedock_qr_id: $homedockQrId")
                    logToFile("Retrieved homedock_qr_id: $homedockQrId")
                    
                    // Get pose data for the QR ID
                    val poseData = getHomedockPoseFromQrId(homedockQrId)
                    
                    // Create result map with both QR ID and pose data
                    val result = Arguments.createMap().apply {
                        putString("qrId", homedockQrId)
                        if (poseData != null) {
                            putDouble("px", poseData.getDouble("px"))
                            putDouble("py", poseData.getDouble("py"))
                            putDouble("pz", poseData.getDouble("pz"))
                            putDouble("yaw", poseData.getDouble("yaw"))
                        } else {
                            // If no pose data found, return default values
                            putDouble("px", 0.0)
                            putDouble("py", 0.0)
                            putDouble("pz", 0.0)
                            putDouble("yaw", 0.0)
                        }
                    }
                    
                    promise.resolve(result)
                } else {
                    Log.d(TAG, "No homedock_qr_id found in preferences")
                    logToFile("No homedock_qr_id found in preferences")
                    
                    // Return empty result with default values
                    val result = Arguments.createMap().apply {
                        putString("qrId", "")
                        putDouble("px", 0.0)
                        putDouble("py", 0.0)
                        putDouble("pz", 0.0)
                        putDouble("yaw", 0.0)
                    }
                    promise.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error getting homedock QR ID and pose: ${e.message}", e)
                logToFile("Error getting homedock QR ID and pose: ${e.message}")
                promise.reject("GET_HOMEDOCK_QR_ID_ERROR", "Failed to get homedock QR ID and pose: ${e.message}")
            }
        }
    }
} 