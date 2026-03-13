const KMH_FACTOR = 3.6;

function haversineDistanceMeters(a, b) {
  if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) {
    return 0;
  }

  const earthRadius = 6371000;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const angle =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadius * Math.atan2(Math.sqrt(angle), Math.sqrt(1 - angle));
}

function numericValues(values) {
  return values.filter((value) => Number.isFinite(value));
}

function detectLaps(samples, config = {}) {
  const distanceThresholdMeters =
    Number.isFinite(config.lapDistanceMeters) && config.lapDistanceMeters > 0
      ? config.lapDistanceMeters
      : 0;
  const minLapSeconds =
    Number.isFinite(config.lapMinSeconds) && config.lapMinSeconds > 0 ? config.lapMinSeconds : 0;

  if (!distanceThresholdMeters || !minLapSeconds) {
    return [];
  }

  const validSamples = samples
    .map((sample, index) => ({ ...sample, sampleIndex: index }))
    .filter((sample) => sample.lat != null && sample.lon != null);

  if (validSamples.length < 2) {
    return [];
  }

  const minLapMs = minLapSeconds * 1000;
  const runStart = validSamples[0].timestamp;
  const laps = [];
  let lapStartTimestamp = validSamples[0].timestamp;

  for (let index = 1; index < validSamples.length; index += 1) {
    const current = validSamples[index];

    if (current.timestamp - lapStartTimestamp < minLapMs) {
      continue;
    }

    let match = null;
    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      const previous = validSamples[previousIndex];
      if (current.timestamp - previous.timestamp < minLapMs) {
        continue;
      }

      if (haversineDistanceMeters(current, previous) <= distanceThresholdMeters) {
        match = previous;
        break;
      }
    }

    if (!match) {
      continue;
    }

    const durationSeconds = (current.timestamp - lapStartTimestamp) / 1000;
    laps.push({
      lapNumber: laps.length + 1,
      startTime: (lapStartTimestamp - runStart) / 1000,
      endTime: (current.timestamp - runStart) / 1000,
      durationSeconds,
      crossingDistanceMeters: haversineDistanceMeters(current, match),
      sampleIndex: current.sampleIndex,
    });
    lapStartTimestamp = current.timestamp;
  }

  return laps;
}

function buildDerivedSeries(samples) {
  if (!samples.length) {
    return [];
  }

  // Convert raw timestamped samples into a chart-friendly time series.
  const start = samples[0].timestamp;
  const derived = [];

  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index];
    const previous = samples[index - 1];
    const currentSpeed = Number.isFinite(current.speed) ? current.speed : null;
    let acceleration = null;

    if (previous) {
      const dt = (current.timestamp - previous.timestamp) / 1000;
      const previousSpeed = Number.isFinite(previous.speed) ? previous.speed : null;
      if (dt > 0 && currentSpeed != null && previousSpeed != null) {
        acceleration = (currentSpeed - previousSpeed) / dt;
      }
    }

    derived.push({
      time: (current.timestamp - start) / 1000,
      speedKmh: currentSpeed != null ? currentSpeed * KMH_FACTOR : null,
      acceleration,
    });
  }

  return derived;
}

export function analyzeRun(run) {
  const samples = run.samples ?? [];
  const derived = buildDerivedSeries(samples);
  const laps = detectLaps(samples, run.config);
  const speedValues = numericValues(samples.map((sample) => sample.speed));
  // Distance is reconstructed from GNSS points so it still works if browser speed is noisy.
  const distance = samples.reduce((total, sample, index) => {
    if (index === 0) {
      return total;
    }
    return total + haversineDistanceMeters(samples[index - 1], sample);
  }, 0);

  let zeroToHundred = null;
  const threshold = 100 / KMH_FACTOR;
  const startTimestamp = samples[0]?.timestamp ?? 0;
  for (const sample of samples) {
    if (Number.isFinite(sample.speed) && sample.speed >= threshold) {
      zeroToHundred = (sample.timestamp - startTimestamp) / 1000;
      break;
    }
  }

  const accelerationSeries = numericValues(derived.map((item) => item.acceleration));

  return {
    ...run,
    analysis: {
      maxSpeedKmh: speedValues.length ? Math.max(...speedValues) * KMH_FACTOR : 0,
      averageSpeedKmh:
        speedValues.length
          ? (speedValues.reduce((total, speed) => total + speed, 0) / speedValues.length) *
            KMH_FACTOR
          : 0,
      distanceMeters: distance,
      zeroToHundredSeconds: zeroToHundred,
      peakLongitudinalAcceleration:
        accelerationSeries.length ? Math.max(...accelerationSeries) : 0,
      peakBrakingDeceleration: accelerationSeries.length ? Math.min(...accelerationSeries) : 0,
      lapCount: laps.length,
      laps,
      derived,
    },
  };
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatNumber(value, digits = 1, suffix = "") {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  return `${value.toFixed(digits)}${suffix}`;
}

export function runToCsv(run) {
  const headers = [
    "timestamp",
    "lat",
    "lon",
    "altitude",
    "speed",
    "heading",
    "accelX",
    "accelY",
    "accelZ",
  ];
  const rows = run.samples.map((sample) =>
    headers
      .map((header) => {
        const value = sample[header] ?? "";
        return typeof value === "string" ? `"${value.replaceAll('"', '""')}"` : value;
      })
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}
