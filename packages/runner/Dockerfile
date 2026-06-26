FROM python:3.12-slim

# ── System packages ──────────────────────────────────────────────────────────
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    curl wget gnupg ca-certificates unzip \
    # Chrome deps
    libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    libx11-6 libx11-xcb1 libxcb1 libxext6 libxss1 libxtst6 \
    fonts-liberation libappindicator3-1 libdbus-glib-1-2 xdg-utils \
    # Firefox deps
    libgtk-3-0 libdbus-1-3 libxt6 \
    # VNC / display
    xvfb x11vnc novnc python3-websockify openbox x11-apps \
    # Node 20
    nodejs npm \
  && rm -rf /var/lib/apt/lists/*

# ── Google Chrome stable ─────────────────────────────────────────────────────
RUN wget -q -O /tmp/chrome.deb \
    "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb" \
  && dpkg -i /tmp/chrome.deb || apt-get -f install -y \
  && rm /tmp/chrome.deb

# ── ChromeDriver (matching Chrome version) ───────────────────────────────────
RUN CHROME_VER=$(google-chrome --version | grep -oP '[\d.]+' | head -1) \
  && CHROMEDRIVER_VER=$(curl -s "https://chromedriver.storage.googleapis.com/LATEST_RELEASE_${CHROME_VER%%.*}") \
  && curl -sL "https://chromedriver.storage.googleapis.com/${CHROMEDRIVER_VER}/chromedriver_linux64.zip" -o /tmp/cd.zip \
  && unzip /tmp/cd.zip -d /usr/local/bin/ \
  && chmod +x /usr/local/bin/chromedriver \
  && rm /tmp/cd.zip

# ── Firefox ESR ─────────────────────────────────────────────────────────────
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends firefox-esr \
  && rm -rf /var/lib/apt/lists/*

# ── GeckoDriver ─────────────────────────────────────────────────────────────
RUN GECKO_VER=$(curl -s "https://api.github.com/repos/mozilla/geckodriver/releases/latest" | grep '"tag_name"' | grep -oP 'v[\d.]+') \
  && curl -sL "https://github.com/mozilla/geckodriver/releases/download/${GECKO_VER}/geckodriver-${GECKO_VER}-linux64.tar.gz" \
     | tar -xz -C /usr/local/bin/ \
  && chmod +x /usr/local/bin/geckodriver

# ── Python RF + SeleniumLibrary ──────────────────────────────────────────────
RUN pip install --no-cache-dir \
    robotframework \
    robotframework-seleniumlibrary \
    selenium \
    pandas \
    openpyxl

WORKDIR /app

# ── Node HTTP server (runner) ─────────────────────────────────────────────────
COPY packages/runner/package.json ./packages/runner/
RUN cd packages/runner && npm install --omit=dev

COPY packages/runner/src ./packages/runner/src

# Volumes mounted at runtime
VOLUME ["/scripts", "/artifacts"]

EXPOSE 5001
EXPOSE 6080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

CMD ["node", "packages/runner/src/index.js"]
