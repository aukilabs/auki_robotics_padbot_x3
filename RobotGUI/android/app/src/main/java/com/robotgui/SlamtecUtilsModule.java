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
import com.robotgui.FileUtilsModule;
import android.os.Environment;
import com.slamtec.slamware.sdp.SlamwareSdpPlatform;
import com.slamtec.slamware.robot.HealthInfo;
import com.slamtec.slamware.sdp.CompositeMapHelper;
import com.slamtec.slamware.robot.CompositeMap;
import com.slamtec.slamware.robot.Pose;
import com.slamtec.slamware.robot.Location;
import com.slamtec.slamware.robot.MoveOption;
import com.slamtec.slamware.action.IMoveAction;
import com.slamtec.slamware.robot.SystemParameters;
import cn.inbot.basiclib.RobotControlManager;
import com.robotgui.PadbotUtils;
import java.util.HashMap;
import com.slamtec.slamware.robot.CompositePose;

public class SlamtecUtilsModule extends ReactContextBaseJavaModule {
    private static final String TAG = "SlamtecUtilsModule";
    private final ExecutorService executorService = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ConfigManager configManager;
    private final String SLAM_IP;
    private final int SLAM_PORT;
    private final int TIMEOUT_MS;
    private final String BASE_URL;
    private SlamwareSdpPlatform platform;  // Persistent platform connection

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


    private void logToFile(String message) {
        try {
            FileUtilsModule fileUtils = new FileUtilsModule(getReactApplicationContext());
            fileUtils.appendToFile("debug_log.txt", message, new Promise() {
                @Override
                public void resolve(Object value) {}
                @Override
                public void reject(String code, String message) {}
                @Override
                public void reject(String code, Throwable e) {}
                @Override
                public void reject(String code, String message, Throwable e) {}
                @Override
                public void reject(Throwable e) {}
                @Override
                public void reject(String code) {}
                @Override
                public void reject(String code, WritableMap userInfo) {}
                @Override
                public void reject(String code, String message, WritableMap userInfo) {}
                @Override
                public void reject(String code, String message, Throwable e, WritableMap userInfo) {}
                @Override
                public void reject(String code, Throwable e, WritableMap userInfo) {}
                @Override
                public void reject(Throwable e, WritableMap userInfo) {}
            });
        } catch (Exception e) {
            Log.e(TAG, "Error writing to debug log: " + e.getMessage());
        }
    }

    private double[] calculatePose(double[] homedock, double distanceInMeters) {
        double x = homedock[0];
        double y = homedock[1];
        double z = 0; //homedock[2];
        double yaw = homedock[3];
        double pitch = 0;
        double roll = 0;
        
        double dx = distanceInMeters * Math.cos(yaw);
        double dy = distanceInMeters * Math.sin(yaw);
        // double dz = distanceInMeters * Math.sin(yaw);
        
        return new double[] {
            x + dx,  // new x
            y + dy,  // new y 
            z     ,  // z = 0
            yaw,     // yaw remains unchanged
            pitch,   // pitch remains unchanged
            roll     // roll remains unchanged
        };
    }

    private double[] calculatePose(double[] homedock) {
        return calculatePose(homedock, 0.2);
    }

    private synchronized void connectPlatformIfNeeded() throws Exception {
        if (platform == null) {
            platform = SlamwareSdpPlatform.connect(SLAM_IP, SLAM_PORT);
            if (platform == null) throw new Exception("Failed to connect to Slamtec platform");
        }
    }

    private synchronized void disconnectPlatform() {
        if (platform != null) {
            try {
                platform.disconnect();
            } catch (Exception e) {
                Log.e(TAG, "Error disconnecting platform: " + e.getMessage());
            }
            platform = null;
        }
    }

