import { analyzeRun, formatDuration, formatNumber, runToCsv } from "./analysis.js";
import { RunCharts } from "./charts.js";
import { LightMotionFilter } from "./filters.js";
import { IMUView } from "./imuview.js";
import { MapView } from "./mapview.js";
import { MountOrientation } from "./orientation.js";
import { RunRecorder } from "./recorder.js";
import { SensorManager } from "./sensors.js";
import { RunStorage } from "./storage.js";

const GRAVITY = 9.80665;

function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseLimitValue(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value || value === "-") {
    return 0;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  return numeric;
}

function formatLimit(value, suffix) {
  return value > 0 ? `${value} ${suffix}` : "Unlimited";
}

function formatG(value) {
  return `${value.toFixed(2)} g`;
}

export class TelemetryUI {
  constructor() {
    this.storage = new RunStorage();
    this.orientation = new MountOrientation();
    this.motionFilter = new LightMotionFilter(0.18);
    this.recorder = new RunRecorder({
      onLiveSpeed: (speed) => this.updateLiveSpeed(speed),
      onSampleCount: (count) => {
        this.sampleCount.textContent = String(count);
      },
      onStatus: (_, recording) => this.setRecordingState(recording),
    });
    this.sensors = new SensorManager({
      onLocation: (payload) => this.handleLocation(payload),
      onMotion: (payload) => this.handleMotion(payload),
      onStatus: (type, message) => this.handleSensorStatus(type, message),
    });

    this.deferredPrompt = null;
    this.selectedRun = null;
    this.runs = [];
    this.mapView = null;
    this.charts = null;
    this.imuView = null;
    this.currentPage = "recorderPage";
    this.recordingActive = false;
    this.imuStreaming = false;
    this.elapsedTimer = null;
    this.maxDurationTimer = null;
    this.mountCaptureTimer = null;
    this.calibrationTimer = null;
    this.wakeLock = null;
    this.serviceWorkerRegistration = null;
    this.liveSpeedState = this.createLiveSpeedState();
  }

  async init() {
    this.cacheElements();
    this.imuView = new IMUView(this.imuMount);
    this.bindEvents();
    this.registerPwa();
    this.updateSettingSummary();
    this.refreshOrientationSummary();
    this.drawGForceCircle(this.orientation.project(null));
    this.syncSensors();
    await this.refreshRuns();
  }

  cacheElements() {
    this.liveSpeed = document.getElementById("liveSpeed");
    this.startButton = document.getElementById("startButton");
    this.stopButton = document.getElementById("stopButton");
    this.recordingState = document.getElementById("recordingState");
    this.locationStatus = document.getElementById("locationStatus");
    this.motionStatus = document.getElementById("motionStatus");
    this.permissionMessage = document.getElementById("permissionMessage");
    this.sampleCount = document.getElementById("sampleCount");
    this.elapsedValue = document.getElementById("elapsedValue");
    this.runList = document.getElementById("runList");
    this.runSummaryBar = document.getElementById("runSummaryBar");
    this.runDetails = document.getElementById("runDetails");
    this.detailTitle = document.getElementById("detailTitle");
    this.exportJsonButton = document.getElementById("exportJsonButton");
    this.exportCsvButton = document.getElementById("exportCsvButton");
    this.deleteRunButton = document.getElementById("deleteRunButton");
    this.checkUpdatesButton = document.getElementById("checkUpdatesButton");
    this.installButton = document.getElementById("installButton");
    this.sampleRateInput = document.getElementById("sampleRateInput");
    this.maxDurationInput = document.getElementById("maxDurationInput");
    this.lapDistanceInput = document.getElementById("lapDistanceInput");
    this.lapMinTimeInput = document.getElementById("lapMinTimeInput");
    this.rateSummary = document.getElementById("rateSummary");
    this.durationSummary = document.getElementById("durationSummary");
    this.lapSummary = document.getElementById("lapSummary");
    this.orientationSummary = document.getElementById("orientationSummary");
    this.calibrationStatus = document.getElementById("calibrationStatus");
    this.captureMountButton = document.getElementById("captureMountButton");
    this.calibrateForwardButton = document.getElementById("calibrateForwardButton");
    this.skipCalibrationButton = document.getElementById("skipCalibrationButton");
    this.lateralLabel = document.getElementById("lateralLabel");
    this.longitudinalLabel = document.getElementById("longitudinalLabel");
    this.verticalLabel = document.getElementById("verticalLabel");
    this.lateralG = document.getElementById("lateralG");
    this.longitudinalG = document.getElementById("longitudinalG");
    this.verticalG = document.getElementById("verticalG");
    this.gForceCanvas = document.getElementById("gForceCanvas");
    this.enableImuButton = document.getElementById("enableImuButton");
    this.disableImuButton = document.getElementById("disableImuButton");
    this.imuMount = document.getElementById("imuMount");
    this.pages = [...document.querySelectorAll(".page")];
    this.tabButtons = [...document.querySelectorAll(".tab-button")];
  }

