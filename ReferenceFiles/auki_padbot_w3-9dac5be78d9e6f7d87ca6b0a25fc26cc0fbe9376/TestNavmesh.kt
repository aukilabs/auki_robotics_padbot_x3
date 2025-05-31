import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.atan2
import kotlin.math.abs

fun main() {
    // First authenticate and get domain info
    val domainInfo = getDomainInfo()
    if (domainInfo == null) {
        println("Failed to get domain info")
        return
    }

    val coords = mapOf(
        "x" to -6.77,
        "y" to 0.0,
        "z" to 0.60
    )
    testNavmeshCoord(coords, domainInfo)
}

fun getDomainInfo(): Map<String, String>? {
    try {
        // 1. Auth User Posemesh
        val url1 = URL("https://api.posemesh.org/user/login")
        val connection1 = url1.openConnection() as HttpURLConnection
        
        val loginBody = buildString {
            append("""
                {
                    "email": "robotics@aukilabs.com",
                    "password": "Yj0qtNacgeOZP4"
                }
            """.trimIndent())
        }

        println("Sending login request with body: $loginBody")

        connection1.apply {
            requestMethod = "POST"
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
            doOutput = true
            outputStream.write(loginBody.toByteArray())
        }

        val responseCode1 = connection1.responseCode
        println("Login response code: $responseCode1")

        if (responseCode1 !in 200..299) {
            val errorResponse = connection1.errorStream?.bufferedReader()?.readText() ?: "No error details available"
            println("Login error response: $errorResponse")
            println("Failed to authenticate posemesh account")
            return null
        }

        val response1 = connection1.inputStream.bufferedReader().readText()
        println("Login response: $response1")
        val posemeshToken = response1.substringAfter("\"access_token\":\"").substringBefore("\"")

        // 2. Auth DDS
        val url2 = URL("https://api.posemesh.org/service/domains-access-token")
        val connection2 = url2.openConnection() as HttpURLConnection
        
        connection2.apply {
            requestMethod = "POST"
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization", "Bearer $posemeshToken")
        }

        val responseCode2 = connection2.responseCode
        println("DDS auth response code: $responseCode2")

        if (responseCode2 !in 200..299) {
            val errorResponse = connection2.errorStream?.bufferedReader()?.readText() ?: "No error details available"
            println("DDS auth error response: $errorResponse")
            println("Failed to authenticate domain dds")
            return null
        }

        val response2 = connection2.inputStream.bufferedReader().readText()
        println("DDS auth response: $response2")
        val ddsToken = response2.substringAfter("\"access_token\":\"").substringBefore("\"")

        // 3. Auth Domain
        val domainId = "679705fe-c2c0-4ec8-9704-169dbb1957bc"
        val url3 = URL("https://dds.posemesh.org/api/v1/domains/$domainId/auth")
        val connection3 = url3.openConnection() as HttpURLConnection
        
        connection3.apply {
            requestMethod = "POST"
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization", "Bearer $ddsToken")
        }

        val responseCode3 = connection3.responseCode
        println("Domain auth response code: $responseCode3")

        if (responseCode3 !in 200..299) {
            val errorResponse = connection3.errorStream?.bufferedReader()?.readText() ?: "No error details available"
            println("Domain auth error response: $errorResponse")
            println("Failed to authenticate domain access")
            return null
        }

        val response3 = connection3.inputStream.bufferedReader().readText()
        println("Domain auth response: $response3")
        val accessToken = response3.substringAfter("\"access_token\":\"").substringBefore("\"")
        val navmeshEndpoint = "https://dsc.dev.aukiverse.com/spatial/restricttonavmesh"

        return mapOf(
            "access_token" to accessToken,
            "navmesh_endpoint" to navmeshEndpoint
        )

    } catch (e: Exception) {
        println("Error getting domain info: ${e.message}")
        return null
    }
}

fun testNavmeshCoord(coords: Map<String, Double>, domainInfo: Map<String, String>) {
    println("\nTesting with input coordinates: $coords")
    
    // Transform Z before sending
    val inputX = coords["x"]!!
    var inputZ = coords["z"]!!
    inputZ = if (inputZ > 0) -abs(inputZ) else abs(inputZ)
    
    println("Transformed coordinates for request: x=$inputX, z=$inputZ")

    val url = URL(domainInfo["navmesh_endpoint"])
    val connection = url.openConnection() as HttpURLConnection

    val body = buildString {
        append("""
            {
                "domainId": "679705fe-c2c0-4ec8-9704-169dbb1957bc",
                "domainServerUrl": "https://ap-east-1.domains.prod.aukiverse.com",
                "target": {
                    "x": $inputX,
                    "y": 0,
                    "z": $inputZ
                },
                "radius": 0.5
            }
        """.trimIndent())
    }

    println("\nRequest body: $body")
    
    connection.apply {
        requestMethod = "POST"
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Authorization", "Bearer ${domainInfo["access_token"]}")
        setRequestProperty("Accept", "application/json")
        doOutput = true
        outputStream.write(body.toByteArray())
    }
    
    val responseCode = connection.responseCode
    println("Response code: $responseCode")
    
    if (responseCode !in 200..299) {
        val errorResponse = connection.errorStream?.bufferedReader()?.readText() ?: "No error details available"
        println("Error response: $errorResponse")
        return
    }

    val response = connection.inputStream.bufferedReader().readText()
    println("Raw response: $response")
    
    // Parse response using string manipulation since we don't have JSONObject
    val responseStr = response.replace("\\s".toRegex(), "")
    val restrictedStr = responseStr.substringAfter("\"restricted\":{").substringBefore("}")
    val xMatch = "\"x\":([^,}]+)".toRegex().find(restrictedStr)?.groupValues?.get(1)?.toDoubleOrNull()
    val zMatch = "\"z\":([^,}]+)".toRegex().find(restrictedStr)?.groupValues?.get(1)?.toDoubleOrNull()
    
    if (xMatch == null || zMatch == null) {
        println("Failed to parse response coordinates")
        return
    }

    // Get coordinates exactly as in Python
    val x1 = inputX
    val z1 = inputZ
    val x2 = xMatch
    var z2 = zMatch

    // Calculate deltas exactly as in Python
    val deltaX = x1 - x2
    val deltaZ = z1 - z2

    // Transform z2 exactly as in Python
    z2 = if (z2 > 0) -abs(z2) else abs(z2)

    // Calculate yaw exactly as in DomainUtilsModule
    var yaw = atan2(deltaZ, deltaX)
    yaw = Math.round(yaw * 100.0) / 100.0  // Round to 2 decimal places using Math.round
    yaw = if (yaw > 0) -abs(yaw) else abs(yaw)

    val result = mapOf(
        "x" to x2,
        "z" to z2,
        "yaw" to yaw
    )
    
    println("\nCalculated result: $result")
    println("\nVerification:")
    println("Expected: x=-6.270300406695041, z=0.6000000413170843, yaw=-3.14")
    println("Got:      x=${result["x"]}, z=${result["z"]}, yaw=${result["yaw"]}")

    // Print intermediate values for debugging
    println("\nIntermediate values:")
    println("deltaX: $deltaX")
    println("deltaZ: $deltaZ")
    println("Initial yaw (atan2): ${atan2(deltaZ, deltaX)}")
    println("After rounding: ${Math.round(atan2(deltaZ, deltaX) * 100.0) / 100.0}")
    println("Final yaw: $yaw")
} 