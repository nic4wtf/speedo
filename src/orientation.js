const GRAVITY = 9.80665;
const AXIS_KEYS = ["x", "y", "z"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dominantAxis(vector) {
  return AXIS_KEYS.reduce((best, key) =>
    Math.abs(vector[key] ?? 0) > Math.abs(vector[best] ?? 0) ? key : best,
  );
}

function otherAxes(excludedKey) {
  return AXIS_KEYS.filter((key) => key !== excludedKey);
}

function axisValue(motion, axis) {
  return motion?.[`accel${axis.toUpperCase()}`] ?? 0;
}

export class MountOrientation {
  constructor() {
    this.reset();
  }

  reset() {
    this.gravityVector = { x: 0, y: 0, z: GRAVITY };
    this.verticalAxis = "z";
    this.verticalSign = 1;
    this.forwardAxis = "y";
    this.forwardSign = 1;
    this.forwardScores = { x: 0, y: 0, z: 0 };
    this.manualForward = null;
    this.currentSpeedSlope = 0;
    this.lastSpeed = null;
    this.lastSpeedTimestamp = null;
    this.calibration = {
      active: false,
      startedAt: 0,
      durationMs: 3000,
      accumulator: { x: 0, y: 0, z: 0 },
      count: 0,
    };
  }

  ingestLocation(location) {
    if (!Number.isFinite(location?.speed)) {
      return;
    }

    if (this.lastSpeed != null && this.lastSpeedTimestamp != null) {
      const dt = (location.timestamp - this.lastSpeedTimestamp) / 1000;
      if (dt > 0) {
        this.currentSpeedSlope = (location.speed - this.lastSpeed) / dt;
      }
    }

    this.lastSpeed = location.speed;
    this.lastSpeedTimestamp = location.timestamp;
  }

  ingestMotion(motion) {
    if (
      Number.isFinite(motion?.gravityX) &&
      Number.isFinite(motion?.gravityY) &&
      Number.isFinite(motion?.gravityZ)
    ) {
      const alpha = 0.08;
      this.gravityVector.x =
        (1 - alpha) * this.gravityVector.x + alpha * clamp(motion.gravityX, -20, 20);
      this.gravityVector.y =
        (1 - alpha) * this.gravityVector.y + alpha * clamp(motion.gravityY, -20, 20);
      this.gravityVector.z =
        (1 - alpha) * this.gravityVector.z + alpha * clamp(motion.gravityZ, -20, 20);

      this.verticalAxis = dominantAxis(this.gravityVector);
      this.verticalSign = Math.sign(this.gravityVector[this.verticalAxis] || 1);
    }

    const horizontalAxes = otherAxes(this.verticalAxis);
    const speedSlope = this.currentSpeedSlope;

    for (const axis of horizontalAxes) {
      const value = axisValue(motion, axis);
      const weightedMagnitude = Math.abs(value);
      this.forwardScores[axis] = this.forwardScores[axis] * 0.98 + weightedMagnitude;

      if (Math.abs(speedSlope) > 0.12) {
        this.forwardScores[axis] += value * speedSlope * 0.2;
      }
    }

    if (this.calibration.active) {
      for (const axis of horizontalAxes) {
        this.calibration.accumulator[axis] += axisValue(motion, axis);
      }
      this.calibration.count += 1;
    }

    if (!this.manualForward) {
      this.updateAutomaticForwardAxis(horizontalAxes);
    }
  }

  updateAutomaticForwardAxis(horizontalAxes) {
    const forwardAxis = horizontalAxes.reduce((best, axis) =>
      Math.abs(this.forwardScores[axis]) > Math.abs(this.forwardScores[best]) ? axis : best,
    );

    this.forwardAxis = forwardAxis;
    const signedScore = this.forwardScores[forwardAxis];
    this.forwardSign = signedScore === 0 ? 1 : Math.sign(signedScore);
  }

  startCalibration() {
    this.calibration = {
      active: true,
      startedAt: performance.timeOrigin + performance.now(),
      durationMs: 3000,
      accumulator: { x: 0, y: 0, z: 0 },
      count: 0,
    };
  }

  finishCalibration() {
    const sampleCount = this.calibration.count;
    this.calibration.active = false;

    const horizontalAxes = otherAxes(this.verticalAxis);
    if (sampleCount === 0) {
      return false;
    }

    const averages = {};
    for (const axis of horizontalAxes) {
      averages[axis] = this.calibration.accumulator[axis] / sampleCount;
    }

    this.calibration.accumulator = { x: 0, y: 0, z: 0 };
    this.calibration.count = 0;

    const forwardAxis = horizontalAxes.reduce((best, axis) =>
      Math.abs(averages[axis]) > Math.abs(averages[best]) ? axis : best,
    );

    const forwardSign = Math.sign(averages[forwardAxis] || 1);
    this.manualForward = {
      axis: forwardAxis,
      sign: forwardSign || 1,
    };
    this.forwardAxis = this.manualForward.axis;
    this.forwardSign = this.manualForward.sign;
    return true;
  }

  getStatus() {
    const mode = this.manualForward ? "Manual forward calibrated" : "Auto mount estimate";
    const upLabel = `${this.verticalAxis.toUpperCase()} ${this.verticalSign > 0 ? "+" : "-"}`;
    const forwardLabel = `${this.forwardAxis.toUpperCase()} ${this.forwardSign > 0 ? "+" : "-"}`;

    return {
      mode,
      upLabel,
      forwardLabel,
      calibrating: this.calibration.active,
    };
  }

  project(motion) {
    const verticalAxis = this.verticalAxis;
    const forwardAxis = this.forwardAxis;
    const lateralAxis = otherAxes(verticalAxis).find((axis) => axis !== forwardAxis) ?? "x";

    return {
      lateralG: axisValue(motion, lateralAxis) / GRAVITY,
      longitudinalG: (axisValue(motion, forwardAxis) * this.forwardSign) / GRAVITY,
      verticalG: (axisValue(motion, verticalAxis) * this.verticalSign) / GRAVITY,
      lateralAxis,
      longitudinalAxis: forwardAxis,
      verticalAxis,
    };
  }
}
