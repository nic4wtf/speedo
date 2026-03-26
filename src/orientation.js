const GRAVITY = 9.80665;
const AXIS_KEYS = ["x", "y", "z"];

function averageVector(accumulator, count) {
  if (!count) {
    return null;
  }

  return {
    x: accumulator.x / count,
    y: accumulator.y / count,
    z: accumulator.z / count,
  };
}

function rawVector(motion) {
  if (
    !Number.isFinite(motion?.rawAccelX) ||
    !Number.isFinite(motion?.rawAccelY) ||
    !Number.isFinite(motion?.rawAccelZ)
  ) {
    return null;
  }

  return {
    x: motion.rawAccelX,
    y: motion.rawAccelY,
    z: motion.rawAccelZ,
  };
}

function magnitude(vector) {
  return Math.hypot(vector.x ?? 0, vector.y ?? 0, vector.z ?? 0);
}

function normalize(vector, fallback = { x: 0, y: 0, z: 1 }) {
  const length = magnitude(vector);
  if (!length) {
    return { ...fallback };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function subtract(left, right) {
  return {
    x: (left?.x ?? 0) - (right?.x ?? 0),
    y: (left?.y ?? 0) - (right?.y ?? 0),
    z: (left?.z ?? 0) - (right?.z ?? 0),
  };
}

function scale(vector, factor) {
  return {
    x: (vector?.x ?? 0) * factor,
    y: (vector?.y ?? 0) * factor,
    z: (vector?.z ?? 0) * factor,
  };
}

function add(left, right) {
  return {
    x: (left?.x ?? 0) + (right?.x ?? 0),
    y: (left?.y ?? 0) + (right?.y ?? 0),
    z: (left?.z ?? 0) + (right?.z ?? 0),
  };
}

function dot(left, right) {
  return (left?.x ?? 0) * (right?.x ?? 0) + (left?.y ?? 0) * (right?.y ?? 0) + (left?.z ?? 0) * (right?.z ?? 0);
}

function cross(left, right) {
  return {
    x: (left?.y ?? 0) * (right?.z ?? 0) - (left?.z ?? 0) * (right?.y ?? 0),
    y: (left?.z ?? 0) * (right?.x ?? 0) - (left?.x ?? 0) * (right?.z ?? 0),
    z: (left?.x ?? 0) * (right?.y ?? 0) - (left?.y ?? 0) * (right?.x ?? 0),
  };
}

function dominantAxis(vector) {
  return AXIS_KEYS.reduce((best, key) =>
    Math.abs(vector[key] ?? 0) > Math.abs(vector[best] ?? 0) ? key : best,
  );
}

function projectOntoPlane(vector, normal) {
  return subtract(vector, scale(normal, dot(vector, normal)));
}

function orthogonalFallback(vertical) {
  const reference = Math.abs(vertical.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  return normalize(projectOntoPlane(reference, vertical), { x: 1, y: 0, z: 0 });
}

function dominantAxisLabel(vector) {
  const axis = dominantAxis(vector);
  const sign = Math.sign(vector[axis] || 1) || 1;
  return `${axis.toUpperCase()} ${sign > 0 ? "+" : "-"}`;
}

export class MountOrientation {
  constructor() {
    this.reset();
  }

  reset() {
    this.skipped = false;
    this.capturedGravity = null;
    this.forwardVector = null;
    this.mountCapture = {
      active: false,
      accumulator: { x: 0, y: 0, z: 0 },
      count: 0,
    };
    this.forwardCalibration = {
      active: false,
      accumulator: { x: 0, y: 0, z: 0 },
      count: 0,
      peakMagnitude: 0,
    };
  }

  ingestMotion(motion) {
    const absolute = rawVector(motion);
    if (!absolute) {
      return;
    }

    if (this.mountCapture.active) {
      this.mountCapture.accumulator = add(this.mountCapture.accumulator, absolute);
      this.mountCapture.count += 1;
    }

    if (this.forwardCalibration.active && this.capturedGravity) {
      const corrected = subtract(absolute, this.capturedGravity);
      const vertical = this.getVerticalUnit();
      const horizontal = projectOntoPlane(corrected, vertical);
      const horizontalMagnitude = magnitude(horizontal);

      if (horizontalMagnitude >= 0.35) {
        this.forwardCalibration.accumulator = add(
          this.forwardCalibration.accumulator,
          scale(horizontal, horizontalMagnitude),
        );
        this.forwardCalibration.peakMagnitude = Math.max(
          this.forwardCalibration.peakMagnitude,
          horizontalMagnitude,
        );
        this.forwardCalibration.count += 1;
      }
    }
  }

  startMountCapture() {
    this.skipped = false;
    this.mountCapture = {
      active: true,
      accumulator: { x: 0, y: 0, z: 0 },
      count: 0,
    };
  }

  finishMountCapture() {
    const capturedGravity = averageVector(this.mountCapture.accumulator, this.mountCapture.count);
    this.mountCapture.active = false;
    this.mountCapture.accumulator = { x: 0, y: 0, z: 0 };
    this.mountCapture.count = 0;

    if (!capturedGravity) {
      return false;
    }

    const gravityMagnitude = magnitude(capturedGravity);
    if (gravityMagnitude < 4 || gravityMagnitude > 15) {
      return false;
    }

    this.capturedGravity = capturedGravity;
    this.forwardVector = null;
    return true;
  }

  startForwardCalibration() {
    this.forwardCalibration = {
      active: true,
      accumulator: { x: 0, y: 0, z: 0 },
      count: 0,
      peakMagnitude: 0,
    };
  }

  finishForwardCalibration() {
    const sampleCount = this.forwardCalibration.count;
    this.forwardCalibration.active = false;

    if (!sampleCount) {
      return false;
    }

    const averagedDirection = scale(this.forwardCalibration.accumulator, 1 / sampleCount);
    const directionMagnitude = magnitude(averagedDirection);
    if (directionMagnitude < 0.2 || this.forwardCalibration.peakMagnitude < 0.8) {
      this.forwardCalibration.accumulator = { x: 0, y: 0, z: 0 };
      this.forwardCalibration.count = 0;
      this.forwardCalibration.peakMagnitude = 0;
      return false;
    }

    this.forwardVector = normalize(averagedDirection, orthogonalFallback(this.getVerticalUnit()));
    this.forwardCalibration.accumulator = { x: 0, y: 0, z: 0 };
    this.forwardCalibration.count = 0;
    this.forwardCalibration.peakMagnitude = 0;
    return true;
  }

  skipCalibration() {
    this.skipped = true;
    this.capturedGravity = null;
    this.forwardVector = null;
    this.mountCapture.active = false;
    this.forwardCalibration.active = false;
  }

  isSkipped() {
    return this.skipped;
  }

  hasMountCapture() {
    return Boolean(this.capturedGravity);
  }

  hasForwardCalibration() {
    return Boolean(this.forwardVector);
  }

  isConfigured() {
    return this.isSkipped() || (this.hasMountCapture() && this.hasForwardCalibration());
  }

  getVerticalUnit() {
    return normalize(this.capturedGravity ?? { x: 0, y: 0, z: GRAVITY });
  }

  getForwardUnit() {
    return this.forwardVector
      ? normalize(this.forwardVector, orthogonalFallback(this.getVerticalUnit()))
      : orthogonalFallback(this.getVerticalUnit());
  }

  getLateralUnit() {
    return normalize(cross(this.getForwardUnit(), this.getVerticalUnit()), { x: 1, y: 0, z: 0 });
  }

  getStatus() {
    const vertical = this.getVerticalUnit();
    const forward = this.getForwardUnit();
    const mode = this.isSkipped()
      ? "GPS-only mode"
      : this.isConfigured()
        ? "Custom mount locked"
        : this.hasMountCapture()
          ? "Mount captured / forward pending"
          : "Setup required";

    return {
      mode,
      upLabel: this.isSkipped() ? "Skipped" : dominantAxisLabel(vertical),
      forwardLabel: this.isSkipped()
        ? "Skipped"
        : this.hasForwardCalibration()
          ? dominantAxisLabel(forward)
          : "Pending",
      capturingMount: this.mountCapture.active,
      calibratingForward: this.forwardCalibration.active,
      skipped: this.isSkipped(),
    };
  }

  project(motion) {
    if (this.isSkipped()) {
      return {
        lateralG: 0,
        longitudinalG: 0,
        verticalG: 0,
        lateralAxis: "GPS only",
        longitudinalAxis: "GPS only",
        verticalAxis: "GPS only",
        usesCalibration: false,
        skipped: true,
      };
    }

    const vertical = this.getVerticalUnit();
    const forward = this.getForwardUnit();
    const lateral = this.getLateralUnit();
    const corrected = this.hasMountCapture() && rawVector(motion)
      ? subtract(rawVector(motion), this.capturedGravity)
      : { x: 0, y: 0, z: 0 };

    return {
      lateralG: dot(corrected, lateral) / GRAVITY,
      longitudinalG: dot(corrected, forward) / GRAVITY,
      verticalG: dot(corrected, vertical) / GRAVITY,
      lateralAxis: dominantAxisLabel(lateral),
      longitudinalAxis: this.hasForwardCalibration() ? dominantAxisLabel(forward) : "Pending",
      verticalAxis: this.hasMountCapture() ? dominantAxisLabel(vertical) : "Pending",
      usesCalibration: this.hasMountCapture(),
      skipped: this.isSkipped(),
    };
  }
}
