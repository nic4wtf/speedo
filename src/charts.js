export class RunCharts {
  constructor(container) {
    this.container = container;
    this.speedChart = null;
    this.accelChart = null;
  }

  destroy() {
    this.speedChart?.destroy();
    this.accelChart?.destroy();
  }

  render(derivedSamples) {
    this.destroy();
    this.container.innerHTML = `
      <div class="chart-grid">
        <div class="chart-card">
          <h3>Speed vs Time</h3>
          <canvas id="speedChart"></canvas>
        </div>
        <div class="chart-card">
          <h3>Acceleration vs Time</h3>
          <canvas id="accelChart"></canvas>
        </div>
      </div>
    `;

    const labels = derivedSamples.map((item) => item.time.toFixed(1));
    const speedCanvas = this.container.querySelector("#speedChart");
    const accelCanvas = this.container.querySelector("#accelChart");
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        intersect: false,
        mode: "index",
      },
      plugins: {
        legend: {
          labels: {
            color: "#f4f8fb",
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#9db0bb" },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
        y: {
          ticks: { color: "#9db0bb" },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
      },
    };

    this.speedChart = new Chart(speedCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "km/h",
            data: derivedSamples.map((item) => item.speedKmh),
            borderColor: "#6ef3b0",
            backgroundColor: "rgba(110,243,176,0.18)",
            fill: true,
            tension: 0.22,
            pointRadius: 0,
          },
        ],
      },
      options: chartOptions,
    });

    this.accelChart = new Chart(accelCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "m/s^2",
            data: derivedSamples.map((item) => item.acceleration),
            borderColor: "#ffd36c",
            backgroundColor: "rgba(255,211,108,0.16)",
            fill: true,
            tension: 0.22,
            pointRadius: 0,
          },
        ],
      },
      options: chartOptions,
    });
  }
}
