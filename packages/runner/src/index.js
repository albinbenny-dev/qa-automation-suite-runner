'use strict';

const http = require('http');
const net  = require('net');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 5001;
const SCRIPTS_DIR = '/scripts';

// ── noVNC / live-browser-view constants ────────────────────────────────────
const VNC_DISPLAY    = ':99';
const VNC_PORT       = 5900;
const NOVNC_PORT     = 6080;
const NOVNC_WEB_DIR  = '/usr/share/novnc';

// Poll a TCP port until something is listening, then call onReady.
function waitForPort(port, onReady) {
  const attempt = () => {
    const sock = new net.Socket();
    sock.setTimeout(600);
    sock.on('connect', () => { sock.destroy(); onReady(); });
    sock.on('error',   () => { setTimeout(attempt, 800); });
    sock.on('timeout', () => { sock.destroy(); setTimeout(attempt, 800); });
    sock.connect(port, '127.0.0.1');
  };
  attempt();
}

// One-shot port check — resolves true if something is listening, false if not.
function checkPort(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(500);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error',   () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, '127.0.0.1');
  });
}

// Spawn a process and pipe its stdout/stderr into the container logs.
function spawnLogged(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on('data', (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.on('exit',  (code) => { if (code) console.error(`[${cmd}] exited with code ${code}`); });
  p.on('error', (err)  => console.error(`[${cmd}] spawn error: ${err.message}`));
  return p;
}

// Poll until Xvfb's Unix socket exists.
function waitForXvfb(display, onReady) {
  const num    = display.replace(':', '');
  const socket = `/tmp/.X11-unix/X${num}`;
  const poll   = () => {
    if (fs.existsSync(socket)) {
      console.log(`[qa-runner] Xvfb socket ready: ${socket}`);
      onReady();
    } else {
      setTimeout(poll, 300);
    }
  };
  poll();
}

// Idempotent VNC stack startup.
async function startVncStack() {
  console.log('[qa-runner] Checking VNC stack on display ' + VNC_DISPLAY);

  const xvfbSocket = `/tmp/.X11-unix/X${VNC_DISPLAY.replace(':', '')}`;
  if (fs.existsSync(xvfbSocket)) {
    console.log(`[qa-runner] Xvfb socket already present (${xvfbSocket}) — skipping Xvfb start`);
  } else {
    console.log('[qa-runner] Starting Xvfb on display ' + VNC_DISPLAY);
    spawnLogged('Xvfb', [VNC_DISPLAY, '-screen', '0', '1920x1080x24', '-ac']);
    await new Promise((resolve) => waitForXvfb(VNC_DISPLAY, resolve));
  }

  const vncAlive = await checkPort(VNC_PORT);
  if (vncAlive) {
    console.log(`[qa-runner] x11vnc already listening on :${VNC_PORT} — skipping`);
  } else {
    console.log('[qa-runner] Starting x11vnc');
    spawnLogged('x11vnc', [
      '-display', VNC_DISPLAY,
      '-nopw',
      '-listen', 'localhost',
      '-rfbport', String(VNC_PORT),
      '-forever',
      '-shared',
      '-noxdamage',
    ]);
    await new Promise((resolve) => waitForPort(VNC_PORT, resolve));
    console.log(`[qa-runner] x11vnc up on :${VNC_PORT}`);
  }

  const wsAlive = await checkPort(NOVNC_PORT);
  if (wsAlive) {
    console.log(`[qa-runner] websockify already listening on :${NOVNC_PORT} — skipping`);
  } else {
    if (!fs.existsSync(NOVNC_WEB_DIR)) {
      console.error(`[qa-runner] noVNC web dir not found at ${NOVNC_WEB_DIR}`);
      return;
    }
    console.log('[qa-runner] Starting websockify');
    spawnLogged('/usr/bin/python3', [
      '-m', 'websockify',
      '--web', NOVNC_WEB_DIR,
      '--heartbeat=30',
      `0.0.0.0:${NOVNC_PORT}`,
      `localhost:${VNC_PORT}`,
    ]);
  }

  console.log(`[qa-runner] noVNC ready — http://<server>:${NOVNC_PORT}/vnc.html`);

  // Watchdog: restart x11vnc / websockify if they crash.
  setInterval(async () => {
    try {
      const vncOk = await checkPort(VNC_PORT);
      if (!vncOk) {
        console.log('[qa-runner] [watchdog] x11vnc down — restarting');
        spawnLogged('x11vnc', [
          '-display', VNC_DISPLAY,
          '-nopw',
          '-listen', 'localhost',
          '-rfbport', String(VNC_PORT),
          '-forever',
          '-shared',
          '-noxdamage',
        ]);
        await new Promise((resolve) => waitForPort(VNC_PORT, resolve));
        console.log('[qa-runner] [watchdog] x11vnc restarted');
      }
      const wsOk = await checkPort(NOVNC_PORT);
      if (!wsOk) {
        console.log('[qa-runner] [watchdog] websockify down — restarting');
        spawnLogged('/usr/bin/python3', [
          '-m', 'websockify',
          '--web', NOVNC_WEB_DIR,
          '--heartbeat=30',
          `0.0.0.0:${NOVNC_PORT}`,
          `localhost:${VNC_PORT}`,
        ]);
      }
    } catch (err) {
      console.error('[qa-runner] [watchdog] error:', err.message);
    }
  }, 20_000);
}

// Robot Framework binary
const ROBOT_BIN = fs.existsSync('/usr/local/bin/robot')
  ? '/usr/local/bin/robot'
  : 'robot';

// ── RF XML report parser ───────────────────────────────────────────────────
function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseRobotXmlReport(xmlPath) {
  if (!fs.existsSync(xmlPath)) return null;
  const xml = fs.readFileSync(xmlPath, 'utf8');

  const suiteMatch = xml.match(/<suite[^>]*>[\s\S]*?<status\s+status="(PASS|FAIL)"[^>]*start="([^"]*)"[^>]*end="([^"]*)"[^/]*/);
  const suiteStatus = suiteMatch ? suiteMatch[1] : 'FAIL';

  const tests = [];
  const testBlockRegex = /<test\s[^>]*>([\s\S]*?)<\/test>/g;
  let m;
  while ((m = testBlockRegex.exec(xml)) !== null) {
    const block = m[0];
    const body = m[1];

    const nameMatch = block.match(/<test\s[^>]*\bname="([^"]*)"/);
    if (!nameMatch) continue;
    const name = decodeXmlEntities(nameMatch[1]);

    const statusMatch = body.match(/<status\s+status="(PASS|FAIL)"[^>]*(?:start(?:time)?="([^"]*)")?[^>]*(?:end(?:time)?="([^"]*)")?/);
    const status = statusMatch ? statusMatch[1] : 'FAIL';
    const startStr = statusMatch ? statusMatch[2] : null;
    const endStr = statusMatch ? statusMatch[3] : null;

    let durationMs = 0;
    if (startStr && endStr) {
      try { durationMs = new Date(endStr).getTime() - new Date(startStr).getTime(); } catch { /* ignore */ }
    }

    let errorMsg = null;
    if (status === 'FAIL') {
      const statusTextMatch = body.match(/<status\s+status="FAIL"[^>]*>([\s\S]*?)<\/status>/);
      if (statusTextMatch) {
        const txt = decodeXmlEntities(statusTextMatch[1]).replace(/<[^>]+>/g, '').trim();
        if (txt) errorMsg = txt;
      }
      if (!errorMsg) {
        const msgRegex = /<msg[^>]*\blevel="FAIL"[^>]*>([\s\S]*?)<\/msg>/g;
        let mm;
        let lastMsg = null;
        while ((mm = msgRegex.exec(body)) !== null) lastMsg = mm[1];
        if (lastMsg) errorMsg = decodeXmlEntities(lastMsg).replace(/<[^>]+>/g, '').trim();
      }
      if (errorMsg && errorMsg.length > 600) errorMsg = errorMsg.slice(0, 600) + '…';
    }

    tests.push({ name, status, durationMs, errorMsg });
  }

  return {
    _robotReport: true,
    suiteStatus,
    tests,
    stats: {
      total: tests.length,
      passed: tests.filter(t => t.status === 'PASS').length,
      failed: tests.filter(t => t.status === 'FAIL').length,
    },
  };
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // GET /health
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // POST /run
  if (req.method === 'POST' && req.url === '/run') {
    let body;
    try {
      const raw = await collectBody(req);
      body = JSON.parse(raw);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body: ' + err.message }));
      return;
    }

    const {
      scriptPath,
      reportFile,
      outputDir,
      browser = 'chrome',
      headless = true,
      baseUrl = '',
      username = '',
      password = '',
      environment = '',
      projectSlug: bodyProjectSlug = '',
    } = body;

    if (!scriptPath || !reportFile) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'scriptPath and reportFile are required' }));
      return;
    }

    if (!scriptPath.endsWith('.robot')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Only .robot files are supported' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
    });

    const sendLine = (obj) => {
      res.write(JSON.stringify(obj) + '\n');
    };

    const handleChunk = (chunk) => {
      const text = chunk.toString('utf8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) sendLine({ type: 'log', text: trimmed });
      }
    };

    const HARD_KILL_MS = 900_000;
    let proc;
    let procDone = false;

    // ── Robot Framework + SeleniumLibrary execution ────────────────────────
    const scriptDir = path.dirname(scriptPath);
    const relToScripts = path.relative(SCRIPTS_DIR, scriptPath);
    const projectSlug = bodyProjectSlug || relToScripts.split(path.sep)[0];
    const projectRoot = path.join(SCRIPTS_DIR, projectSlug);
    const pageObjectsDir = path.join(projectRoot, 'Resource', 'PageObjects');
    const hasHierarchy = fs.existsSync(path.join(projectRoot, 'Resource'));

    if (!hasHierarchy) {
      // Copy resource files alongside the script for RF to resolve relative imports
      const slugResourcesDir = projectSlug
        ? path.join(SCRIPTS_DIR, projectSlug, 'resources')
        : null;
      const cuidResourcesDir = path.join(SCRIPTS_DIR, path.basename(scriptDir), 'resources');
      const resourcesSrcDir = (slugResourcesDir && fs.existsSync(slugResourcesDir))
        ? slugResourcesDir
        : (fs.existsSync(cuidResourcesDir) ? cuidResourcesDir : null);

      if (resourcesSrcDir) {
        try {
          for (const rf of fs.readdirSync(resourcesSrcDir)) {
            if (rf === '.gitkeep') continue;
            const srcFile = path.join(resourcesSrcDir, rf);
            if (fs.statSync(srcFile).isFile()) {
              fs.copyFileSync(srcFile, path.join(scriptDir, rf));
            }
          }
        } catch { /* non-fatal */ }
      }
    }

    const effectiveOutputDir = outputDir || path.join('/artifacts', projectSlug, path.basename(scriptPath, '.robot'));
    fs.mkdirSync(effectiveOutputDir, { recursive: true });
    const xmlOutputPath = path.join(effectiveOutputDir, 'output.xml');

    // RF listener for auto-screenshot via SeleniumLibrary
    const listenerCode = [
      'import os as _os',
      '',
      'class QaRunnerListener:',
      '    ROBOT_LISTENER_API_VERSION = 2',
      '',
      '    def __init__(self, output_dir):',
      '        self.output_dir = output_dir',
      '        self._screenshot_done = False',
      '',
      '    def start_test(self, name, attrs):',
      '        self._screenshot_done = False',
      '',
      '    def start_keyword(self, name, attrs):',
      '        if not self._screenshot_done and attrs.get("type") == "teardown":',
      '            self._screenshot_done = True',
      '            try:',
      '                from robot.libraries.BuiltIn import BuiltIn',
      '                screenshot_path = _os.path.join(self.output_dir, "screenshot.png")',
      '                BuiltIn().run_keyword("Capture Page Screenshot", screenshot_path)',
      '            except Exception:',
      '                pass',
    ].join('\n');

    const listenerPath = path.join(effectiveOutputDir, 'QaRunnerListener.py');
    try { fs.writeFileSync(listenerPath, listenerCode, 'utf8'); } catch { /* non-fatal */ }

    // Map browser name to SeleniumLibrary browser name
    const seleniumBrowser = browser === 'chrome' ? 'chrome' : 'firefox';

    const robotArgs = [
      '--outputdir', effectiveOutputDir,
      '--output', 'output.xml',
      '--report', 'NONE',
      '--log', 'log.html',
      '--listener', `${listenerPath}:${effectiveOutputDir}`,
      '--variable', `BASE_URL:${baseUrl || ''}`,
      '--variable', `TC_USERNAME:${username || ''}`,
      '--variable', `TC_PASSWORD:${password || ''}`,
      '--variable', `OUTPUTDIR:${effectiveOutputDir}`,
      '--variable', `BROWSER:${seleniumBrowser}`,
      '--variable', `SELENIUM_SPEED:0`,
      '--variable', `HEADLESS:${headless ? 'true' : 'false'}`,
    ];

    if (hasHierarchy && fs.existsSync(pageObjectsDir)) {
      robotArgs.push('--pythonpath', pageObjectsDir);
    }

    robotArgs.push(scriptPath);

    const robotEnv = Object.assign({}, process.env, {
      BASE_URL: baseUrl || '',
      TC_USERNAME: username || '',
      TC_PASSWORD: password || '',
      TEST_ENV: environment || '',
      DISPLAY: VNC_DISPLAY,
    });

    if (hasHierarchy && fs.existsSync(pageObjectsDir)) {
      robotEnv.PYTHONPATH = [pageObjectsDir, process.env.PYTHONPATH || ''].filter(Boolean).join(':');
    }

    // SeleniumLibrary manages the browser — just run robot under xvfb-run
    const spawnCmd = 'xvfb-run';
    const spawnArgs = ['--auto-servernum', '--server-args=-screen 0 1920x1080x24', ROBOT_BIN, ...robotArgs];

    sendLine({ type: 'log', text: `[runner] Starting Robot Framework (${seleniumBrowser}) headless=${headless}` });

    proc = spawn(spawnCmd, spawnArgs, {
      cwd: scriptDir,
      env: robotEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const killTimer = setTimeout(() => {
      sendLine({ type: 'log', text: `[runner] Robot script exceeded ${HARD_KILL_MS / 1000}s hard limit — killing` });
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5_000);
    }, HARD_KILL_MS);

    const heartbeatTimer = setInterval(() => {
      if (!procDone) sendLine({ type: 'heartbeat' });
    }, 20_000);

    req.on('close', () => {
      if (!procDone && !proc.killed) {
        proc.kill('SIGTERM');
        setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 3000);
      }
      clearTimeout(killTimer);
      clearInterval(heartbeatTimer);
    });

    const outputLines = [];
    const captureChunk = (chunk) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        const t = line.trim();
        if (t) outputLines.push(t);
        if (outputLines.length > 80) outputLines.shift();
      }
    };

    proc.stdout.on('data', (chunk) => { handleChunk(chunk); captureChunk(chunk); });
    proc.stderr.on('data', (chunk) => { handleChunk(chunk); captureChunk(chunk); });

    proc.on('close', (exitCode) => {
      procDone = true;
      clearTimeout(killTimer);
      clearInterval(heartbeatTimer);
      const reportData = parseRobotXmlReport(xmlOutputPath);
      const errorLines = outputLines.filter(l => /FAIL|Error|Exception|Critical/i.test(l)).slice(-5).join(' | ');

      let screenshotPath = null;
      const videoPaths = [];
      try {
        const scanDir = (dir) => {
          if (!fs.existsSync(dir)) return;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scanDir(full);
            } else {
              if (!screenshotPath && /\.(png|jpg|jpeg)$/i.test(entry.name)) {
                screenshotPath = full;
              } else if (/\.(webm|mp4)$/i.test(entry.name)) {
                videoPaths.push(full);
              }
            }
          }
        };
        scanDir(effectiveOutputDir);
      } catch (scanErr) {
        console.error(`[qa-runner] artifact scan error: ${scanErr.message}`);
      }

      sendLine({ type: 'done', exitCode: exitCode ?? 1, reportData, screenshotPath, videoPaths, errorSnippet: errorLines || null });
      res.end();
    });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      clearInterval(heartbeatTimer);
      sendLine({ type: 'done', exitCode: 1, reportData: null, error: err.message });
      res.end();
    });

    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[qa-runner] HTTP server listening on port ${PORT}`);
  console.log(`[qa-runner] Robot Framework binary: ${ROBOT_BIN} (exists: ${fs.existsSync(ROBOT_BIN)})`);
  startVncStack();
});
