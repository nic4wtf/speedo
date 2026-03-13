# Telemetry Tracker

Telemetry Tracker is a client-side mobile telemetry PWA for recording GNSS and accelerometer data during vehicle runs.

## Run locally

Because the app uses service workers, geolocation, and motion sensors, serve it over HTTP on a local network or HTTPS.

Examples:

```powershell
npx serve .
```

or

```powershell
python -m http.server 8080
```

Then open the site in a modern mobile browser, ideally Android Chrome, and grant location and motion permissions.

## What the MVP includes

- Run recording with geolocation and motion events
- IndexedDB persistence
- Automatic run analysis
- Map replay with Leaflet
- Speed and acceleration charts with Chart.js
- JSON and CSV export
- Installable PWA shell

## Notes

- GNSS update rates vary by phone and browser.
- Motion axes are device-relative. The current braking and acceleration metrics are estimated from speed deltas, which is more stable before phone-mount calibration is added.
- For best results, keep the phone mounted consistently and ensure high-accuracy location is enabled.

## Future improvements

- Lap detection and start-finish beacons
- Smoothing and outlier rejection
- Kalman filtering for GNSS speed and position
- Device orientation calibration for true longitudinal and lateral acceleration
- Track comparison and split timing
- Live telemetry dashboard and remote viewer
