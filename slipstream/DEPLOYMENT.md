# Codespaces server, nearby Bluetooth laptop, phone controllers

```mermaid
flowchart LR
  P[Phone or browser controller] <-->|HTTPS / WebSocket| S[Codespaces: pages and room relay]
  S <-->|HTTPS / WebSocket| H[Nearby laptop: host browser and game loop]
  H <-->|Web Bluetooth| C[1–4 physical cars]
```

The browser on the nearby laptop owns all Bluetooth connections. The server does
not connect to the cars, and phones do not need Web Bluetooth. Human and computer
drivers share the same host control loop. The laptop can also be a human player.
Use Chrome or Edge with Web Bluetooth support on that laptop. Keep its host tab
visible, its lid open, and sleep disabled for the supervised session. Remote
latency affects phone inputs; rendering and the control loop run separately.

## GitHub Codespaces

1. Open this branch in a Codespace using the supplied `.devcontainer` configuration.
   It installs the locked Node dependencies without install scripts.
2. Run `PORT=3000 npm run slipstream` in the Codespace terminal. Keep the terminal's
   host code private to the operator. It authorizes room creation.
3. Open the forwarded port 3000 URL, appending `/slipstream/`, on the nearby laptop.
   Use the browser-facing **HTTPS** URL, normally
   `https://CODESPACENAME-3000.app.github.dev/slipstream/`. The upstream server is
   plain HTTP: leave the forwarded port's **protocol** set to HTTP.
4. Connect cars on that laptop, or choose the two-car simulation first. Enter the
   printed host code in Remote players and create a room. Approve players before
   assigning them to cars. Each car's Code button provides its phone join link.
5. Open those links on the phones. Forwarded ports are private by default;
   GitHub's authentication/organization rules still apply before the app loads.
   Choose the class's permitted port visibility in GitHub if needed. This repository
   does not publish the port or change access settings. Do not put GitHub tokens
   in join links. App join credentials do not bypass GitHub's access gate.

Codespace stop/rebuild or server restart destroys in-memory rooms. Create a fresh
room and rejoin; do not expect continuity. Printed status messages do not guarantee
Codespace uptime. Verify an approved phone can join, send inputs and reconnect
through the actual classroom network before operating physical cars.

## Standalone Docker

```sh
docker compose up --build
```

Open `http://127.0.0.1:3000/slipstream/` locally. The image runs as the unprivileged
`node` user. Compose publishes only to the Docker host's loopback interface;
phones cannot reach that address from another device. For remote phones, provide
an HTTPS reverse proxy or authorized port forward with WebSocket and streaming
response support. Use the resulting HTTPS address for the host page too, so the
join links have the right origin. Do not expose the plain HTTP port directly.

`--container` explicitly binds the process to `0.0.0.0` inside the container and
requires `--slipstream`. Normal starts remain loopback-only. The game assets use
same-origin dependencies, including pinned Three.js; no graphics CDN is required.

## Presentation and physical limits

The host has adjustable desktop panel widths, responsive stacked layouts, and
an optional 3D studio. Phones use the lighter dedicated controller with optional
haptics and tilt when supported and enabled. Haptics are supplemental: visual
feedback remains necessary on browsers that do not implement vibration.

The 3D studio is an original procedural visualization, not the Unity game or a
measured 3D digital twin. Elevation and occlusion at crossings cannot be inferred
reliably from the current telemetry. Circuit planning does not certify a physical
track. Treat stale or inferred positions accordingly.

Phone loss is handled by existing stale-input stops. A dead host browser cannot
send STOP: a car-enforced host-loss timeout remains unverified. Keep physical
supervision and a way to retrieve cars during initial hardware validation.

Verified locally: Docker build, non-root process, HTTP assets, browser rendering,
and automated relay tests. Actual Codespaces forwarding, phone sensors, and
Bluetooth hardware remain to be tested in the target environment.

References: [GitHub port forwarding](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace),
[Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth),
[Three.js](https://threejs.org/docs/).
