const GRAVITY = 9.80665;
const AXIS_KEYS = ["x", "y", "z"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseAxisSelection(selection) {
  if (!selection || selection === "auto") {
    return null;
  }

  return {
    axis: selection[0],
    sign: selection[1] === "-" ? -1 : 1,
  };
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

export class MountOrientation {
  constructor() {
    this.reset();
  }

  reset() {
    this.gravityVector = { x: 0, y: 0, z: GRAVITY };
    this.autoVertical = { axis: "z", sign: 1 };
    this.verticalPreference = "auto";
    this.forwardPreference = "auto";
    this.calibratedForward = null;
    this.calibration = {
      active: false,
      accumulator: { x: 0, y: 0, z: 0 },
      count: 0,
    };
  }

  setVerticalPreference(selection) {
    this.verticalPreference = selection || "auto";
  }

  setForwardPreference(selection) {
    this.forwardPreference = selection || "auto";
  }

  ingestLocation() {
    // Forward calibration is motion-driven for now, so location is not needed here.
  }

  ingestMotion(motion) {
    if (
      Number.isFinite(motion?.gravityX) &&
      Number.isFinite(motion?.gravityY) &&
      Number.isFinite(motion?.gravityZ)
    ) {
      const alpha = 0.06;
      this.gravityVector.x =
        (1 - alpha) * this.gravityVector.x + alpha * clamp(motion.gravityX, -20, 20);
      this.gravityVector.y =
        (1 - alpha) * this.gravityVector.y + alpha * clamp(motion.gravityY, -20, 20);
      this.gravityVector.z =
        (1 - alpha) * this.gravityVector.z + alpha * clamp(motion.gravityZ, -20, 20);

      const axis = dominantAxis(this.gravityVector);
      const sign = Math.sign(this.gravityVector[axis] || 1) || 1;
      this.autoVertical = { axis, sign };
    }

    if (!this.calibration.active) {
      return;
    }

    const verticalAxis = this.getVertical().axis;
    const horizontalAxes = otherAxes(verticalAxis);
    for (const axis of horizontalAxes) {
      this.calibration.accumulator[axis] += axisValue(motion, axis);
    }
    this.calibration.count += 1;
  }

  startCalibration() {
    this.calibration = {
      active: true,
      accumulator: { x: 0, y: 0, z: 0 },
      count: 0,
    };
  }

  finishCalibration() {
    const verticalAxis = this.getVertical().axis;
    const horizontalAxes = otherAxes(verticalAxis);
    const sampleCount = this.calibration.count;
    this.calibration.active = false;

    if (sampleCount === 0) {
      return false;
    }

    const averages = {};
    for (const axis of horizontalAxes) {
      averages[axis] = this.calibration.accumulator[axis] / sampleCount;
    }

    const forwardAxis = horizontalAxes.reduce((best, axis) =>
      Math.abs(averages[axis]) > Math.abs(averages[best]) ? axis : best,
    );
    const forwardSign = Math.sign(averages[forwardAxis] || 1) || 1;

    this.calibratedForward = {
      axis: forwardAxis,
      sign: forwardSign,
    };
    this.calibration.accumulator = { x: 0, y: 0, z: 0 };
    this.calibration.count = 0;
    return true;
  }

  getVertical() {
    return parseAxisSelection(this.verticalPreference) ?? this.autoVertical;
  }

  getForward() {
    const verticalAxis = this.getVertical().axis;
    const manualForward = parseAxisSelection(this.forwardPreference);
    if (manualForward && manualForward.axis !== verticalAxis) {
      return manualForward;
    }

    if (this.calibratedForward && this.calibratedForward.axis !== verticalAxis) {
      return this.calibratedForward;
    }

    const fallbackAxis = otherAxes(verticalAxis)[0] ?? "y";
    return { axis: fallbackAxis, sign: 1 };
  }

  getStatus() {
    const vertical = this.getVertical();
    const forward = this.getForward();
    const verticalMode = this.verticalPreference === "auto" ? "Auto vertical" : "Manual vertical";
    const forwardMode =
      this.forwardPreference !== "auto"
        ? "manual forward"
        : this.calibratedForward
          ? "calibrated forward"
          : "default forward";

    return {
      mode: `${verticalMode} / ${forwardMode}`,
      upLabel: `${vertical.axis.toUpperCase()} ${vertical.sign > 0 ? "+" : "-"}`,
      forwardLabel: `${forward.axis.toUpperCase()} ${forward.sign > 0 ? "+" : "-"}`,
      calibrating: this.calibration.active,
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
