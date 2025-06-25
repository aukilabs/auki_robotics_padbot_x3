// Global storage for device identifiers
interface DeviceIdentifiers {
  deviceId: string | null;
  macAddress: string | null;
  robotPoseDataId: string | null;
}

class DeviceStorage {
  private static instance: DeviceStorage;
  private identifiers: DeviceIdentifiers = {
    deviceId: null,
    macAddress: null,
    robotPoseDataId: null
  };

  private constructor() {}

  public static getInstance(): DeviceStorage {
    if (!DeviceStorage.instance) {
      DeviceStorage.instance = new DeviceStorage();
    }
    return DeviceStorage.instance;
  }

  public setIdentifiers(deviceId: string, macAddress: string): void {
    this.identifiers.deviceId = deviceId;
    this.identifiers.macAddress = macAddress;
  }

  public setRobotPoseDataId(dataId: string): void {
    this.identifiers.robotPoseDataId = dataId;
  }

  public getIdentifiers(): DeviceIdentifiers {
    return this.identifiers;
  }

  public hasIdentifiers(): boolean {
    return !!this.identifiers.deviceId && !!this.identifiers.macAddress;
  }

  public hasRobotPoseDataId(): boolean {
    return !!this.identifiers.robotPoseDataId;
  }
}

export default DeviceStorage.getInstance(); 