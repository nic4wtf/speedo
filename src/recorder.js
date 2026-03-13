function buildRunId() {
  return `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export class RunRecorder {
  constructor({ onLiveSpeed, onSampleCount, onStatus }) {
    this.onLiveSpeed = onLiveSpeed;
    this.onSampleCount = onSampleCount;
    this.onStatus = onStatus;
    this.reset();
  }

  reset() {
    this.run = null;
    this.latestLocation = null;
    this.latestMotion = {
      accelX: null,
      accelY: null,
      accelZ: null,
    };
  }

  start() {
    const now = performance.timeOrigin + performance.now();
    this.run = {
      id: buildRunId(),
      date: new Date().toISOString(),
      startedAt: now,
      duration: 0,
      samples: [],
    };
    this.onStatus?.("recording", true);
    this.onSampleCount?.(0);
  }

  isRecording() {
    return Boolean(this.run);
  }

  ingestLocation(location) {
    this.latestLocation = location;
    const speedKmh = Number.isFinite(location.speed) ? location.speed * 3.6 : 0;
    this.onLiveSpeed?.(speedKmh);

    if (!this.isRecording()) {
      return;
    }

    this.appendSample({
      timestamp: location.timestamp ?? performance.timeOrigin + performance.now(),
      lat: location.lat,
      lon: location.lon,
      altitude: location.altitude,
      speed: location.speed,
      heading: location.heading,
      accelX: this.latestMotion.accelX,
      accelY: this.latestMotion.accelY,
      accelZ: this.latestMotion.accelZ,
    });
  }

  ingestMotion(motion) {
    this.latestMotion = motion;

    if (!this.isRecording()) {
      return;
    }

    // Each motion event gets stamped with the latest GNSS snapshot to preserve high-rate accel data.
    this.appendSample({
      timestamp: motion.timestamp,
      lat: this.latestLocation?.lat ?? null,
      lon: this.latestLocation?.lon ?? null,
      altitude: this.latestLocation?.altitude ?? null,
      speed: this.latestLocation?.speed ?? null,
      heading: this.latestLocation?.heading ?? null,
      accelX: motion.accelX,
      accelY: motion.accelY,
      accelZ: motion.accelZ,
    });
  }

  appendSample(sample) {
    this.run.samples.push(sample);
    this.onSampleCount?.(this.run.samples.length);
  }

  stop() {
    if (!this.run) {
      return null;
    }

    const stoppedAt = performance.timeOrigin + performance.now();
    this.run.duration = stoppedAt - this.run.startedAt;
    const finishedRun = this.run;
    this.onStatus?.("recording", false);
    this.reset();
    return finishedRun;
  }
}
