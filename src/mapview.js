let mapInstanceCounter = 0;

export class MapView {
  constructor(container) {
    this.container = container;
    this.map = null;
    this.polyline = null;
  }

  render(samples, options = {}) {
    const points = samples
      .filter((sample) => sample.lat != null && sample.lon != null)
      .map((sample) => [sample.lat, sample.lon]);

    if (!points.length) {
      this.container.innerHTML =
        "<div class=\"details-empty\"><p>No GNSS positions were captured for this run.</p></div>";
      return;
    }

    if (this.map) {
      this.map.remove();
    }

    const mapId = `trajectoryMap-${mapInstanceCounter += 1}`;
    const frameClass = options.compact ? "map-frame compact-map" : "map-frame";
    this.container.innerHTML = `<div id="${mapId}" class="${frameClass}"></div>`;

    this.map = L.map(mapId, {
      zoomControl: false,
      attributionControl: !options.compact,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(this.map);

    this.polyline = L.polyline(points, {
      color: "#ff7a2f",
      weight: options.compact ? 3 : 4,
    }).addTo(this.map);

    L.circleMarker(points[0], {
      radius: options.compact ? 5 : 6,
      color: "#ffffff",
      fillColor: "#ff4121",
      fillOpacity: 1,
    }).addTo(this.map);

    L.circleMarker(points[points.length - 1], {
      radius: options.compact ? 5 : 6,
      color: "#ffffff",
      fillColor: "#ff6a6a",
      fillOpacity: 1,
    }).addTo(this.map);

    this.map.fitBounds(this.polyline.getBounds(), {
      padding: options.compact ? [10, 10] : [18, 18],
    });
  }
}
