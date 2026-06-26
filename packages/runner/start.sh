#!/bin/sh
set -e

# Start Xvfb virtual display
Xvfb :99 -screen 0 1280x1024x24 &
export DISPLAY=:99

# Start window manager (needed for some browser interactions)
fluxbox &

# Start VNC server on :99
x11vnc -display :99 -forever -nopw -quiet &

# Start noVNC websocket proxy on port 6080
/opt/noVNC/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &

# Start the runner API server
exec node src/index.js