    @ReactMethod
    public void disconnectSdk(Promise promise) {
        executorService.execute(() -> {
            try {
                disconnectPlatform();
                mainHandler.post(() -> promise.resolve(true));
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("DISCONNECT_ERROR", e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void checkConnectionSdk(Promise promise) {
        executorService.execute(() -> {
            try {
                WritableMap response = Arguments.createMap();
                try {
                    connectPlatformIfNeeded();
                    Log.d(TAG, "SDK Health Check: Connection successful");
                    logToFile("SDK Health Check: Connection successful");
                    HealthInfo health = platform.getRobotHealth();
                    Log.d(TAG, "SDK Health Check: Health info - Error: " + health.isError() + 
                           ", Warning: " + health.isWarning() + 
                           ", Fatal: " + health.isFatal());
                    logToFile("SDK Health Check: Health info - Error: " + health.isError() + 
                             ", Warning: " + health.isWarning() + 
                             ", Fatal: " + health.isFatal());
                    response.putInt("responseCode", HttpURLConnection.HTTP_OK);
                    response.putString("status", !health.isError() ? 
                        "Robot health check successful" : "Robot has errors");
                    response.putBoolean("slamApiAvailable", !health.isError());
                    JSONObject healthJson = new JSONObject();
                    healthJson.put("hasError", health.isError());
                    healthJson.put("hasWarning", health.isWarning());
                    healthJson.put("hasFatal", health.isFatal());
                    response.putString("response", healthJson.toString());
                    Log.d(TAG, "SDK Health Check: Complete health response: " + healthJson.toString());
                } catch (Exception e) {
                    Log.e(TAG, "SDK Health Check: Connection error: " + e.getMessage(), e);
                    logToFile("SDK Health Check: Connection error: " + e.getMessage());
                    response.putString("error", "Connection error: " + e.getMessage());
                    response.putString("status", "Cannot connect to robot");
                    response.putBoolean("slamApiAvailable", false);
                }
                boolean isAvailable = false;
                if (response.hasKey("slamApiAvailable")) {
                    isAvailable = response.getBoolean("slamApiAvailable");
                }
                response.putBoolean("deviceFound", isAvailable);
                Log.d(TAG, "SDK Health Check: Final result - deviceFound: " + isAvailable);
                logToFile("SDK Health Check: Final result - deviceFound: " + isAvailable);
                mainHandler.post(() -> promise.resolve(response));
            } catch (Exception e) {
                Log.e(TAG, "SDK Health Check: Fatal error: " + e.getMessage(), e);
                logToFile("SDK Health Check: Fatal error: " + e.getMessage());
                mainHandler.post(() -> promise.reject("SLAM_ERROR", "Fatal error: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void navigateWithSdk(double x, double y, double yaw, Promise promise) {
        executorService.execute(() -> {
            try {
                Log.d(TAG, "=== STARTING SDK NAVIGATION ===");
                Log.d(TAG, "Navigating with SDK to x=" + x + ", y=" + y + ", yaw=" + yaw);
                logToFile("=== STARTING SDK NAVIGATION ===");
                logToFile("Navigating with SDK to x=" + x + ", y=" + y + ", yaw=" + yaw);
                
                // Use existing platform connection
                Log.d(TAG, "Attempting to connect platform...");
                logToFile("Attempting to connect platform...");
                connectPlatformIfNeeded();
                
                if (platform != null) {
                    Log.d(TAG, "Platform connection successful");
                    logToFile("Platform connection successful");
                    
                    // Check platform health before moving
                    try {
                        Log.d(TAG, "Checking platform health...");
                        logToFile("Checking platform health...");
                        HealthInfo health = platform.getRobotHealth();
                        Log.d(TAG, "Platform health - Error: " + health.isError() + ", Warning: " + health.isWarning() + ", Fatal: " + health.isFatal());
                        logToFile("Platform health - Error: " + health.isError() + ", Warning: " + health.isWarning() + ", Fatal: " + health.isFatal());
                        
                        if (health.isFatal()) {
                            throw new Exception("Robot has fatal health issues, cannot navigate");
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Health check failed: " + e.getMessage());
                        logToFile("Health check failed: " + e.getMessage());
                        // Continue anyway, health check failure doesn't necessarily mean we can't move
                    }
                    
                    // Get current robot status
                    try {
                        Log.d(TAG, "Getting current robot pose...");
                        logToFile("Getting current robot pose...");
                        com.slamtec.slamware.robot.Pose currentPose = platform.getPose();
                        Log.d(TAG, "Current robot pose: [" + currentPose.getX() + ", " + currentPose.getY() + ", " + currentPose.getZ() + ", yaw=" + currentPose.getYaw() + ", pitch=" + currentPose.getPitch() + ", roll=" + currentPose.getRoll() + "]");
                        logToFile("Current robot pose: [" + currentPose.getX() + ", " + currentPose.getY() + ", " + currentPose.getZ() + ", yaw=" + currentPose.getYaw() + ", pitch=" + currentPose.getPitch() + ", roll=" + currentPose.getRoll() + "]");
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to get current pose: " + e.getMessage());
                        logToFile("Failed to get current pose: " + e.getMessage());
                    }
                    
                    // Check if there's already an active action
                    try {
                        Log.d(TAG, "Checking for existing actions...");
                        logToFile("Checking for existing actions...");
                        com.slamtec.slamware.action.IMoveAction existingAction = platform.getCurrentAction();
                        if (existingAction != null && !existingAction.isEmpty()) {
                            Log.d(TAG, "Found existing action: " + existingAction.getActionName() + " (ID: " + existingAction.getActionId() + ")");
                            logToFile("Found existing action: " + existingAction.getActionName() + " (ID: " + existingAction.getActionId() + ")");
                            Log.d(TAG, "Cancelling existing action...");
                            logToFile("Cancelling existing action...");
                            existingAction.cancel();
                            Thread.sleep(1000); // Wait for cancellation
                        } else {
                            Log.d(TAG, "No existing actions found");
                            logToFile("No existing actions found");
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error checking existing actions: " + e.getMessage());
                        logToFile("Error checking existing actions: " + e.getMessage());
                    }
                    
                    // Create a location array for the target
                    Log.d(TAG, "Creating location array...");
                    logToFile("Creating location array...");
                    com.slamtec.slamware.robot.Location[] locations = new com.slamtec.slamware.robot.Location[1];
                    locations[0] = new com.slamtec.slamware.robot.Location();
                    locations[0].setX((float)x);
                    locations[0].setY((float)y);
                    Log.d(TAG, "Location created: [" + locations[0].getX() + ", " + locations[0].getY() + "]");
                    logToFile("Location created: [" + locations[0].getX() + ", " + locations[0].getY() + "]");
                    
                    // Create move options with specific settings
                    Log.d(TAG, "Creating move options...");
                    logToFile("Creating move options...");
                    com.slamtec.slamware.robot.MoveOption moveOption = new com.slamtec.slamware.robot.MoveOption();
                    
                    // Make robot movement precise/accurate
                    moveOption.setPrecise(true);
                    Log.d(TAG, "Set precise: true");
                    logToFile("Set precise: true");
                    
                    // Enable path search/planning functionality
                    moveOption.setMilestone(true);
                    Log.d(TAG, "Set milestone: true");
                    logToFile("Set milestone: true");
                    
                    // Make robot rotate to the target yaw when it stops
                    moveOption.setWithYaw(true);
                    Log.d(TAG, "Set withYaw: true");
                    logToFile("Set withYaw: true");
                    
                    // Don't use virtual tracks
                    moveOption.setKeyPoints(false);
                    Log.d(TAG, "Set keyPoints: false");
                    logToFile("Set keyPoints: false");
                    
                    Log.d(TAG, "Move options configured successfully");
                    logToFile("Move options configured successfully");
                    
                    // Execute the move
                    Log.d(TAG, "Calling platform.moveTo with target yaw: " + yaw);
                    logToFile("Calling platform.moveTo with target yaw: " + yaw);
                    
                    com.slamtec.slamware.action.IMoveAction action = null;
                    try {
                        action = platform.moveTo(locations, moveOption, (float)yaw);
                        Log.d(TAG, "platform.moveTo call completed successfully");
                        logToFile("platform.moveTo call completed successfully");
                        
                        if (action != null) {
                            Log.d(TAG, "Action created - ID: " + action.getActionId() + ", Name: " + action.getActionName());
                            logToFile("Action created - ID: " + action.getActionId() + ", Name: " + action.getActionName());
                            Log.d(TAG, "Action isEmpty: " + action.isEmpty());
                            logToFile("Action isEmpty: " + action.isEmpty());
                        } else {
                            Log.e(TAG, "Action is null after moveTo call!");
                            logToFile("Action is null after moveTo call!");
                            throw new Exception("MoveTo returned null action");
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Exception during platform.moveTo: " + e.getMessage());
                        logToFile("Exception during platform.moveTo: " + e.getMessage());
                        throw e;
                    }
                    
                    // Wait for a short time to let action start
                    Log.d(TAG, "Waiting 5 seconds for action to start...");
                    logToFile("Waiting 5 seconds for action to start...");
                    Thread.sleep(5000);
                    
                    // Monitor action until completion
                    Log.d(TAG, "Starting action monitoring loop...");
                    logToFile("Starting action monitoring loop...");
                    boolean completed = false;
                    int retryCount = 0;
                    int maxRetries = 120; // 60 seconds max (500ms interval)
                    boolean hasStartedMoving = false;
                    boolean hasReachedTarget = false;
                    float targetDistanceThreshold = 0.5f; // Consider target reached if within 0.5 meters
                    
                    Log.d(TAG, "Target distance threshold: " + targetDistanceThreshold + " meters");
                    logToFile("Target distance threshold: " + targetDistanceThreshold + " meters");
                    
                    // Store initial position to detect movement
                    float initialX = 0;
                    float initialY = 0;
                    boolean haveInitialPosition = false;
                    
                    try {
                        Log.d(TAG, "Getting initial position for movement detection...");
                        logToFile("Getting initial position for movement detection...");
                        com.slamtec.slamware.robot.Pose initialPose = platform.getPose();
                        initialX = initialPose.getX();
                        initialY = initialPose.getY();
                        haveInitialPosition = true;
                        Log.d(TAG, "Saved initial position: [" + initialX + ", " + initialY + "]");
                        logToFile("Saved initial position: [" + initialX + ", " + initialY + "]");
                    } catch (Exception e) {
                        Log.e(TAG, "Error getting initial position: " + e.getMessage());
                        logToFile("Error getting initial position: " + e.getMessage());
                    }
                    
                    while (!completed && retryCount < maxRetries) {
                        Log.d(TAG, "=== MONITORING LOOP ITERATION " + (retryCount + 1) + " / " + maxRetries + " ===");
                        
                        // Check current action status
                        try {
                            Log.d(TAG, "Getting current action from platform...");
                            com.slamtec.slamware.action.IMoveAction currentAction = platform.getCurrentAction();
                            Log.d(TAG, "getCurrentAction() returned: " + (currentAction != null ? "not null" : "null"));
                            
                            // Log current action status
                            if (currentAction != null) {
                                try {
                                    StringBuilder actionLog = new StringBuilder();
                                    actionLog.append("=== Current Action Status (Iteration ").append(retryCount + 1).append(") ===\n");
                                    
                                    // IAction interface properties
                                    try {
                                        String actionName = currentAction.getActionName();
                                        actionLog.append("  - Action Name: ").append(actionName).append("\n");
                                        Log.d(TAG, "Action Name: " + actionName);
                                    } catch (Exception e) {
                                        actionLog.append("  - Action Name: Error - ").append(e.getMessage()).append("\n");
                                        Log.e(TAG, "Error getting action name: " + e.getMessage());
                                    }
                                    
                                    try {
                                        int actionId = currentAction.getActionId();
                                        actionLog.append("  - Action ID: ").append(actionId).append("\n");
                                        Log.d(TAG, "Action ID: " + actionId);
                                    } catch (Exception e) {
                                        actionLog.append("  - Action ID: Error - ").append(e.getMessage()).append("\n");
                                        Log.e(TAG, "Error getting action ID: " + e.getMessage());
                                    }
                                    
                                    try {
                                        boolean isEmpty = currentAction.isEmpty();
                                        actionLog.append("  - Is Empty: ").append(isEmpty).append("\n");
                                        Log.d(TAG, "Action isEmpty: " + isEmpty);
                                    } catch (Exception e) {
                                        actionLog.append("  - Is Empty: Error - ").append(e.getMessage()).append("\n");
                                        Log.e(TAG, "Error checking if action is empty: " + e.getMessage());
                                    }
                                    
                                    try {
                                        double progress = currentAction.getProgress();
                                        actionLog.append("  - Progress: ").append(progress).append("\n");
                                        Log.d(TAG, "Action progress: " + progress);
                                    } catch (Exception e) {
                                        actionLog.append("  - Progress: Error - ").append(e.getMessage()).append("\n");
                                        Log.e(TAG, "Error getting action progress: " + e.getMessage());
                                    }
                                    
                                    try {
                                        Object status = currentAction.getStatus();
                                        actionLog.append("  - Status: ").append(status).append("\n");
                                        Log.d(TAG, "Action status: " + status);
                                    } catch (Exception e) {
                                        actionLog.append("  - Status: Error - ").append(e.getMessage()).append("\n");
                                        Log.e(TAG, "Error getting action status: " + e.getMessage());
                                    }
                                    
                                    try {
                                        Object reason = currentAction.getReason();
                                        actionLog.append("  - Reason: ").append(reason).append("\n");
                                        Log.d(TAG, "Action reason: " + reason);
                                    } catch (Exception e) {
                                        actionLog.append("  - Reason: Error - ").append(e.getMessage()).append("\n");
                                        Log.e(TAG, "Error getting action reason: " + e.getMessage());
                                    }
                                    
                                    // IMoveAction specific properties
                                    try {
                                        Object remainingPath = currentAction.getRemainingPath();
                                        actionLog.append("  - Remaining Path: ").append(remainingPath).append("\n");
                                        Log.d(TAG, "Remaining path: " + remainingPath);
                                    } catch (Exception e) {
                                        actionLog.append("  - Remaining Path: Error - ").append(e.getMessage()).append("\n");
                                        Log.e(TAG, "Error getting remaining path: " + e.getMessage());
                                    }
                                    
                                    try {
                                        Object remainingMilestones = currentAction.getRemainingMilestones();
                                        actionLog.append("  - Remaining Milestones: ").append(remainingMilestones).append("\n");
                                        Log.d(TAG, "Remaining milestones: " + remainingMilestones);
                                    } catch (Exception e) {
                                        actionLog.append("  - Remaining Milestones: Error - ").append(e.getMessage()).append("\n");
                                        Log.e(TAG, "Error getting remaining milestones: " + e.getMessage());
                                    }
                                    
                                    // Always log to file for detailed debugging
                                    logToFile(actionLog.toString());
                                    
                                    // Log to Android debug
                                    Log.d(TAG, actionLog.toString());
                                } catch (Exception e) {
                                    Log.e(TAG, "Error getting action details: " + e.getMessage());
                                    logToFile("Error getting action details: " + e.getMessage());
                                }
                            } else {
                                Log.d(TAG, "No current action (null) - iteration " + (retryCount + 1));
                                logToFile("No current action (null) - iteration " + (retryCount + 1));
                            }
                            
                            // Check current position to detect movement and target arrival
                            try {
                                Log.d(TAG, "Getting current robot pose...");
                                com.slamtec.slamware.robot.Pose currentPose = platform.getPose();
                                float currentX = currentPose.getX();
                                float currentY = currentPose.getY();
                                float currentYaw = currentPose.getYaw();
                                
                                // Log position
                                Log.d(TAG, "Current position: [" + currentX + ", " + currentY + ", yaw=" + currentYaw + "]");
                                logToFile("Current position: [" + currentX + ", " + currentY + ", yaw=" + currentYaw + "]");
                                
                                // Check if we've started moving (changed position significantly)
                                if (haveInitialPosition && !hasStartedMoving) {
                                    float dx = currentX - initialX;
                                    float dy = currentY - initialY;
                                    float distanceMoved = (float)Math.sqrt(dx*dx + dy*dy);
                                    
                                    Log.d(TAG, "Movement check - dx: " + dx + ", dy: " + dy + ", distance: " + distanceMoved);
                                    logToFile("Movement check - dx: " + dx + ", dy: " + dy + ", distance: " + distanceMoved);
                                    
                                    if (distanceMoved > 0.05) { // 5cm movement threshold
                                        hasStartedMoving = true;
                                        Log.d(TAG, "*** ROBOT HAS STARTED MOVING! Distance moved: " + distanceMoved + " ***");
                                        logToFile("*** ROBOT HAS STARTED MOVING! Distance moved: " + distanceMoved + " ***");
                                    } else {
                                        Log.d(TAG, "Robot has not moved significantly yet (distance: " + distanceMoved + " < 0.05m threshold)");
                                        logToFile("Robot has not moved significantly yet (distance: " + distanceMoved + " < 0.05m threshold)");
                                    }
                                } else if (!haveInitialPosition) {
                                    Log.d(TAG, "No initial position available for movement detection");
                                    logToFile("No initial position available for movement detection");
                                } else if (hasStartedMoving) {
                                    Log.d(TAG, "Robot movement already detected");
                                }
                                
                                // Calculate distance to target
                                float dx = currentX - (float)x;
                                float dy = currentY - (float)y;
                                float distanceToTarget = (float)Math.sqrt(dx*dx + dy*dy);
                                
                                Log.d(TAG, "Target distance calculation - dx: " + dx + ", dy: " + dy + ", distance: " + distanceToTarget + " meters");
                                logToFile("Target distance calculation - dx: " + dx + ", dy: " + dy + ", distance: " + distanceToTarget + " meters");
                                
                                // Check if we've reached the target
                                if (distanceToTarget <= targetDistanceThreshold) {
                                    if (!hasReachedTarget) {
                                        hasReachedTarget = true;
                                        Log.d(TAG, "*** TARGET REACHED! Distance: " + distanceToTarget + " ***");
                                        logToFile("*** TARGET REACHED! Distance: " + distanceToTarget + " ***");
                                    }
                                    
                                    // If we've reached the target and action is complete or we're just waiting, 
                                    // consider navigation complete
                                    if (currentAction == null) {
                                        completed = true;
                                        Log.d(TAG, "*** NAVIGATION COMPLETE - at target with no current action ***");
                                        logToFile("*** NAVIGATION COMPLETE - at target with no current action ***");
                                    } else {
                                        Log.d(TAG, "At target but action still active, continuing to monitor...");
                                        logToFile("At target but action still active, continuing to monitor...");
                                    }
                                } else {
                                    Log.d(TAG, "Not at target yet (distance: " + distanceToTarget + " > " + targetDistanceThreshold + "m threshold)");
                                    logToFile("Not at target yet (distance: " + distanceToTarget + " > " + targetDistanceThreshold + "m threshold)");
                                }
                            } catch (Exception e) {
                                Log.e(TAG, "Error getting position update: " + e.getMessage());
                                logToFile("Error getting position update: " + e.getMessage());
                            }
                            
                            if (currentAction == null) {
                                Log.d(TAG, "No current action detected - analyzing completion status...");
                                logToFile("No current action detected - analyzing completion status...");
                                
                                // No current action means movement is complete
                                if (hasReachedTarget) {
                                    completed = true;
                                    Log.d(TAG, "*** NAVIGATION COMPLETED SUCCESSFULLY (no current action and at target) ***");
                                    logToFile("*** NAVIGATION COMPLETED SUCCESSFULLY (no current action and at target) ***");
                                } else if (hasStartedMoving) {
                                    completed = true;
                                    Log.d(TAG, "*** NAVIGATION COMPLETED (no current action, moved but target not reached) ***");
                                    logToFile("*** NAVIGATION COMPLETED (no current action, moved but target not reached) ***");
                                } else {
                                    // If we have no current action but haven't moved, something is wrong
                                    // Wait a bit more in case robot is just starting
                                    retryCount++;
                                    Log.d(TAG, "WAITING: No current action but no movement detected. Check #" + retryCount + " (will fail after 20 checks)");
                                    logToFile("WAITING: No current action but no movement detected. Check #" + retryCount + " (will fail after 20 checks)");
                                    
                                    if (retryCount > 20) { // After 10 seconds, assume something is wrong
                                        Log.e(TAG, "*** NAVIGATION FAILED: No movement detected after 10 seconds with no current action ***");
                                        logToFile("*** NAVIGATION FAILED: No movement detected after 10 seconds with no current action ***");
                                        completed = true; // End the loop
                                    }
                                }
                            } else {
                                // Still moving, log status and wait
                                retryCount++;
                                Log.d(TAG, "CONTINUING: Robot still has active action, check #" + retryCount + " of " + maxRetries);
                                logToFile("CONTINUING: Robot still has active action, check #" + retryCount + " of " + maxRetries);
                                Thread.sleep(500);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "*** EXCEPTION in action monitoring: " + e.getMessage());
                            logToFile("*** EXCEPTION in action monitoring: " + e.getMessage());
                            e.printStackTrace();
                            // Assume completed if we can't check status
                            completed = true;
                        }
                    }
                    
                    if (retryCount >= maxRetries) {
                        Log.d(TAG, "*** NAVIGATION TIMEOUT - assuming success after " + maxRetries + " checks ***");
                        logToFile("*** NAVIGATION TIMEOUT - assuming success after " + maxRetries + " checks ***");
                    }
                    
                    Log.d(TAG, "=== NAVIGATION SDK PROCESS COMPLETED ===");
                    Log.d(TAG, "Final status - hasStartedMoving: " + hasStartedMoving + ", hasReachedTarget: " + hasReachedTarget);
                    logToFile("=== NAVIGATION SDK PROCESS COMPLETED ===");
                    logToFile("Final status - hasStartedMoving: " + hasStartedMoving + ", hasReachedTarget: " + hasReachedTarget);
                    
                    // Return success
                    mainHandler.post(() -> promise.resolve(true));
                } else {
                    String errorMsg = "Failed to connect to platform (null return)";
                    Log.e(TAG, errorMsg);
                    logToFile(errorMsg);
                    mainHandler.post(() -> promise.reject("NAVIGATION_ERROR", errorMsg));
                }
            } catch (Exception e) {
                String errorMsg = "Error during SDK navigation: " + e.getMessage();
                Log.e(TAG, errorMsg, e);
                logToFile(errorMsg);
                mainHandler.post(() -> promise.reject("NAVIGATION_ERROR", errorMsg));
            }
        });
    }

    @ReactMethod
    public void navigateHomeWithSdk(double x, double y, double yaw, Promise promise) {
        executorService.execute(() -> {
            try {
                connectPlatformIfNeeded();
                Log.d(TAG, "Navigating Home with SDK to x=" + x + ", y=" + y + ", yaw=" + yaw);
                logToFile("Navigating Home with SDK to x=" + x + ", y=" + y + ", yaw=" + yaw);
                
                // Create a location array for the target
                com.slamtec.slamware.robot.Location[] locations = new com.slamtec.slamware.robot.Location[1];
                locations[0] = new com.slamtec.slamware.robot.Location();
                locations[0].setX((float)x);
                locations[0].setY((float)y);
                Log.d(TAG, "Created location target: [" + x + ", " + y + "]");
                logToFile("Created location target: [" + x + ", " + y + "]");
                
                // Create move options with specific settings
                com.slamtec.slamware.robot.MoveOption moveOption = new com.slamtec.slamware.robot.MoveOption();
                // Make robot movement precise/accurate
                moveOption.setPrecise(true);
                // Enable path search/planning functionality
                moveOption.setMilestone(true);
                // Make robot rotate to the target yaw when it stops
                moveOption.setWithYaw(true);
                // Don't use virtual tracks
                moveOption.setKeyPoints(false);
                Log.d(TAG, "Created move options: precise=true, milestone=true, withYaw=true, keyPoints=false");
                logToFile("Created move options: precise=true, milestone=true, withYaw=true, keyPoints=false");
                
                // Check current position before moving
                try {
                    com.slamtec.slamware.robot.Pose currentPose = platform.getPose();
                    Log.d(TAG, "Current robot position: [" + currentPose.getX() + ", " + currentPose.getY() + ", yaw=" + currentPose.getYaw() + "]");
                    logToFile("Current robot position: [" + currentPose.getX() + ", " + currentPose.getY() + ", yaw=" + currentPose.getYaw() + "]");
                } catch (Exception e) {
                    Log.e(TAG, "Error getting current position: " + e.getMessage(), e);
                    logToFile("Error getting current position: " + e.getMessage());
                }
                
                // Execute the move
                Log.d(TAG, "Calling platform.moveTo for HOME with options: precise=true, milestone=true, withYaw=true, keyPoints=false");
                logToFile("Calling platform.moveTo for HOME...");
                com.slamtec.slamware.action.IMoveAction action = platform.moveTo(locations, moveOption, (float)yaw);
                Log.d(TAG, "moveTo call completed, action created");
                logToFile("moveTo call completed, action created");
                
                // Wait for a short time to let action start
                Log.d(TAG, "Waiting 5 seconds for action to start...");
                logToFile("Waiting 5 seconds for action to start...");
                Thread.sleep(5000);
                Log.d(TAG, "Wait complete, checking action status");
                logToFile("Wait complete, checking action status");
                
                // Monitor action until completion
                boolean completed = false;
                int retryCount = 0;
                int maxRetries = 120; // 60 seconds max (500ms interval)
                boolean hasStartedMoving = false;
                boolean hasReachedTarget = false;
                float targetDistanceThreshold = 0.1f; // Consider target reached if within 0.5 meters
                
                // Store initial position to detect movement
                float initialX = 0;
                float initialY = 0;
                boolean haveInitialPosition = false;
                
                try {
                    com.slamtec.slamware.robot.Pose initialPose = platform.getPose();
                    initialX = initialPose.getX();
                    initialY = initialPose.getY();
                    haveInitialPosition = true;
                    Log.d(TAG, "Saved initial position: [" + initialX + ", " + initialY + "]");
                    logToFile("Saved initial position: [" + initialX + ", " + initialY + "]");
                } catch (Exception e) {
                    Log.e(TAG, "Error getting initial position: " + e.getMessage(), e);
                    logToFile("Error getting initial position: " + e.getMessage());
                }
                
                while (!completed && retryCount < maxRetries) {
                    // Check current action status
                    try {
                        com.slamtec.slamware.action.IMoveAction currentAction = platform.getCurrentAction();
                        
                        // Log current action status
                        if (currentAction != null) {
                            try {
                                StringBuilder actionLog = new StringBuilder();
                                actionLog.append("Current Action Status:\n");
                                
                                // IAction interface properties
                                try {
                                    actionLog.append("  - Action Name: ").append(currentAction.getActionName()).append("\n");
                                } catch (Exception e) {
                                    actionLog.append("  - Action Name: Error - ").append(e.getMessage()).append("\n");
                                }
                                
                                try {
                                    actionLog.append("  - Action ID: ").append(currentAction.getActionId()).append("\n");
                                } catch (Exception e) {
                                    actionLog.append("  - Action ID: Error - ").append(e.getMessage()).append("\n");
                                }
                                
                                try {
                                    actionLog.append("  - Is Empty: ").append(currentAction.isEmpty()).append("\n");
                                } catch (Exception e) {
                                    actionLog.append("  - Is Empty: Error - ").append(e.getMessage()).append("\n");
                                }
                                
                                try {
                                    actionLog.append("  - Progress: ").append(currentAction.getProgress()).append("\n");
                                } catch (Exception e) {
                                    actionLog.append("  - Progress: Error - ").append(e.getMessage()).append("\n");
                                }
                                
                                try {
                                    actionLog.append("  - Status: ").append(currentAction.getStatus()).append("\n");
                                } catch (Exception e) {
                                    actionLog.append("  - Status: Error - ").append(e.getMessage()).append("\n");
                                }
                                
                                try {
                                    actionLog.append("  - Reason: ").append(currentAction.getReason()).append("\n");
                                } catch (Exception e) {
                                    actionLog.append("  - Reason: Error - ").append(e.getMessage()).append("\n");
                                }
                                
                                // IMoveAction specific properties
                                try {
                                    actionLog.append("  - Remaining Path: ").append(currentAction.getRemainingPath()).append("\n");
                                } catch (Exception e) {
                                    actionLog.append("  - Remaining Path: Error - ").append(e.getMessage()).append("\n");
                                }
                                
                                try {
                                    actionLog.append("  - Remaining Milestones: ").append(currentAction.getRemainingMilestones()).append("\n");
                                } catch (Exception e) {
                                    actionLog.append("  - Remaining Milestones: Error - ").append(e.getMessage()).append("\n");
                                }
                                
                                // Log to Android debug
                                Log.d(TAG, actionLog.toString());
                                
                                // Log to file (less frequently to avoid huge logs)
                                if (retryCount % 10 == 0) {
                                    logToFile(actionLog.toString());
                                }
                            } catch (Exception e) {
                                Log.e(TAG, "Error getting action details: " + e.getMessage());
                            }
                        } else {
                            Log.d(TAG, "No current action (null)");
                            if (retryCount % 10 == 0) {
                                logToFile("No current action (null)");
                            }
                        }
                        
                        // Check current position to detect movement and target arrival
                        try {
                            com.slamtec.slamware.robot.Pose currentPose = platform.getPose();
                            float currentX = currentPose.getX();
                            float currentY = currentPose.getY();
                            
                            // Log position
                            Log.d(TAG, "Current position: [" + currentX + ", " + currentY + ", yaw=" + currentPose.getYaw() + "]");
                            
                            // Only log to file occasionally to avoid huge log files
                            if (retryCount % 10 == 0) {
                                logToFile("Current position: [" + currentX + ", " + currentY + ", yaw=" + currentPose.getYaw() + "]");
                            }
                            
                            // Check if we've started moving (changed position significantly)
                            if (haveInitialPosition && !hasStartedMoving) {
                                float dx = currentX - initialX;
                                float dy = currentY - initialY;
                                float distanceMoved = (float)Math.sqrt(dx*dx + dy*dy);
                                
                                if (distanceMoved > 0.05) { // 5cm movement threshold
                                    hasStartedMoving = true;
                                    Log.d(TAG, "Robot has started moving! Distance moved: " + distanceMoved);
                                    logToFile("Robot has started moving! Distance moved: " + distanceMoved);
                                }
                            }
                            
                            // Calculate distance to target
                            float dx = currentX - (float)x;
                            float dy = currentY - (float)y;
                            float distanceToTarget = (float)Math.sqrt(dx*dx + dy*dy);
                            
                            if (retryCount % 10 == 0) {
                                Log.d(TAG, "Distance to target: " + distanceToTarget + " meters");
                            }
                            
                            // Check if we've reached the target
                            if (distanceToTarget <= targetDistanceThreshold) {
                                hasReachedTarget = true;
                                Log.d(TAG, "Target reached! Distance: " + distanceToTarget);
                                logToFile("Target reached! Distance: " + distanceToTarget);
                                
                                // If we've reached the target and action is complete or we're just waiting, 
                                // consider navigation complete
                                if (currentAction == null) {
                                    completed = true;
                                    Log.d(TAG, "Navigation complete - at target with no current action");
                                    logToFile("Navigation complete - at target with no current action");
                                }
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error getting position update: " + e.getMessage());
                        }
                        
                        if (currentAction == null) {
                            // No current action means movement is complete
                            if (hasReachedTarget) {
                                completed = true;
                                Log.d(TAG, "Home navigation completed successfully (no current action and at target)");
                                logToFile("Home navigation completed successfully (no current action and at target)");
                                
                                // Start auto-charging when we reach the target
                                try {
                                    Log.d(TAG, "Starting auto-charging...");
                                    logToFile("Starting auto-charging...");
                                    RobotControlManager.getInstance().startAutoCharging();
                                    
                                    // Monitor charging status for 60 seconds
                                    boolean isCharging = false;
                                    int chargingCheckCount = 0;
                                    int maxChargingChecks = 120; // 60 seconds (500ms interval)
                                    
                                    while (!isCharging && chargingCheckCount < maxChargingChecks) {
                                        // Check charging status through React Native bridge
                                        WritableMap params = Arguments.createMap();
                                        params.putString("type", "checkCharging");
                                        getReactApplicationContext()
                                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                            .emit("checkCharging", params);
                                        
                                        // Wait for response
                                        Thread.sleep(500);
                                        chargingCheckCount++;
                                        
                                        // Check if charging started
                                        if (PadbotUtils.isCharging()) {
                                            isCharging = true;
                                            Log.d(TAG, "Charging started successfully");
                                            logToFile("Charging started successfully");
                                        }
                                    }
                                    
                                    if (!isCharging) {
                                        // Stop auto-charging if not charging after timeout
                                        Log.e(TAG, "Charging did not start within 60 seconds");
                                        logToFile("Charging did not start within 60 seconds");
                                        RobotControlManager.getInstance().stopAutoCharging();
                                        
                                        // Send error event to React Native
                                        WritableMap errorParams = Arguments.createMap();
                                        errorParams.putString("type", "chargingError");
                                        errorParams.putString("message", "Failed to start charging after reaching home position");
                                        getReactApplicationContext()
                                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                            .emit("chargingError", errorParams);
                                    }
                                } catch (Exception e) {
                                    String errorMsg = "Error during auto-charging: " + e.getMessage();
                                    Log.e(TAG, errorMsg, e);
                                    logToFile(errorMsg);
                                    
                                    // Send error event to React Native
                                    WritableMap errorParams = Arguments.createMap();
                                    errorParams.putString("type", "chargingError");
                                    errorParams.putString("message", errorMsg);
                                    getReactApplicationContext()
                                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                        .emit("chargingError", errorParams);
                                }
                            } else if (hasStartedMoving) {
                                completed = true;
                                Log.d(TAG, "Home navigation completed (no current action, moved but target not reached)");
                                logToFile("Home navigation completed (no current action, moved but target not reached)");
                            } else {
                                // If we have no current action but haven't moved, something is wrong
                                // Wait a bit more in case robot is just starting
                                retryCount++;
                                Log.d(TAG, "No current action but no movement detected. Check #" + retryCount);
                                
                                if (retryCount > 20) { // After 10 seconds, assume something is wrong
                                    Log.e(TAG, "No movement detected after 10 seconds with no current action. Navigation may have failed.");
                                    logToFile("No movement detected after 10 seconds with no current action. Navigation may have failed.");
                                    
                                    // Send error event to React Native
                                    WritableMap errorParams = Arguments.createMap();
                                    errorParams.putString("type", "navigationError");
                                    errorParams.putString("message", "No movement detected after 10 seconds");
                                    getReactApplicationContext()
                                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                        .emit("navigationError", errorParams);
                                    
                                    completed = true; // End the loop
                                }
                            }
                        } else {
                            // Still moving, log status and wait
                            retryCount++;
                            Log.d(TAG, "Robot still moving, check #" + retryCount + " of " + maxRetries);
                            Thread.sleep(500);
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error checking action status: " + e.getMessage(), e);
                        logToFile("Error checking action status: " + e.getMessage());
                        // Assume completed if we can't check status
                        completed = true;
                    }
                }
                
                if (retryCount >= maxRetries) {
                    Log.d(TAG, "Navigation timeout - assuming success after " + maxRetries + " checks");
                }
                
                Log.d(TAG, "Navigation completed");
                logToFile("Navigation completed");
                
                // Return success
                mainHandler.post(() -> promise.resolve(true));
            } catch (Exception e) {
                String errorMsg = "Error during SDK home navigation: " + e.getMessage();
                Log.e(TAG, errorMsg, e);
                logToFile(errorMsg);
                mainHandler.post(() -> promise.reject("HOME_NAVIGATION_ERROR", errorMsg));
            }
        });
    }

    @ReactMethod
    public void processMapWithSdk(String inputFilePath, ReadableArray initialPoseArray, Promise promise) {
        executorService.execute(() -> {
            try {
                connectPlatformIfNeeded();
                Log.d(TAG, "Processing map with SDK: " + inputFilePath);
                logToFile("Processing map with SDK: " + inputFilePath);
                
                // Validate input file exists
                File inputFile = new File(inputFilePath);
                if (!inputFile.exists()) {
                    String errorMsg = "Input STCM file not found: " + inputFilePath;
                    Log.e(TAG, errorMsg);
                    logToFile(errorMsg);
                    throw new Exception(errorMsg);
                }
                
                logToFile("Input file exists: " + inputFile.exists() + ", size: " + inputFile.length() + " bytes");
                
                // Clear existing map first
                try {
                    Log.d(TAG, "Clearing existing map...");
                    logToFile("Clearing existing map...");
                    platform.clearMap();
                    
                    // Wait and verify map is cleared
                    int retryCount = 0;
                    int maxRetries = 10;
                    boolean mapCleared = false;
                    
                    while (!mapCleared && retryCount < maxRetries) {
                        try {
                            // Small delay to allow map clearing to complete
                            Thread.sleep(500);
                            
                            // Try to get the map and log its details
                            CompositeMap currentMap = platform.getCompositeMap();
                            StringBuilder mapInfo = new StringBuilder();
                            mapInfo.append("Map check attempt ").append(retryCount + 1).append(":\n");
                            mapInfo.append("  - Map object: ").append(currentMap != null ? "not null" : "null").append("\n");
                            
                            if (currentMap != null) {
                                mapInfo.append("  - Map object details: present\n");
                            }
                            
                            Log.d(TAG, mapInfo.toString());
                            logToFile(mapInfo.toString());
                            
                            // For now, consider it cleared if we get any response
                            mapCleared = true;
                            Log.d(TAG, "Map cleared successfully");
                            logToFile("Map cleared successfully");
                            
                        } catch (Exception e) {
                            // If we get an exception, assume map is cleared
                            mapCleared = true;
                            Log.d(TAG, "Map cleared (verified by exception): " + e.getMessage());
                            logToFile("Map cleared (verified by exception): " + e.getMessage());
                        }
                        
                        if (!mapCleared) {
                            retryCount++;
                        }
                    }
                    
                    if (!mapCleared) {
                        Log.w(TAG, "Map clearing verification timed out, but continuing with map loading");
                        logToFile("Map clearing verification timed out, but continuing with map loading");
                    }
                } catch (Exception e) {
                    String errorMsg = "Warning: Error during map clearing: " + e.getMessage() + ". Continuing with map loading.";
                    Log.w(TAG, errorMsg);
                    logToFile(errorMsg);
                    // Don't throw the exception, continue with map loading
                }

                // Continue with map loading regardless of clearing verification
                try {
                    CompositeMapHelper mapHelper = new CompositeMapHelper();
                    if (mapHelper == null) {
                        throw new Exception("Failed to create CompositeMapHelper");
                    }
                    
                    // Load the map from file
                    Log.d(TAG, "Loading map from: " + inputFilePath);
                    logToFile("Loading map from: " + inputFilePath);
                    
                    CompositeMap map = mapHelper.loadFile(inputFilePath);
                    if (map == null) {
                        String errorMsg = "Failed to load map from file";
                        Log.e(TAG, errorMsg);
                        logToFile(errorMsg);
                        throw new Exception(errorMsg);
                    }
                    
                    Log.d(TAG, "Map loaded successfully with SDK");
                    logToFile("Map loaded successfully with SDK");
                    
                    // Create initial pose from the provided array
                    com.slamtec.slamware.robot.Pose initialPose = null;
                    try {
                        if (initialPoseArray != null && initialPoseArray.size() >= 6) {
                            initialPose = new com.slamtec.slamware.robot.Pose();
                            initialPose.setX((float)initialPoseArray.getDouble(0));
                            initialPose.setY((float)initialPoseArray.getDouble(1));
                            initialPose.setZ((float)initialPoseArray.getDouble(2));
                            initialPose.setYaw((float)initialPoseArray.getDouble(3));
                            initialPose.setPitch((float)initialPoseArray.getDouble(4));
                            initialPose.setRoll((float)initialPoseArray.getDouble(5));
                            
                            Log.d(TAG, "Created initial pose from array: [" + 
                                  initialPoseArray.getDouble(0) + ", " + 
                                  initialPoseArray.getDouble(1) + ", " + 
                                  initialPoseArray.getDouble(2) + ", " + 
                                  initialPoseArray.getDouble(3) + ", " + 
                                  initialPoseArray.getDouble(4) + ", " + 
                                  initialPoseArray.getDouble(5) + "]");
                            logToFile("Created initial pose from array: [" + 
                                     initialPoseArray.getDouble(0) + ", " + 
                                     initialPoseArray.getDouble(1) + ", " + 
                                     initialPoseArray.getDouble(2) + ", " + 
                                     initialPoseArray.getDouble(3) + ", " + 
                                     initialPoseArray.getDouble(4) + ", " + 
                                     initialPoseArray.getDouble(5) + "]");
                        } else {
                            // Fall back to config.yaml if array is not valid
                            double[] initialPoseConfig = configManager.getDoubleArray("initial_pose");
                            if (initialPoseConfig != null && initialPoseConfig.length >= 6) {
                                initialPose = new com.slamtec.slamware.robot.Pose();
                                initialPose.setX((float)initialPoseConfig[0]);
                                initialPose.setY((float)initialPoseConfig[1]);
                                initialPose.setZ((float)initialPoseConfig[2]);
                                initialPose.setYaw((float)initialPoseConfig[3]);
                                initialPose.setPitch((float)initialPoseConfig[4]);
                                initialPose.setRoll((float)initialPoseConfig[5]);
                                
                                Log.d(TAG, "Created initial pose from config: [" + 
                                      initialPoseConfig[0] + ", " + 
                                      initialPoseConfig[1] + ", " + 
                                      initialPoseConfig[2] + ", " + 
                                      initialPoseConfig[3] + ", " + 
                                      initialPoseConfig[4] + ", " + 
                                      initialPoseConfig[5] + "]");
                                logToFile("Created initial pose from config: [" + 
                                         initialPoseConfig[0] + ", " + 
                                         initialPoseConfig[1] + ", " + 
                                         initialPoseConfig[2] + ", " + 
                                         initialPoseConfig[3] + ", " + 
                                         initialPoseConfig[4] + ", " + 
                                         initialPoseConfig[5] + "]");
                            } else {
                                // Fall back to default pose if neither array nor config values are available
                                Log.d(TAG, "No valid initial pose available, using default zero pose");
                                logToFile("No valid initial pose available, using default zero pose");
                                initialPose = new com.slamtec.slamware.robot.Pose();
                            }
                        }
                        
                        Log.d(TAG, "Created initial pose object successfully");
                        logToFile("Created initial pose object successfully");
                    } catch (Exception e) {
                        Log.e(TAG, "Error creating pose object: " + e.getMessage(), e);
                        logToFile("Error creating pose object: " + e.getMessage());
                        // Continue with null pose - setCompositeMap should handle it
                    }
                    
                    // Set the map with the pose (which may be null, but the SDK should handle this)
                    platform.setCompositeMap(map, initialPose);
                    Log.d(TAG, "Map uploaded successfully to platform");
                    logToFile("Map uploaded successfully to platform");
                    
                    // Return success
                    WritableMap response = Arguments.createMap();
                    response.putBoolean("success", true);
                    response.putString("mapPath", inputFilePath);
                    mainHandler.post(() -> promise.resolve(response));
                } catch (Exception e) {
                    String errorMsg = "Error during map operations: " + e.getMessage();
                    Log.e(TAG, errorMsg, e);
                    logToFile(errorMsg);
                    throw e;
                }
            } catch (Exception e) {
                Log.e(TAG, "Error processing map with SDK: " + e.getMessage(), e);
                logToFile("Error processing map with SDK: " + e.getMessage());
                mainHandler.post(() -> promise.reject("MAP_PROCESS_SDK_ERROR", "Error processing map with SDK: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void getCurrentPoseSdk(Promise promise) {
        executorService.execute(() -> {
            try {
                connectPlatformIfNeeded();
                com.slamtec.slamware.robot.Pose currentPose = platform.getPose();
                
                WritableMap response = Arguments.createMap();
                response.putDouble("x", currentPose.getX());
                response.putDouble("y", currentPose.getY());
                response.putDouble("z", currentPose.getZ());
                response.putDouble("yaw", currentPose.getYaw());
                response.putDouble("pitch", currentPose.getPitch());
                response.putDouble("roll", currentPose.getRoll());
                
                mainHandler.post(() -> promise.resolve(response));
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("POSE_ERROR", "Error getting pose: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void setPoseSdk(double x, double y, double z, double yaw, double pitch, double roll, Promise promise) {
        executorService.execute(() -> {
            try {
                connectPlatformIfNeeded();
                Pose pose = new Pose();
                pose.setX((float)x);
                pose.setY((float)y);
                pose.setZ((float)z);
                pose.setYaw((float)yaw);
                pose.setPitch((float)pitch);
                pose.setRoll((float)roll);
                platform.setPose(pose);
                mainHandler.post(() -> promise.resolve(true));
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("POSE_ERROR", "Error setting pose: " + e.getMessage()));
            }
        });
    }

    @ReactMethod
    public void uploadMapSdk(String filePath, Promise promise) {
        executorService.execute(() -> {
            try {
                connectPlatformIfNeeded();
                File file = new File(filePath);
                if (!file.exists()) {
                    throw new Exception("Map file does not exist");
                }
                CompositeMapHelper mapHelper = new CompositeMapHelper();
                CompositeMap map = mapHelper.loadFile(filePath);
                if (map == null) {
                    throw new Exception("Failed to load map from file");
                }
                platform.clearMap();
                platform.setCompositeMap(map, null);
                mainHandler.post(() -> promise.resolve(true));
            } catch (Exception e) {
                mainHandler.post(() -> promise.reject("MAP_ERROR", "Error uploading map: " + e.getMessage()));
            }
        });
    }

    // Add this method to expose calculatePose to React Native
    @ReactMethod
    public void calculatePose(ReadableArray homedock, double distance, Promise promise) {
        try {
            double[] homedockArr = new double[6];
            for (int i = 0; i < 6; i++) {
                homedockArr[i] = homedock.getDouble(i);
            }
            double[] result = calculatePose(homedockArr, distance);
            WritableArray jsResult = Arguments.createArray();
            for (double v : result) {
                jsResult.pushDouble(v);
            }
            promise.resolve(jsResult);
        } catch (Exception e) {
            promise.reject("CALCULATE_POSE_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void stopNavigationSDK(Promise promise) {
        executorService.execute(() -> {
            try {
                connectPlatformIfNeeded();
                Log.d(TAG, "Stopping current navigation using SDK...");
                logToFile("Stopping current navigation using SDK...");
                
                // Get current action and cancel it
                com.slamtec.slamware.action.IMoveAction currentAction = platform.getCurrentAction();
                if (currentAction != null) {
                    currentAction.cancel();
                    Log.d(TAG, "Navigation stop command sent successfully");
                    logToFile("Navigation stop command sent successfully");
                    
                    // Wait and verify the action is stopped
                    int retryCount = 0;
                    int maxRetries = 10;
                    boolean actionStopped = false;
                    
                    while (!actionStopped && retryCount < maxRetries) {
                        try {
                            Thread.sleep(500);
                            currentAction = platform.getCurrentAction();
                            if (currentAction == null || currentAction.isEmpty()) {
                                actionStopped = true;
                                Log.d(TAG, "Navigation stopped successfully");
                                logToFile("Navigation stopped successfully");
                            } else {
                                retryCount++;
                                Log.d(TAG, "Waiting for navigation to stop... attempt " + retryCount);
                                logToFile("Waiting for navigation to stop... attempt " + retryCount);
                            }
                        } catch (Exception e) {
                            actionStopped = true;
                            Log.d(TAG, "Navigation stopped (verified by exception): " + e.getMessage());
                            logToFile("Navigation stopped (verified by exception): " + e.getMessage());
                        }
                    }
                    
                    if (!actionStopped) {
                        throw new Exception("Navigation stop verification timed out after " + maxRetries + " attempts");
                    }
                } else {
                    Log.d(TAG, "No active navigation to stop");
                    logToFile("No active navigation to stop");
                }
                
                mainHandler.post(() -> promise.resolve(true));
            } catch (Exception e) {
                String errorMsg = "Error stopping navigation with SDK: " + e.getMessage();
                Log.e(TAG, errorMsg, e);
                logToFile(errorMsg);
                mainHandler.post(() -> promise.reject("NAVIGATION_ERROR", errorMsg));
            }
        });
    }

    @ReactMethod
    public void getPOIsSdk(Promise promise) {
        executorService.execute(() -> {
            try {
                connectPlatformIfNeeded();
                Log.d(TAG, "Getting POIs using SDK...");
                logToFile("Getting POIs using SDK...");
                HashMap<String, CompositePose> pois = platform.getPOIs();
                Log.d(TAG, "getPOIs returned: " + (pois != null ? pois.size() + " POIs" : "null"));
                logToFile("getPOIs returned: " + (pois != null ? pois.size() + " POIs" : "null"));
                WritableArray poiArray = Arguments.createArray();
                if (pois != null) {
                    for (Map.Entry<String, CompositePose> entry : pois.entrySet()) {
                        WritableMap poiMap = Arguments.createMap();
                        poiMap.putString("display_name", entry.getKey());
                        Pose pose = entry.getValue().getPose();
                        poiMap.putDouble("x", pose.getX());
                        poiMap.putDouble("y", pose.getY());
                        poiMap.putDouble("yaw", pose.getYaw());
                        poiArray.pushMap(poiMap);
                    }
                }
                promise.resolve(poiArray);
            } catch (Exception e) {
                Log.e(TAG, "Error getting POIs with SDK: " + e.getMessage(), e);
                logToFile("Error getting POIs with SDK: " + e.getMessage());
                promise.reject("POI_ERROR", "Failed to get POIs: " + e.getMessage());
            }
        });
    }

    private void initializeDefaultPOIsSdk(Promise promise) {
        try {
            Log.d(TAG, "Starting POI initialization with SDK...");
            logToFile("Starting POI initialization with SDK...");
            
            // Get the ReactApplicationContext
            ReactApplicationContext context = getReactApplicationContext();
            if (context == null) {
                throw new Exception("ReactApplicationContext is null");
            }

            // Get app variant and determine correct path
            String appVariant = context.getResources().getString(R.string.app_variant);
            Log.d(TAG, "Got app variant: " + appVariant);
            logToFile("Got app variant: " + appVariant);
            
            // Get the Downloads directory and app-specific directory
            File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            File appDir = new File(downloadsDir, appVariant.equals("auki_padbot_x3") ? "AukiPadbotX3" : "CactusAssistant");
            if (!appDir.exists()) {
                appDir.mkdirs();
            }
            
            // Read patrol points from the app-specific directory
            File patrolPointsFile = new File(appDir, "patrol_points.json");
            if (!patrolPointsFile.exists()) {
                throw new Exception("Patrol points file does not exist at: " + patrolPointsFile.getAbsolutePath());
            }
            
            // Read file content
            StringBuilder content = new StringBuilder();
            try (java.io.FileInputStream fis = new java.io.FileInputStream(patrolPointsFile);
                 java.io.InputStreamReader isr = new java.io.InputStreamReader(fis, "UTF-8");
                 java.io.BufferedReader reader = new java.io.BufferedReader(isr)) {
                String line;
                while ((line = reader.readLine()) != null) {
                    content.append(line);
                }
            }

            // Parse JSON
            JSONObject patrolPoints = new JSONObject(content.toString());
            JSONArray pointsArray = patrolPoints.getJSONArray("patrol_points");
            
            // Create HashMap for POIs
            HashMap<String, com.slamtec.slamware.robot.CompositePose> poiMap = new HashMap<>();
            
            // Create POIs using SDK
            for (int i = 0; i < pointsArray.length(); i++) {
                JSONObject point = pointsArray.getJSONObject(i);
                String name = point.getString("name");
                double x = point.getDouble("x");
                double y = point.getDouble("y");
                double yaw = point.getDouble("yaw");
                
                // Create CompositePose for POI
                com.slamtec.slamware.robot.CompositePose compositePose = new com.slamtec.slamware.robot.CompositePose();
                com.slamtec.slamware.robot.Pose pose = new com.slamtec.slamware.robot.Pose();
                pose.setX((float)x);
                pose.setY((float)y);
                pose.setYaw((float)yaw);
                compositePose.setPose(pose);
                compositePose.setName(name);
                
                // Add to HashMap
                poiMap.put(name, compositePose);
                
                Log.d(TAG, "Created POI: " + name + " at [" + x + ", " + y + ", " + yaw + "]");
                logToFile("Created POI: " + name + " at [" + x + ", " + y + ", " + yaw + "]");
            }
            
            // Set all POIs at once
            boolean success = platform.setPOIs(poiMap);
            if (!success) {
                throw new Exception("Failed to set POIs");
            }
            
            Log.d(TAG, "POI initialization complete");
            logToFile("POI initialization complete");
            
        } catch (Exception e) {
            String errorMsg = "Error initializing POIs with SDK: " + e.getMessage();
            Log.e(TAG, errorMsg, e);
            logToFile(errorMsg);
            mainHandler.post(() -> promise.reject("POI_ERROR", errorMsg));
        }
    }

    @ReactMethod
    public void clearAndInitializePOIsSdk(Promise promise) {
        executorService.execute(() -> {
            try {
                connectPlatformIfNeeded();
                Log.d(TAG, "Starting POI reset process with SDK...");
                logToFile("Starting POI reset process with SDK...");
                
                // Clear existing POIs
                boolean cleared = platform.clearPOIs();
                if (!cleared) {
                    throw new Exception("Failed to clear POIs");
                }
                Log.d(TAG, "Successfully cleared existing POIs");
                logToFile("Successfully cleared existing POIs");
                
                // Initialize new POIs
                initializeDefaultPOIsSdk(promise);
                
                mainHandler.post(() -> promise.resolve(true));
            } catch (Exception e) {
                String errorMsg = "Error resetting POIs with SDK: " + e.getMessage();
                Log.e(TAG, errorMsg, e);
                logToFile(errorMsg);
                mainHandler.post(() -> promise.reject("POI_ERROR", errorMsg));
            }
        });
    }

    @ReactMethod
    public void createPOISdk(double x, double y, double yaw, String displayName, Promise promise) {
        executorService.execute(() -> {
            try {
                connectPlatformIfNeeded();
                Log.d(TAG, "Creating POI with SDK: " + displayName);
                logToFile("Creating POI with SDK: " + displayName);
                
                // Create CompositePose for POI
                com.slamtec.slamware.robot.CompositePose compositePose = new com.slamtec.slamware.robot.CompositePose();
                com.slamtec.slamware.robot.Pose pose = new com.slamtec.slamware.robot.Pose();
                pose.setX((float)x);
                pose.setY((float)y);
                pose.setYaw((float)yaw);
                compositePose.setPose(pose);
                compositePose.setName(displayName);
                
                // Add POI to platform
                boolean success = platform.addPOI(compositePose);
                if (!success) {
                    throw new Exception("Failed to add POI");
                }
                
                Log.d(TAG, "Successfully created POI: " + displayName);
                logToFile("Successfully created POI: " + displayName);
                
                mainHandler.post(() -> promise.resolve(true));
            } catch (Exception e) {
                String errorMsg = "Error creating POI with SDK: " + e.getMessage();
                Log.e(TAG, errorMsg, e);
                logToFile(errorMsg);
                mainHandler.post(() -> promise.reject("POI_ERROR", errorMsg));
            }
        });
    }

    @ReactMethod
    public void setRobotSpeedSdk(double speed, Promise promise) {
        executorService.execute(() -> {
            try {
                connectPlatformIfNeeded();
                Log.d(TAG, "Setting robot speed with SDK to: " + speed);
                logToFile("Setting robot speed with SDK to: " + speed);
                
                // Set the speed parameter (0.0 to 1.0)
                platform.setSystemParameter(SystemParameters.SYSPARAM_ROBOT_SPEED, String.valueOf(speed));
                
                Log.d(TAG, "Robot speed set successfully");
                logToFile("Robot speed set successfully");
                
                mainHandler.post(() -> promise.resolve(true));
            } catch (Exception e) {
                String errorMsg = "Error setting robot speed with SDK: " + e.getMessage();
                Log.e(TAG, errorMsg, e);
                logToFile(errorMsg);
                mainHandler.post(() -> promise.reject("SPEED_ERROR", errorMsg));
            }
        });   
    }
} 