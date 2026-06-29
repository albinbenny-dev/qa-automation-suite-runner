#!/bin/bash
set -e

# ── Virtual display ──────────────────────────────────────────────────────────
# Remove stale lock/socket left by a previously stopped container
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

Xvfb :99 -screen 0 1280x900x24 -ac +extension GLX +render -noreset 2>&1 &
XVFB_PID=$!
export DISPLAY=:99

# Wait until the X11 socket appears (up to 20s) — no xdpyinfo needed
for i in $(seq 1 40); do
  [ -S /tmp/.X11-unix/X99 ] && break
  sleep 0.5
done
if [ ! -S /tmp/.X11-unix/X99 ]; then
  echo "ERROR: Xvfb display :99 did not become ready (pid $XVFB_PID)" >&2
  exit 1
fi
echo "Xvfb ready on :99"

# ── Window manager (keeps browsers from crashing without a WM) ───────────────
openbox &

# ── VNC server ───────────────────────────────────────────────────────────────
x11vnc -display :99 -forever -nopw -quiet -rfbport 5900 &

# ── noVNC websocket proxy on port 6080 ───────────────────────────────────────
websockify --web /usr/share/novnc 6080 localhost:5900 &

echo "VNC ready on :5900 — noVNC on :6080"

# ── Runner HTTP server ────────────────────────────────────────────────────────
exec node /app/packages/runner/src/index.js
