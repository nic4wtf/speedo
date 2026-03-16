const GRAVITY = 9.80665;
const AXIS_KEYS = ["x", "y", "z"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function otherAxes(excludedKey) {
  return AXIS_KEYS.filter((key) => key !== excludedKey);
}

function axisValue(motion, axis) {
  return motion?.[`accel${axis.toUpperCase()}`] ?? 0;
}

function dominantAxis(vector) {
  return AXIS_KEYS.reduce((best, key) =>
    Math.abs(vector[key] ?? 0) > Math.abs(vector[best] ?? 0) ? key : best,
  );
}

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

export class MountOrientation {
  constructor() {
    this.reset();
  }

  reset() {
    this.liveGravity = { x: 0, y: 0, z: GRAVITY };
    this.capturedGravity = null;
    this.calibratedForward = null;
    this.mountCapture = {
      active: false,
      accumulator: { x: 0, y: 0, z: 0 },
      count: 0,
    };
    this.forwardCalibration = {
      active: false,
      accumulator: { x: 0, y: 0, z: 0 },
      count: 0,
    };
  }

  ingestMotion(motion) {
    if (
      Number.isFinite(motion?.gravityX) &&
      Number.isFinite(motion?.gravityY) &&
      Number.isFinite(motion?.gravityZ)
    ) {
      const alpha = 0.06;
      this.liveGravity.x = (1 - alpha) * this.liveGravity.x + alpha * clamp(motion.gravityX, -20, 20);
      this.liveGravity.y = (1 - alpha) * this.liveGravity.y + alpha * clamp(motion.gravityY, -20, 20);
      this.liveGravity.z = (1 - alpha) * this.liveGravity.z + alpha * clamp(motion.gravityZ, -20, 20);
    }

    if (this.mountCapture.active) {
      this.mountCapture.accumulator.x += this.liveGravity.x;
      this.mountCapture.accumulator.y += this.liveGravity.y;
      this.mountCapture.accumulator.z += this.liveGravity.z;
      this.mountCapture.count += 1;
    }

    if (this.forwardCalibration.active) {
      const verticalAxis = this.getVertical().axis;
      for (const axis of otherAxes(verticalAxis)) {
        this.forwardCalibration.accumulator[axis] += axisValue(motion, axis);
      }
      this.forwardCalibration.count += 1;
    }
  }

  startMountCapture() {
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

    this.capturedGravity = capturedGravity;
    this.calibratedForward = null;
    return true;
  }

  startForwardCalibration() {
    this.forwardCalibration = {
      active: true,
      accumulator: { x: 0, y: 0, z: 0 },
      count: 0,
    };
  }

  finishForwardCalibration() {
    const verticalAxis = this.getVertical().axis;
    const horizontalAxes = otherAxes(verticalAxis);
    const sampleCount = this.forwardCalibration.count;
    this.forwardCalibration.active = false;

    if (!sampleCount) {
      return false;
    }

    const averages = {};
    for (const axis of horizontalAxes) {
      averages[axis] = this.forwardCalibration.accumulator[axis] / sampleCount;
    }

    const forwardAxis = horizontalAxes.reduce((best, axis) =>
      Math.abs(averages[axis]) > Math.abs(averages[best]) ? axis : best,
    );
    const forwardSign = Math.sign(averages[forwardAxis] || 1) || 1;

    this.calibratedForward = { axis: forwardAxis, sign: forwardSign };
    this.forwardCalibration.accumulator = { x: 0, y: 0, z: 0 };
    this.forwardCalibration.count = 0;
    return true;
  }

  hasMountCapture() {
    return Boolean(this.capturedGravity);
  }

  isConfigured() {
    return this.hasMountCapture() && Boolean(this.calibratedForward);
  }

  getVertical() {
    const source = this.capturedGravity ?? this.liveGravity;
    const axis = dominantAxis(source);
    const sign = Math.sign(source[axis] || 1) || 1;
    return { axis, sign };
  }

  getForward() {
    if (this.calibratedForward && this.calibratedForward.axis !== this.getVertical().axis) {
      return this.calibratedForward;
    }

    const fallbackAxis = otherAxes(this.getVertical().axis)[0] ?? "y";
    return { axis: fallbackAxis, sign: 1 };
  }

  getStatus() {
    const vertical = this.getVertical();
    const forward = this.getForward();
    const mode = this.isConfigured()
      ? "Mount captured / forward calibrated"
      : this.hasMountCapture()
        ? "Mount captured / forward pending"
        : "Setup required";

    return {
      mode,
      upLabel: `${vertical.axis.toUpperCase()} ${vertical.sign > 0 ? "+" : "-"}`,
      forwardLabel: `${forward.axis.toUpperCase()} ${forward.sign > 0 ? "+" : "-"}`,
      capturingMount: this.mountCapture.active,
      calibratingForward: this.forwardCalibration.active,
    };
  }

  project(motion) {
    const vertical = this.getVertical();
    const forward = this.getForward();
    const lateralAxis = otherAxes(vertical.axis).find((axis) => axis !== forward.axis) ?? "x";

    return {
      lateralG: axisValue(motion, lateralAxis) / GRAVITY,
      longitudinalG: (axisValue(motion, forward.axis) * forward.sign) / GRAVITY,
      verticalG: (axisValue(motion, vertical.axis) * vertical.sign) / GRAVITY,
      lateralAxis,
      longitudinalAxis: forward.axis,
      verticalAxis: vertical.axis,
    };
  }
}
