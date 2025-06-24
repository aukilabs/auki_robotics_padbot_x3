import { NativeEventEmitter, EmitterSubscription } from 'react-native';
import { LogUtils } from './logging';

export interface BatteryStatus {
  percentage: number;
  charging: boolean;
  isInitialValue?: boolean;
}

class SplashEventBus {
  private static instance: SplashEventBus;
  private batterySubscription?: EmitterSubscription;
  private chargingSubscription?: EmitterSubscription;

  private constructor() {}

  static getInstance(): SplashEventBus {
    if (!SplashEventBus.instance) {
      SplashEventBus.instance = new SplashEventBus();
    }
    return SplashEventBus.instance;
  }

  async waitForBatteryStatus(
    onValidBattery: (status: BatteryStatus) => void,
    onTimeout: () => void
  ): Promise<BatteryStatus> {
    let validBatteryReceived = false;

    try {
      this.batterySubscription = PadbotUtils.addBatteryListener((status: BatteryStatus) => {
        if (!validBatteryReceived && status.percentage !== -1) {
          validBatteryReceived = true;
          onValidBattery(status);
        }
      }) as EmitterSubscription;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Could not get valid battery status after 75s'));
        }, 75000);

        const checkConditions = () => {
          if (validBatteryReceived) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkConditions, 1000);
          }
        };
        checkConditions();
      });

      return await PadbotUtils.getBatteryStatus();
    } finally {
      this.cleanupBatterySubscription();
    }
  }

  async waitForCharging(
    onCharging: () => void,
    onTimeout: () => void
  ): Promise<void> {
    let chargingStarted = false;

    try {
      this.chargingSubscription = PadbotUtils.addChargingListener((info: { isCharging: boolean }) => {
        if (info.isCharging) {
          chargingStarted = true;
          onCharging();
        }
      }) as EmitterSubscription;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Could not get charging status after 75s'));
        }, 75000);

        const checkConditions = () => {
          if (chargingStarted) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkConditions, 1000);
          }
        };
        checkConditions();
      });
    } finally {
      this.cleanupChargingSubscription();
    }
  }

  private cleanupBatterySubscription() {
    if (this.batterySubscription) {
      this.batterySubscription.remove();
      this.batterySubscription = undefined;
    }
  }

  private cleanupChargingSubscription() {
    if (this.chargingSubscription) {
      this.chargingSubscription.remove();
      this.chargingSubscription = undefined;
    }
  }

  cleanup() {
    this.cleanupBatterySubscription();
    this.cleanupChargingSubscription();
  }
}

export default SplashEventBus; 