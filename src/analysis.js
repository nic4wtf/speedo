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