  createLiveSpeedState() {
    return {
      estimatedSpeedMps: 0,
      lastMotionTimestamp: 0,
      hasGnssFix: false,
    };
  }

  bindEvents() {
    this.startButton.addEventListener("click", () => this.handleStartRun());
    this.stopButton.addEventListener("click", () => this.handleStopRun());
    this.exportJsonButton.addEventListener("click", () => this.exportRun("json"));
    this.exportCsvButton.addEventListener("click", () => this.exportRun("csv"));
    this.deleteRunButton.addEventListener("click", () => this.handleDeleteRun());
    this.checkUpdatesButton.addEventListener("click", () => this.handleCheckForUpdates());
    this.sampleRateInput.addEventListener("input", () => this.updateSettingSummary());
    this.maxDurationInput.addEventListener("input", () => this.updateSettingSummary());
    this.lapDistanceInput.addEventListener("input", () => this.updateSettingSummary());
    this.lapMinTimeInput.addEventListener("input", () => this.updateSettingSummary());
    this.captureMountButton.addEventListener("click", () => this.handleCaptureMount());
    this.calibrateForwardButton.addEventListener("click", () => this.handleStartCalibration());
    this.skipCalibrationButton.addEventListener("click", () => this.handleSkipCalibration());
    this.enableImuButton.addEventListener("click", () => this.handleEnableImu());
    this.disableImuButton.addEventListener("click", () => this.handleDisableImu());

    for (const button of this.tabButtons) {
      button.addEventListener("click", () => this.showPage(button.dataset.page));
    }

    this.installButton.addEventListener("click", async () => {
      if (!this.deferredPrompt) {
        return;
      }
      this.deferredPrompt.prompt();
      await this.deferredPrompt.userChoice;
      this.installButton.hidden = true;
      this.deferredPrompt = null;
    });

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.deferredPrompt = event;
      this.installButton.hidden = false;
    });

    document.addEventListener("visibilitychange", () => this.handleVisibilityChange());
  }

  async registerPwa() {
    if ("serviceWorker" in navigator) {
      try {
        this.serviceWorkerRegistration = await navigator.serviceWorker.register("./sw.js");
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (this.reloadingForUpdate) {
            return;
          }
          this.reloadingForUpdate = true;
          window.location.reload();
        });
      } catch (error) {
        console.warn("Service worker registration failed", error);
      }
    }
  }

  async handleCheckForUpdates() {
    if (!this.serviceWorkerRegistration) {
      this.showPermissionMessage("Update checks are unavailable because the service worker is not active.");
      return;
    }

    this.checkUpdatesButton.disabled = true;

    try {
      await this.serviceWorkerRegistration.update();
      const installingWorker = this.serviceWorkerRegistration.installing;
      if (installingWorker) {
        await new Promise((resolve) => {
          installingWorker.addEventListener("statechange", () => {
            if (installingWorker.state === "installed") {
              resolve();
            }
          });
        });
      }

      if (this.serviceWorkerRegistration.waiting) {
        this.showPermissionMessage("New version found. Reloading into the latest build.");
        this.serviceWorkerRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
        return;
      }

      this.showPermissionMessage("You are already on the latest version available to this phone.");
    } catch (error) {
      console.warn("Update check failed", error);
      this.showPermissionMessage("Update check failed. Make sure the phone is online and try again.");
    } finally {
      this.checkUpdatesButton.disabled = false;
    }
  }

  showPage(pageId) {
    this.currentPage = pageId;
    for (const page of this.pages) {
      page.classList.toggle("active", page.id === pageId);
    }

    for (const button of this.tabButtons) {
      button.classList.toggle("active", button.dataset.page === pageId);
    }

    this.syncSensors();
  }

  getRecorderOptions() {
    return {
      sampleRateHz: parseLimitValue(this.sampleRateInput.value),
      maxDurationSeconds: parseLimitValue(this.maxDurationInput.value),
      lapDistanceMeters: parseLimitValue(this.lapDistanceInput.value),
      lapMinSeconds: parseLimitValue(this.lapMinTimeInput.value),
    };
  }

  updateSettingSummary() {
    const options = this.getRecorderOptions();
    this.rateSummary.textContent = formatLimit(options.sampleRateHz, "Hz");
    this.durationSummary.textContent = formatLimit(options.maxDurationSeconds, "s");
    this.lapSummary.textContent =
      options.lapDistanceMeters > 0 && options.lapMinSeconds > 0
        ? `${options.lapDistanceMeters} m / ${options.lapMinSeconds} s`
        : "Disabled";
  }

  getBestQuarterMile(runs = this.runs) {
    return runs.reduce((best, run) => {
      const current = run.analysis?.quarterMileSeconds;
      if (!Number.isFinite(current)) {
        return best;
      }
      if (best == null || current < best) {
        return current;
      }
      return best;
    }, null);
  }

  renderRunSummary(runs) {
    const bestQuarterMile = this.getBestQuarterMile(runs);
    this.runSummaryBar.innerHTML = `
      <article class="detail-stat">
        <span>Saved Runs</span>
        <strong>${runs.length}</strong>
      </article>
      <article class="detail-stat">
        <span>Best 1/4 Mile</span>
        <strong>${formatNumber(bestQuarterMile, 2, " s")}</strong>
      </article>
    `;
  }

  refreshOrientationSummary() {
    const status = this.orientation.getStatus();
    this.orientationSummary.textContent = `${status.mode} (${status.upLabel}, ${status.forwardLabel})`;
    this.calibrationStatus.textContent = status.skipped
      ? "GPS-only mode enabled"
      : status.capturingMount
      ? "Capturing mount angle"
      : status.calibratingForward
        ? "Calibrating forward"
        : this.orientation.isConfigured()
          ? "Orientation ready"
          : this.orientation.hasMountCapture()
            ? "Forward calibration needed"
            : "Capture mount first";
    this.calibrationStatus.className = `status-pill ${
      status.capturingMount || status.calibratingForward ? "recording" : "idle"
    }`;
  }

  async ensureMotionStream(message) {
    const permissions = await this.sensors.requestPermissions({ location: false, motion: true });
    if (!permissions.ok) {
      this.showPermissionMessage(permissions.issues.join(" "));
      return false;
    }

    if (!this.recordingActive) {
      this.imuStreaming = true;
      this.syncSensors();
    }

    if (message) {
      this.showPermissionMessage(message);
    }
    return true;
  }

  async handleCaptureMount() {
    const ready = await this.ensureMotionStream(
      "Capturing mount angle. Leave the phone fixed and still for a moment.",
    );
    if (!ready) {
      return;
    }

    this.orientation.startMountCapture();
    this.motionFilter.reset();
    if (this.mountCaptureTimer) {
      window.clearTimeout(this.mountCaptureTimer);
    }
    this.mountCaptureTimer = window.setTimeout(() => {
      this.completeMountCapture();
    }, 1400);
    this.refreshOrientationSummary();
  }

  handleSkipCalibration() {
    this.orientation.skipCalibration();
    this.refreshOrientationSummary();
    this.drawGForceCircle(this.orientation.project(null));
    if (!this.recordingActive) {
      this.imuStreaming = false;
      this.syncSensors();
    }
    this.showPermissionMessage(
      "IMU calibration skipped. Runs can record with GPS only, and g-force orientation will stay disabled.",
    );
  }

  completeMountCapture() {
    if (this.mountCaptureTimer) {
      window.clearTimeout(this.mountCaptureTimer);
      this.mountCaptureTimer = null;
    }

    const captured = this.orientation.finishMountCapture();
    this.refreshOrientationSummary();
    this.drawGForceCircle(this.orientation.project(null));
    this.showPermissionMessage(
      captured
        ? "Mount angle captured from raw accelerometer data. Now use Calibrate Forward and drive straight ahead."
        : "Mount capture failed. Hold the phone still on the mount and make sure absolute accelerometer data is available.",
    );
  }

  async handleStartCalibration() {
    if (!this.orientation.hasMountCapture()) {
      this.showPermissionMessage("Capture the mount angle before calibrating forward motion.");
      return;
    }

    const ready = await this.ensureMotionStream(
      "Forward calibration started. Drive straight forward for about 3 seconds.",
    );
    if (!ready) {
      return;
    }

    this.orientation.startForwardCalibration();
    this.motionFilter.reset();
    if (this.calibrationTimer) {
      window.clearTimeout(this.calibrationTimer);
    }
    this.calibrationTimer = window.setTimeout(() => {
      this.completeCalibration();
    }, 3400);
    this.refreshOrientationSummary();
  }

  completeCalibration() {
    if (this.calibrationTimer) {
      window.clearTimeout(this.calibrationTimer);
      this.calibrationTimer = null;
    }

    const updated = this.orientation.finishForwardCalibration();
    this.refreshOrientationSummary();
    this.showPermissionMessage(
      updated
        ? "Forward calibration complete. Vehicle axes are now locked from the raw accelerometer calibration."
        : "Forward calibration failed. Drive straight with a clear forward acceleration and try again.",
    );
  }

  async handleStartRun() {
    if (!this.orientation.isConfigured()) {
      this.showPermissionMessage(
        "Capture the mount angle and calibrate forward before starting a measurement run, or skip IMU calibration for GPS-only logging.",
      );
      return;
    }

    const permissions = await this.sensors.requestPermissions({
      location: true,
      motion: !this.orientation.isSkipped(),
    });
    if (!permissions.ok) {
      this.showPermissionMessage(permissions.issues.join(" "));
      return;
    }
    this.showPermissionMessage("");

    const options = this.getRecorderOptions();
    this.recordingActive = true;
    this.motionFilter.reset();
    this.liveSpeedState = this.createLiveSpeedState();
    this.updateLiveSpeed(0);
    this.recorder.start(options);
    await this.requestNotificationPermission();
    await this.acquireWakeLock();
    this.startButton.disabled = true;
    this.stopButton.disabled = false;
    this.startElapsedTimer();
    this.scheduleAutoStop(options.maxDurationSeconds);
    this.syncSensors();
  }

  async handleStopRun(reason = "manual") {
    if (!this.recordingActive && !this.recorder.isRecording()) {
      return;
    }

    this.recordingActive = false;
    this.clearMaxDurationTimer();
    this.stopElapsedTimer();
    await this.releaseWakeLock();
    await this.clearRecordingNotification();
    this.syncSensors();
    this.liveSpeedState = this.createLiveSpeedState();
    this.motionFilter.reset();

    const run = this.recorder.stop();
    this.startButton.disabled = false;
    this.stopButton.disabled = true;
    this.elapsedValue.textContent = "0:00";

    if (!run || run.samples.length === 0) {
      this.showPermissionMessage("No telemetry samples were captured for this run.");
      return;
    }

    if (reason === "auto-stop") {
      this.showPermissionMessage("Recording stopped automatically at the configured time limit.");
    }

    const analyzed = analyzeRun(run);
    await this.storage.saveRun(analyzed);
    await this.refreshRuns(analyzed.id);
  }

  async handleEnableImu() {
    const ready = await this.ensureMotionStream("");
    if (!ready) {
      return;
    }
    this.showPage("imuPage");
  }

  handleDisableImu() {
    this.imuStreaming = false;
    this.motionFilter.reset();
    this.updateImuButtons();
    this.syncSensors();
  }

  updateImuButtons() {
    this.enableImuButton.disabled = this.imuStreaming;
    this.disableImuButton.disabled = !this.imuStreaming;
  }

  async requestNotificationPermission() {
    if (!("Notification" in window) || Notification.permission !== "default") {
      return;
    }

    try {
      await Notification.requestPermission();
    } catch (error) {
      console.warn("Notification permission request failed", error);
    }
  }

  async acquireWakeLock() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") {
      return;
    }

    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => {
        this.wakeLock = null;
      });
    } catch (error) {
      console.warn("Wake lock request failed", error);
      this.showPermissionMessage(
        "Screen wake lock was not granted. Keep the phone awake manually while recording.",
      );
    }
  }

  async releaseWakeLock() {
    if (!this.wakeLock) {
      return;
    }

    try {
      await this.wakeLock.release();
    } catch (error) {
      console.warn("Wake lock release failed", error);
    }
    this.wakeLock = null;
  }

  async showRecordingNotification() {
    if (!this.serviceWorkerRegistration || !("Notification" in window)) {
      return;
    }

    if (Notification.permission !== "granted") {
      return;
    }

    await this.serviceWorkerRegistration.showNotification("Telemetry recording in progress", {
      body: "Keep the app visible and the phone unlocked for the most reliable sensor capture.",
      tag: "telemetry-recording",
      icon: "./assets/icon.svg",
      badge: "./assets/icon.svg",
      requireInteraction: true,
      renotify: false,
      silent: true,
    });
  }

  async clearRecordingNotification() {
    if (!this.serviceWorkerRegistration) {
      return;
    }

    const notifications = await this.serviceWorkerRegistration.getNotifications({
      tag: "telemetry-recording",
    });
    for (const notification of notifications) {
      notification.close();
    }
  }

  async handleVisibilityChange() {
    if (!this.recordingActive) {
      return;
    }

    if (document.visibilityState === "visible") {
      await this.acquireWakeLock();
      await this.clearRecordingNotification();
      return;
    }

    await this.showRecordingNotification();
    this.showPermissionMessage(
      "Recording is still marked active, but most mobile browsers may pause sensors if the app is hidden or the phone is locked.",
    );
  }

  syncSensors() {
    this.sensors.setStreams({
      location: this.recordingActive || this.currentPage === "recorderPage",
      motion: this.imuStreaming || (this.recordingActive && !this.orientation.isSkipped()),
    });
    this.updateImuButtons();
  }

  handleLocation(payload) {
    if (Number.isFinite(payload.speed)) {
      this.liveSpeedState.estimatedSpeedMps = Math.max(0, payload.speed);
      this.liveSpeedState.lastMotionTimestamp = payload.timestamp ?? 0;
      this.liveSpeedState.hasGnssFix = true;
      this.updateLiveSpeed(this.liveSpeedState.estimatedSpeedMps * 3.6);
    }

    this.recorder.ingestLocation(payload);
  }

  handleMotion(payload) {
    const filteredMotion = this.motionFilter.process(payload);
    this.orientation.ingestMotion(filteredMotion);
    const projection = this.orientation.project(filteredMotion);
    this.updateLiveSpeedFromMotion(filteredMotion, projection);
    this.refreshOrientationSummary();
    this.drawGForceCircle(projection);
    this.imuView.update(filteredMotion);
    this.recorder.ingestMotion(filteredMotion);
  }

  updateLiveSpeedFromMotion(payload, projection) {
    if (!this.recordingActive || !this.liveSpeedState.hasGnssFix) {
      return;
    }

    const timestamp = payload?.timestamp ?? 0;
    if (!timestamp) {
      return;
    }

    const previousTimestamp = this.liveSpeedState.lastMotionTimestamp;
    this.liveSpeedState.lastMotionTimestamp = timestamp;
    if (!previousTimestamp) {
      return;
    }

    const deltaSeconds = Math.min(Math.max((timestamp - previousTimestamp) / 1000, 0), 0.15);
    if (!deltaSeconds) {
      return;
    }

    const longitudinalAccel = (projection?.longitudinalG ?? 0) * GRAVITY;
    const estimatedSpeedMps = Math.max(
      0,
      this.liveSpeedState.estimatedSpeedMps + longitudinalAccel * deltaSeconds,
    );

    this.liveSpeedState.estimatedSpeedMps = estimatedSpeedMps;
    this.updateLiveSpeed(estimatedSpeedMps * 3.6);
  }

  startElapsedTimer() {
    this.stopElapsedTimer();
    this.elapsedValue.textContent = "0:00";
    this.elapsedTimer = window.setInterval(() => {
      if (!this.recorder.run?.startedAt) {
        return;
      }
      const elapsed = performance.timeOrigin + performance.now() - this.recorder.run.startedAt;
      this.elapsedValue.textContent = formatDuration(elapsed);
    }, 250);
  }

  stopElapsedTimer() {
    if (this.elapsedTimer) {
      window.clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  scheduleAutoStop(maxDurationSeconds) {
    this.clearMaxDurationTimer();
    if (maxDurationSeconds <= 0) {
      return;
    }
    this.maxDurationTimer = window.setTimeout(() => {
      this.handleStopRun("auto-stop");
    }, maxDurationSeconds * 1000);
  }

  clearMaxDurationTimer() {
    if (this.maxDurationTimer) {
      window.clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  drawGForceCircle(projection) {
    const context = this.gForceCanvas.getContext("2d");
    const width = this.gForceCanvas.width;
    const height = this.gForceCanvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.34;
    const lateral = projection?.lateralG ?? 0;
    const longitudinal = -(projection?.longitudinalG ?? 0);
    const vertical = projection?.verticalG ?? 0;
    const scale = radius / 1.6;
    const pointX = centerX + Math.max(-1.6, Math.min(1.6, lateral)) * scale;
    const pointY = centerY + Math.max(-1.6, Math.min(1.6, longitudinal)) * scale;

    context.clearRect(0, 0, width, height);
    context.strokeStyle = "rgba(255,255,255,0.16)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();

    context.beginPath();
    context.arc(centerX, centerY, radius * 0.5, 0, Math.PI * 2);
    context.stroke();

    context.beginPath();
    context.moveTo(centerX - radius, centerY);
    context.lineTo(centerX + radius, centerY);
    context.moveTo(centerX, centerY - radius);
    context.lineTo(centerX, centerY + radius);
    context.stroke();

    context.fillStyle = "rgba(255,153,88,0.18)";
    context.beginPath();
    context.arc(centerX, centerY, radius * 0.12, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#ff7a2f";
    context.beginPath();
    context.arc(pointX, pointY, 12, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#9db0bb";
    context.font = "600 14px Barlow";
    context.textAlign = "center";
    context.fillText("Brake", centerX, centerY + radius + 24);
    context.fillText("Accel", centerX, centerY - radius - 14);
    context.fillText("L", centerX - radius - 16, centerY + 4);
    context.fillText("R", centerX + radius + 16, centerY + 4);

    this.lateralLabel.textContent = `Sideways (${projection?.lateralAxis ?? "?"})`;
    this.longitudinalLabel.textContent = `Forward (${projection?.longitudinalAxis ?? "?"})`;
    this.verticalLabel.textContent = `Vertical (${projection?.verticalAxis ?? "?"})`;
    this.lateralG.textContent = formatG(lateral);
    this.longitudinalG.textContent = formatG(-longitudinal);
    this.verticalG.textContent = formatG(vertical);
  }

  async refreshRuns(selectRunId = this.selectedRun?.id) {
    this.runs = await this.storage.getRuns();
    this.renderRunSummary(this.runs);
    this.renderRunList(this.runs, selectRunId);

    if (this.runs.length) {
      const targetId = selectRunId ?? this.runs[0].id;
      const run = this.runs.find((item) => item.id === targetId) ?? this.runs[0];
      this.renderRunDetails(run);
    } else {
      this.selectedRun = null;
      this.exportJsonButton.disabled = true;
      this.exportCsvButton.disabled = true;
      this.deleteRunButton.disabled = true;
      this.runDetails.innerHTML =
        '<div class="details-empty"><p>Select a run to inspect speed, acceleration, braking, and trajectory.</p></div>';
    }
  }

  async handleDeleteRun() {
    if (!this.selectedRun) {
      return;
    }

    const confirmed = window.confirm(
      `Delete the run from ${new Date(this.selectedRun.date).toLocaleString()}?`,
    );
    if (!confirmed) {
      return;
    }

    await this.storage.deleteRun(this.selectedRun.id);
    this.showPermissionMessage("Run deleted.");
    await this.refreshRuns();
  }

  renderRunList(runs, selectedId) {
    if (!runs.length) {
      this.runList.className = "run-list empty-state";
      this.runList.innerHTML =
        "<p>No runs yet. Record a session to start building telemetry history.</p>";
      return;
    }

    this.runList.className = "run-list";
    this.runList.innerHTML = "";

    for (const run of runs) {
      const rateSummary =
        run.config?.sampleRateHz > 0 ? `${run.config.sampleRateHz} Hz` : "Unlimited rate";
      const lapSummary =
        run.analysis?.lapCount > 0 ? `${run.analysis.lapCount} laps` : "No laps detected";
      const card = document.createElement("button");
      card.className = `run-card${run.id === selectedId ? " active" : ""}`;
      card.type = "button";
      card.innerHTML = `
        <p class="eyebrow">${new Date(run.date).toLocaleString()}</p>
        <h3>${formatNumber(run.analysis?.maxSpeedKmh, 1, " km/h")} max</h3>
        <div class="run-meta">
          <span>0-100 ${formatNumber(run.analysis?.zeroToHundredSeconds, 2, " s")}</span>
          <span>1/4 ${formatNumber(run.analysis?.quarterMileSeconds, 2, " s")}</span>
          <span>${formatDuration(run.duration)}</span>
          <span>${run.samples.length} samples</span>
          <span>${rateSummary}</span>
          <span>${lapSummary}</span>
        </div>
      `;
      card.addEventListener("click", () => this.renderRunDetails(run));
      this.runList.appendChild(card);
    }
  }

  renderRunDetails(run) {
    this.selectedRun = run;
    this.renderRunList(this.runs, run.id);
    this.detailTitle.textContent = new Date(run.date).toLocaleString();
    this.exportJsonButton.disabled = false;
    this.exportCsvButton.disabled = false;
    this.deleteRunButton.disabled = false;

    const lapMarkup =
      run.analysis.laps.length > 0
        ? `
          <section id="contextMapMount"></section>
          <section class="lap-list">
            ${run.analysis.laps
              .map(
                (lap) => `
                  <article class="lap-row">
                    <span>Lap ${lap.lapNumber}</span>
                    <strong>${formatNumber(lap.durationSeconds, 2, " s")}</strong>
                  </article>
                `,
              )
              .join("")}
          </section>
        `
        : '<section id="contextMapMount"></section><div class="details-empty"><p>No automatic laps detected for this run.</p></div>';

    this.runDetails.innerHTML = `
      <div class="detail-grid">
        <article class="detail-stat"><span>Duration</span><strong>${formatDuration(run.duration)}</strong></article>
        <article class="detail-stat"><span>Max Speed</span><strong>${formatNumber(run.analysis.maxSpeedKmh, 1, " km/h")}</strong></article>
        <article class="detail-stat"><span>Average Speed</span><strong>${formatNumber(run.analysis.averageSpeedKmh, 1, " km/h")}</strong></article>
        <article class="detail-stat"><span>Distance</span><strong>${formatNumber(run.analysis.distanceMeters / 1000, 2, " km")}</strong></article>
        <article class="detail-stat"><span>0-100 km/h</span><strong>${formatNumber(run.analysis.zeroToHundredSeconds, 2, " s")}</strong></article>
        <article class="detail-stat"><span>1/4 Mile</span><strong>${formatNumber(run.analysis.quarterMileSeconds, 2, " s")}</strong></article>
        <article class="detail-stat"><span>Peak Accel</span><strong>${formatNumber(run.analysis.peakLongitudinalAcceleration, 2, " m/s^2")}</strong></article>
        <article class="detail-stat"><span>Peak Braking</span><strong>${formatNumber(run.analysis.peakBrakingDeceleration, 2, " m/s^2")}</strong></article>
        <article class="detail-stat"><span>Laps</span><strong>${run.analysis.lapCount}</strong></article>
      </div>
      ${lapMarkup}
      <section id="chartMount"></section>
    `;

    this.mapView = new MapView(document.getElementById("contextMapMount"));
    this.mapView.render(run.samples, { compact: true });
    this.charts = new RunCharts(document.getElementById("chartMount"));
    this.charts.render(run.analysis.derived);
  }

  updateLiveSpeed(speed) {
    this.liveSpeed.textContent = Number.isFinite(speed) ? Math.round(speed).toString() : "0";
  }

  setRecordingState(recording) {
    this.recordingState.textContent = recording ? "Recording now" : "Ready to record";
    this.recordingState.className = `status-pill ${recording ? "recording" : "idle"}`;
  }

  handleSensorStatus(type, message) {
    if (type === "location") {
      this.locationStatus.textContent = message;
      return;
    }
    if (type === "motion") {
      this.motionStatus.textContent = message;
      return;
    }
    if (type === "permission") {
      this.showPermissionMessage(message);
    }
  }

  showPermissionMessage(message) {
    this.permissionMessage.hidden = !message;
    this.permissionMessage.textContent = message;
  }

  exportRun(format) {
    if (!this.selectedRun) {
      return;
    }

    const safeDate = this.selectedRun.date.replaceAll(":", "-");
    if (format === "json") {
      downloadBlob(
        `${safeDate}-${this.selectedRun.id}.json`,
        JSON.stringify(this.selectedRun, null, 2),
        "application/json",
      );
      return;
    }

    downloadBlob(
      `${safeDate}-${this.selectedRun.id}.csv`,
      runToCsv(this.selectedRun),
      "text/csv;charset=utf-8",
    );
  }
}
