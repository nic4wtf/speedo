function buildRunId() {
  return `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeLimit(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
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
    this.sampleIntervalMs = 0;
    this.lastLoggedAt = 0;
  }

  start(options = {}) {
    const now = performance.timeOrigin + performance.now();
    const sampleRateHz = normalizeLimit(options.sampleRateHz);
    const maxDurationSeconds = normalizeLimit(options.maxDurationSeconds);
    const lapDistanceMeters = normalizeLimit(options.lapDistanceMeters);
    const lapMinSeconds = normalizeLimit(options.lapMinSeconds);

    this.run = {
      id: buildRunId(),
      date: new Date().toISOString(),
      startedAt: now,
      duration: 0,
      config: {
        sampleRateHz,
        maxDurationSeconds,
        lapDistanceMeters,
        lapMinSeconds,
      },
      samples: [],
    };
    this.sampleIntervalMs = sampleRateHz > 0 ? 1000 / sampleRateHz : 0;
    this.lastLoggedAt = 0;
    this.onStatus?.("recording", true);
    this.onSampleCount?.(0);
  }

  isRecording() {
    return Boolean(this.run);
  }

  ingestLocation(location) {
    this.latestLocation = location;
    if (Number.isFinite(location.speed)) {
      this.onLiveSpeed?.(location.speed * 3.6);
    }

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
      source: "location",
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
      source: "motion",
    });
  }

  appendSample(sample) {
    if (!this.run) {
      return;
    }

    if (this.sampleIntervalMs > 0 && this.lastLoggedAt > 0) {
      const elapsed = sample.timestamp - this.lastLoggedAt;
      if (elapsed < this.sampleIntervalMs) {
        return;
      }
    }

    this.run.samples.push(sample);
    this.lastLoggedAt = sample.timestamp;
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
