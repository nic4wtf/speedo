export class SensorManager {
  constructor({ onLocation, onMotion, onStatus }) {
    this.onLocation = onLocation;
    this.onMotion = onMotion;
    this.onStatus = onStatus;
    this.geoWatchId = null;
    this.motionActive = false;
    this.handleMotion = this.handleMotion.bind(this);
    this.motionPermissionGranted = false;
  }

  async requestPermissions({ location = true, motion = true } = {}) {
    const issues = [];

    if (location && !("geolocation" in navigator)) {
      issues.push("Geolocation is not available in this browser.");
    }

    if (motion) {
      if (typeof DeviceMotionEvent === "undefined") {
        issues.push("Motion sensors are not available in this browser.");
      } else if (typeof DeviceMotionEvent.requestPermission === "function") {
        try {
          const result = await DeviceMotionEvent.requestPermission();
          this.motionPermissionGranted = result === "granted";
          if (!this.motionPermissionGranted) {
            issues.push("Motion sensor permission was declined.");
          }
        } catch (error) {
          issues.push("Motion sensor permission was declined.");
        }
      } else {
        this.motionPermissionGranted = true;
      }
    }

    return {
      ok: issues.length === 0,
      issues,
    };
  }

  setStreams({ location = false, motion = false } = {}) {
    if (location && this.geoWatchId == null && "geolocation" in navigator) {
      // Browsers choose the actual GNSS cadence, so we subscribe continuously and timestamp each update.
      this.geoWatchId = navigator.geolocation.watchPosition(
        (position) => {
          const coords = position.coords;
          this.onStatus?.("location", "Live");
          this.onLocation?.({
            timestamp: position.timestamp,
            lat: coords.latitude,
            lon: coords.longitude,
            altitude: coords.altitude,
            speed: coords.speed,
            heading: coords.heading,
            accuracy: coords.accuracy,
          });
        },
        (error) => {
          this.onStatus?.("location", "Error");
          this.onStatus?.(
            "permission",
            `Location error: ${error.message || "permission denied or unavailable."}`,
          );
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10000,
        },
      );
    }

    if (!location && this.geoWatchId != null) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
      this.onStatus?.("location", "Idle");
    }

    if (motion && !this.motionActive && this.motionPermissionGranted) {
      window.addEventListener("devicemotion", this.handleMotion);
      this.motionActive = true;
      this.onStatus?.("motion", "Live");
    }

    if (!motion && this.motionActive) {
      window.removeEventListener("devicemotion", this.handleMotion);
      this.motionActive = false;
      this.onStatus?.("motion", "Idle");
    }
  }

  stopAll() {
    this.setStreams({ location: false, motion: false });
  }

  handleMotion(event) {
    const linear = event.acceleration ?? event.accelerationIncludingGravity;
    const gravity = event.accelerationIncludingGravity ?? event.acceleration;
    if (!linear) {
      return;
    }
    this.onStatus?.("motion", "Live");
    this.onMotion?.({
      timestamp: performance.timeOrigin + performance.now(),
      accelX: linear.x,
      accelY: linear.y,
      accelZ: linear.z,
      gravityX: gravity?.x ?? null,
      gravityY: gravity?.y ?? null,
      gravityZ: gravity?.z ?? null,
      interval: event.interval,
      includesGravity: !event.acceleration && Boolean(event.accelerationIncludingGravity),
    });
  }
}
