FROM python:3.12-slim

# ── System packages ──────────────────────────────────────────────────────────
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y && apt-get install -y --no-install-recommends \
    curl wget gnupg ca-certificates unzip \
    # Chrome deps
    libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    libx11-6 libx11-xcb1 libxcb1 libxext6 libxss1 libxtst6 \
    fonts-liberation libappindicator3-1 libdbus-glib-1-2 xdg-utils \
    # VNC / display + video recording
    xvfb x11vnc novnc python3-websockify openbox x11-apps xauth ffmpeg \
    # Node 20
    nodejs npm \
  && rm -rf /var/lib/apt/lists/*

# ── Chrome for Testing + matching ChromeDriver (guaranteed version parity) ────
RUN CFT_VER=$(curl -s "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['channels']['Stable']['version'])") \
  && echo "Chrome for Testing version: $CFT_VER" \
  # Chrome binary
  && curl -sL "https://storage.googleapis.com/chrome-for-testing-public/${CFT_VER}/linux64/chrome-linux64.zip" -o /tmp/chrome.zip \
  && unzip -q /tmp/chrome.zip -d /opt/ \
  && ln -sf /opt/chrome-linux64/chrome /usr/local/bin/google-chrome \
  && ln -sf /opt/chrome-linux64/chrome /usr/local/bin/chromium-browser \
  # ChromeDriver — exact same version
  && curl -sL "https://storage.googleapis.com/chrome-for-testing-public/${CFT_VER}/linux64/chromedriver-linux64.zip" -o /tmp/cd.zip \
  && unzip -q /tmp/cd.zip -d /tmp/cd/ \
  && mv /tmp/cd/chromedriver-linux64/chromedriver /usr/local/bin/chromedriver \
  && chmod +x /usr/local/bin/chromedriver /opt/chrome-linux64/chrome \
  && rm -rf /tmp/chrome.zip /tmp/cd.zip /tmp/cd/ \
  && google-chrome --version && chromedriver --version

# ── Python RF + SeleniumLibrary ──────────────────────────────────────────────
RUN pip install --no-cache-dir \
    robotframework \
    robotframework-seleniumlibrary \
    selenium \
    pandas \
    openpyxl \
    pyyaml \
    mss \
    imageio \
    numpy

# ── Custom CA certificates (e.g. internal OCP/lab environments) ──────────────
# Drop any *.crt files into packages/runner/certs/ and they will be trusted
COPY packages/runner/certs/ /usr/local/share/ca-certificates/
RUN update-ca-certificates

# ── Wrap selenium-manager with --offline so it never tries to reach the internet ─
# In air-gapped environments the network call to googlechromelabs.github.io
# times out for ~2 minutes before falling back to the local chromedriver binary.
RUN SM_PATH=$(python3 -c "import selenium, os; print(os.path.join(os.path.dirname(selenium.__file__), 'webdriver', 'common', 'linux', 'selenium-manager'))") \
  && mv "$SM_PATH" "${SM_PATH}.real" \
  && printf '#!/bin/sh\nexec "${0}.real" --offline "$@"\n' > "$SM_PATH" \
  && chmod +x "$SM_PATH"

# Inject --no-sandbox flags into every Chrome session (required in Docker)
COPY packages/runner/sitecustomize.py /tmp/sitecustomize.py
RUN python3 -c "import site; sp=site.getsitepackages(); print(sp[0])" \
    | xargs -I{} cp /tmp/sitecustomize.py {}/sitecustomize.py

WORKDIR /app

# ── Node HTTP server (runner) ─────────────────────────────────────────────────
COPY packages/runner/package.json ./packages/runner/
RUN cd packages/runner && npm install --omit=dev

COPY packages/runner/src ./packages/runner/src
COPY packages/runner/start.sh /start.sh
RUN chmod +x /start.sh

# Volumes mounted at runtime
VOLUME ["/scripts", "/artifacts"]

EXPOSE 5001
EXPOSE 6080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

CMD ["/start.sh"]
