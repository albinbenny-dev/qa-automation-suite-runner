#!/bin/bash
set -e

# ── Virtual display ──────────────────────────────────────────────────────────
Xvfb :99 -screen 0 1280x900x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99
sleep 1

# ── Window manager (keeps browsers from crashing without a WM) ───────────────
openbox &

# ── VNC server ───────────────────────────────────────────────────────────────
x11vnc -display :99 -forever -nopw -quiet -rfbport 5900 &

# ── noVNC websocket proxy on port 6080 ───────────────────────────────────────
websockify --web /usr/share/novnc 6080 localhost:5900 &

echo "VNC ready on :5900 — noVNC on :6080"

# ── Runner HTTP server ────────────────────────────────────────────────────────
exec node /app/packages/runner/src/index.js
