export class MapView {
  constructor(container) {
    this.container = container;
    this.map = null;
    this.polyline = null;
  }

  render(samples) {
    const points = samples
      .filter((sample) => sample.lat != null && sample.lon != null)
      .map((sample) => [sample.lat, sample.lon]);

    if (!points.length) {
      this.container.innerHTML =
        "<div class=\"details-empty\"><p>No GNSS positions were captured for this run.</p></div>";
      return;
    }

    this.container.innerHTML = "<div id=\"trajectoryMap\" class=\"map-frame\"></div>";

    if (this.map) {
      this.map.remove();
    }

    this.map = L.map("trajectoryMap", {
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(this.map);

    this.polyline = L.polyline(points, {
      color: "#6ef3b0",
      weight: 4,
    }).addTo(this.map);

    L.circleMarker(points[0], {
      radius: 6,
      color: "#ffffff",
      fillColor: "#10d98c",
      fillOpacity: 1,
    }).addTo(this.map);

    L.circleMarker(points[points.length - 1], {
      radius: 6,
      color: "#ffffff",
      fillColor: "#ff6a6a",
      fillOpacity: 1,
    }).addTo(this.map);

    this.map.fitBounds(this.polyline.getBounds(), {
      padding: [18, 18],
    });
  }
}
