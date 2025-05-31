# Promise Implementation Guide for Android Native Modules

## Important Notes

**CRITICAL:** When implementing the Promise interface in this project, you must follow the exact method signatures as shown below. Common errors include:

1. Using nullable String parameters (`String?`) for code when non-nullable (`String`) is required
2. Using incorrect parameter names (use `userInfo` not `map` for WritableMap parameters)
3. Using nullable WritableMap when non-nullable is required
4. Missing required method overrides

## Correct Method Signatures

When implementing a Promise interface in an anonymous object, you must include **ALL** of these methods with **EXACT** signatures:

```kotlin
override fun resolve(value: Any?) {
    // Handle success case
}

override fun reject(code: String, message: String?) {
    // Handle code and message
}

override fun reject(code: String, throwable: Throwable?) {
    // Handle code and throwable
}

override fun reject(code: String, message: String?, throwable: Throwable?) {
    // Handle code, message and throwable
}

override fun reject(throwable: Throwable) {
    // Handle throwable only
}

override fun reject(code: String) {
    // Handle code only
}

override fun reject(code: String, userInfo: WritableMap) {
    // Handle code and userInfo map
}

override fun reject(code: String, message: String?, userInfo: WritableMap) {
    // Handle code, message, and userInfo map
}

override fun reject(code: String, message: String?, throwable: Throwable?, userInfo: WritableMap) {
    // Handle code, message, throwable, and userInfo map
}

override fun reject(code: String, throwable: Throwable?, userInfo: WritableMap) {
    // Handle code, throwable, and userInfo map
}

override fun reject(throwable: Throwable, userInfo: WritableMap) {
    // Handle throwable and userInfo map
}
```

## Example Implementation

```kotlin
val promise = object : Promise {
    override fun resolve(value: Any?) {
        // Successfully completed
    }
    
    override fun reject(code: String, message: String?) {
        logToFile("Error: $code - $message")
    }
    
    override fun reject(code: String, throwable: Throwable?) {
        logToFile("Error: $code - ${throwable?.message}")
    }
    
    override fun reject(code: String, message: String?, throwable: Throwable?) {
        logToFile("Error: $code - $message - ${throwable?.message}")
    }
    
    override fun reject(throwable: Throwable) {
        logToFile("Error: ${throwable.message}")
    }
    
    override fun reject(code: String) {
        logToFile("Error: $code")
    }
    
    override fun reject(code: String, userInfo: WritableMap) {
        logToFile("Error: $code")
    }
    
    override fun reject(code: String, message: String?, userInfo: WritableMap) {
        logToFile("Error: $code - $message")
    }
    
    override fun reject(code: String, message: String?, throwable: Throwable?, userInfo: WritableMap) {
        logToFile("Error: $code - $message - ${throwable?.message}")
    }
    
    override fun reject(code: String, throwable: Throwable?, userInfo: WritableMap) {
        logToFile("Error: $code - ${throwable?.message}")
    }
    
    override fun reject(throwable: Throwable, userInfo: WritableMap) {
        logToFile("Error: ${throwable.message}")
    }
}
```

## Handling Promise in ReactMethod

When implementing a ReactMethod that takes a Promise parameter, use this pattern:

```kotlin
@ReactMethod
fun myAsyncMethod(param: String, promise: Promise) {
    scope.launch {
        try {
            // Do async work
            val result = doSomethingAsync(param)
            promise.resolve(result) // Resolve with result
        } catch (e: Exception) {
            // Reject with error information
            promise.reject("ERROR_CODE", "Error message: ${e.message}")
        }
    }
}
```

## Troubleshooting

Common build errors:

1. `Class '<anonymous>' is not abstract and does not implement abstract member 'reject'` - You're missing some required reject method implementations.

2. `'reject' overrides nothing` - Your method signature doesn't match any in the Promise interface. Check parameter types and names.

3. `None of the following candidates is applicable` - Your method parameters don't match the expected types. Check for non-nullable vs nullable issues (`String` vs `String?`, `WritableMap` vs `WritableMap?`).

4. If you see parameter name mismatches, ensure you're using `userInfo` for WritableMap parameters, not `map`.

Always refer to existing successful implementations in the project when creating new Promise objects. 

## Exact Signature Reference from Errors

From build errors, these are the exact expected signatures:

```kotlin
fun reject(code: String, message: String?): Unit
fun reject(code: String, throwable: Throwable?): Unit
fun reject(throwable: Throwable, userInfo: WritableMap): Unit  // Note: WritableMap is NOT nullable
fun reject(code: String, userInfo: WritableMap): Unit  // Note: WritableMap is NOT nullable

fun reject(code: String, message: String?, throwable: Throwable?): Unit
fun reject(code: String, throwable: Throwable?, userInfo: WritableMap): Unit  // Note: WritableMap is NOT nullable
fun reject(code: String, message: String?, userInfo: WritableMap): Unit  // Note: WritableMap is NOT nullable
``` 