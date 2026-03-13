import { analyzeRun, formatDuration, formatNumber, runToCsv } from "./analysis.js";
import { RunCharts } from "./charts.js";
import { MapView } from "./mapview.js";
import { RunRecorder } from "./recorder.js";
import { SensorManager } from "./sensors.js";
import { RunStorage } from "./storage.js";

function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export class TelemetryUI {
  constructor() {
    this.storage = new RunStorage();
    this.recorder = new RunRecorder({
      onLiveSpeed: (speed) => this.updateLiveSpeed(speed),
      onSampleCount: (count) => {
        this.sampleCount.textContent = String(count);
      },
      onStatus: (_, recording) => this.setRecordingState(recording),
    });
    this.sensors = new SensorManager({
      onLocation: (payload) => this.recorder.ingestLocation(payload),
      onMotion: (payload) => this.recorder.ingestMotion(payload),
      onStatus: (type, message) => this.handleSensorStatus(type, message),
    });

    this.deferredPrompt = null;
    this.selectedRun = null;
    this.mapView = null;
    this.charts = null;
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    this.registerPwa();
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
    this.runList = document.getElementById("runList");
    this.runDetails = document.getElementById("runDetails");
    this.detailTitle = document.getElementById("detailTitle");
    this.exportJsonButton = document.getElementById("exportJsonButton");
    this.exportCsvButton = document.getElementById("exportCsvButton");
    this.installButton = document.getElementById("installButton");
  }

  bindEvents() {
    this.startButton.addEventListener("click", () => this.handleStartRun());
    this.stopButton.addEventListener("click", () => this.handleStopRun());
    this.exportJsonButton.addEventListener("click", () => this.exportRun("json"));
    this.exportCsvButton.addEventListener("click", () => this.exportRun("csv"));
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
  }

  async registerPwa() {
    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("./sw.js");
      } catch (error) {
        console.warn("Service worker registration failed", error);
      }
    }
  }

  async handleStartRun() {
    const permissions = await this.sensors.requestPermissions();
    if (!permissions.ok) {
      this.showPermissionMessage(permissions.issues.join(" "));
    } else {
      this.showPermissionMessage("");
    }

    this.recorder.start();
    this.sensors.start();
    this.startButton.disabled = true;
    this.stopButton.disabled = false;
  }

  async handleStopRun() {
    this.sensors.stop();
    const run = this.recorder.stop();
    this.startButton.disabled = false;
    this.stopButton.disabled = true;

    if (!run) {
      return;
    }

    const analyzed = analyzeRun(run);
    await this.storage.saveRun(analyzed);
    await this.refreshRuns(analyzed.id);
  }

  async refreshRuns(selectRunId = this.selectedRun?.id) {
    const runs = await this.storage.getRuns();
    this.renderRunList(runs, selectRunId);

    if (runs.length) {
      const targetId = selectRunId ?? runs[0].id;
      const run = runs.find((item) => item.id === targetId) ?? runs[0];
      this.renderRunDetails(run);
    } else {
      this.selectedRun = null;
      this.exportJsonButton.disabled = true;
      this.exportCsvButton.disabled = true;
      this.runDetails.innerHTML =
        '<div class="details-empty"><p>Select a run to inspect speed, acceleration, braking, and trajectory.</p></div>';
    }
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
      const card = document.createElement("button");
      card.className = `run-card${run.id === selectedId ? " active" : ""}`;
      card.type = "button";
      card.innerHTML = `
        <p class="eyebrow">${new Date(run.date).toLocaleString()}</p>
        <h3>${formatNumber(run.analysis?.maxSpeedKmh, 1, " km/h")} max</h3>
        <div class="run-meta">
          <span>0-100 ${formatNumber(run.analysis?.zeroToHundredSeconds, 2, " s")}</span>
          <span>${formatDuration(run.duration)}</span>
          <span>${run.samples.length} samples</span>
        </div>
      `;
      card.addEventListener("click", () => this.renderRunDetails(run));
      this.runList.appendChild(card);
    }
  }

  renderRunDetails(run) {
    this.selectedRun = run;
    this.detailTitle.textContent = new Date(run.date).toLocaleString();
    this.exportJsonButton.disabled = false;
    this.exportCsvButton.disabled = false;

    this.runDetails.innerHTML = `
      <div class="detail-grid">
        <article class="detail-stat"><span>Duration</span><strong>${formatDuration(run.duration)}</strong></article>
        <article class="detail-stat"><span>Max Speed</span><strong>${formatNumber(run.analysis.maxSpeedKmh, 1, " km/h")}</strong></article>
        <article class="detail-stat"><span>Average Speed</span><strong>${formatNumber(run.analysis.averageSpeedKmh, 1, " km/h")}</strong></article>
        <article class="detail-stat"><span>Distance</span><strong>${formatNumber(run.analysis.distanceMeters / 1000, 2, " km")}</strong></article>
        <article class="detail-stat"><span>0-100 km/h</span><strong>${formatNumber(run.analysis.zeroToHundredSeconds, 2, " s")}</strong></article>
        <article class="detail-stat"><span>Peak Accel</span><strong>${formatNumber(run.analysis.peakLongitudinalAcceleration, 2, " m/s^2")}</strong></article>
        <article class="detail-stat"><span>Peak Braking</span><strong>${formatNumber(run.analysis.peakBrakingDeceleration, 2, " m/s^2")}</strong></article>
        <article class="detail-stat"><span>Samples</span><strong>${run.samples.length}</strong></article>
      </div>
      <section id="mapMount"></section>
      <section id="chartMount"></section>
    `;

    this.renderRunListFromCurrentSelection(run.id);
    this.mapView = new MapView(document.getElementById("mapMount"));
    this.mapView.render(run.samples);
    this.charts = new RunCharts(document.getElementById("chartMount"));
    this.charts.render(run.analysis.derived);
  }

  async renderRunListFromCurrentSelection(selectedId) {
    const runs = await this.storage.getRuns();
    this.renderRunList(runs, selectedId);
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
