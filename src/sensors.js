export class SensorManager {
  constructor({ onLocation, onMotion, onStatus }) {
    this.onLocation = onLocation;
    this.onMotion = onMotion;
    this.onStatus = onStatus;
    this.geoWatchId = null;
    this.handleMotion = this.handleMotion.bind(this);
    this.motionPermissionGranted = false;
  }

  async requestPermissions() {
    const issues = [];

    if (!("geolocation" in navigator)) {
      issues.push("Geolocation is not available in this browser.");
    }

    if (typeof DeviceMotionEvent === "undefined") {
      issues.push("Motion sensors are not available in this browser.");
    } else if (typeof DeviceMotionEvent.requestPermission === "function") {
      try {
        const result = await DeviceMotionEvent.requestPermission();
        this.motionPermissionGranted = result === "granted";
      } catch (error) {
        issues.push("Motion sensor permission was declined.");
      }
    } else {
      this.motionPermissionGranted = true;
    }

    return {
      ok: issues.length === 0,
      issues,
    };
  }

  start() {
    if ("geolocation" in navigator) {
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

    if (this.motionPermissionGranted) {
      window.addEventListener("devicemotion", this.handleMotion);
    }
  }

  stop() {
    if (this.geoWatchId != null) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
    window.removeEventListener("devicemotion", this.handleMotion);
  }

  handleMotion(event) {
    const acceleration = event.acceleration ?? event.accelerationIncludingGravity;
    if (!acceleration) {
      return;
    }
    this.onStatus?.("motion", "Live");
    this.onMotion?.({
      timestamp: performance.timeOrigin + performance.now(),
      accelX: acceleration.x,
      accelY: acceleration.y,
      accelZ: acceleration.z,
      interval: event.interval,
    });
  }
}
