'use strict';

const http = require('http');
const net  = require('net');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 5001;
const SCRIPTS_DIR = '/scripts';

// ── Display pool ───────────────────────────────────────────────────────────
// One Xvfb display per concurrent worker slot. Display :99 is also the VNC
// display (noVNC live view). All displays are started on boot; each /run
// request acquires one exclusively, so parallel test cases each record their
// own screen without contention.
const MAX_DISPLAYS   = 8;   // supports up to 8 parallel workers
const BASE_DISPLAY   = 99;  // :99, :100, :101, …
const VNC_DISPLAY    = ':99';
const VNC_PORT       = 5900;
const NOVNC_PORT     = 6080;
const NOVNC_WEB_DIR  = '/usr/share/novnc';

// Pool entry: { display: ':99', xvfbProc, free: true, ffmpegProc: null }
const displayPool = [];

// ── Helpers ────────────────────────────────────────────────────────────────
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

function spawnLogged(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on('data', (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.on('exit',  (code) => { if (code) console.error(`[${cmd}] exited with code ${code}`); });
  p.on('error', (err)  => console.error(`[${cmd}] spawn error: ${err.message}`));
  return p;
}

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

// ── Acquire / release display from pool ───────────────────────────────────
function acquireDisplay() {
  const slot = displayPool.find((d) => d.free);
  if (!slot) return null;
  slot.free = false;
  return slot;
}

function releaseDisplay(slot) {
  if (!slot) return;
  // Kill any stale ffmpeg on this slot before marking it free
  if (slot.ffmpegProc) {
    try { slot.ffmpegProc.kill('SIGKILL'); } catch {}
    slot.ffmpegProc = null;
  }
  slot.free = true;
}

// ── Boot all Xvfb displays in the pool ────────────────────────────────────
async function startDisplayPool() {
  for (let i = 0; i < MAX_DISPLAYS; i++) {
    const displayNum = BASE_DISPLAY + i;
    const display    = `:${displayNum}`;
    const socket     = `/tmp/.X11-unix/X${displayNum}`;

    let xvfbProc = null;
    if (fs.existsSync(socket)) {
      console.log(`[qa-runner] Xvfb ${display} already running — reusing`);
    } else {
      console.log(`[qa-runner] Starting Xvfb on display ${display}`);
      xvfbProc = spawnLogged('Xvfb', [display, '-screen', '0', '1280x900x24', '-ac', '+extension', 'GLX', '+render', '-noreset']);
      await new Promise((resolve) => waitForXvfb(display, resolve));
    }

    // Start openbox window manager — Chrome needs a WM for CDP to work.
    // Pass DISPLAY via env (same way start.sh does) rather than --display flag.
    const obEnv = Object.assign({}, process.env, { DISPLAY: display });
    spawn('openbox', [], { env: obEnv, stdio: ['ignore', 'ignore', 'ignore'] });
    // Give openbox time to connect to the display before Chrome uses it
    await new Promise((resolve) => setTimeout(resolve, 1000));

    displayPool.push({ display, xvfbProc, free: true, ffmpegProc: null });
    console.log(`[qa-runner] Display ${display} ready`);
  }
  console.log(`[qa-runner] Display pool ready: ${displayPool.map((d) => d.display).join(', ')}`);
}

// ── VNC stack (only on display :99) ───────────────────────────────────────
async function startVncStack() {
  console.log('[qa-runner] Checking VNC stack on display ' + VNC_DISPLAY);

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
  if (!wsAlive) {
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
          '-nopw', '-listen', 'localhost',
          '-rfbport', String(VNC_PORT),
          '-forever', '-shared', '-noxdamage',
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
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseRobotXmlReport(xmlPath) {
  try {
    if (!fs.existsSync(xmlPath)) return null;
    const xml = fs.readFileSync(xmlPath, 'utf8');

    const statsMatch = xml.match(/<stat[^>]+type="total"[^>]*>(\d+)<\/stat>/);
    const suiteMatch = xml.match(/<suite\s[^>]*name="([^"]+)"/);

    const tests = [];
    const testRe = /<test\s[^>]*name="([^"]+)"[\s\S]*?<status\s[^>]*status="(PASS|FAIL)"[^>]*(?:starttime="([^"]*)")?[^>]*(?:endtime="([^"]*)")?[^>]*(?:>([^<]*)<\/status>|\/?>)/g;
    let m;
    while ((m = testRe.exec(xml)) !== null) {
      const name      = decodeXmlEntities(m[1]);
      const status    = m[2];
      const startStr  = m[3] || '';
      const endStr    = m[4] || '';
      const message   = m[5] ? decodeXmlEntities(m[5].trim()) : '';
      let durationMs  = 0;
      try { durationMs = new Date(endStr).getTime() - new Date(startStr).getTime(); } catch { /* ignore */ }
      tests.push({ name, status, durationMs: isNaN(durationMs) ? 0 : durationMs, message });
    }

    const passed = tests.filter((t) => t.status === 'PASS').length;
    const failed = tests.filter((t) => t.status === 'FAIL').length;

    return {
      _robotReport: true,
      suiteName: suiteMatch ? decodeXmlEntities(suiteMatch[1]) : null,
      total: tests.length,
      passed,
      failed,
      tests: tests.map((t) => ({ ...t, errorMsg: t.message || null })),
    };
  } catch (err) {
    console.error(`[qa-runner] XML parse error: ${err.message}`);
    return null;
  }
}

// ── HTTP server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    const free = displayPool.filter((d) => d.free).length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', freeDisplays: free, totalDisplays: displayPool.length }));
    return;
  }

  if (req.method === 'POST' && req.url === '/run') {
    let body;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
      record = false,
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

    // ── Acquire a display slot ─────────────────────────────────────────────
    const displaySlot = acquireDisplay();
    if (!displaySlot) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'All display slots busy — too many parallel workers' }));
      return;
    }
    const assignedDisplay = displaySlot.display;

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
    });

    const sendLine = (obj) => {
      try { res.write(JSON.stringify(obj) + '\n'); } catch { /* client gone */ }
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

    // ── Script / project resolution ────────────────────────────────────────
    const scriptDir    = path.dirname(scriptPath);
    const relToScripts = path.relative(SCRIPTS_DIR, scriptPath);
    const projectSlug  = bodyProjectSlug || relToScripts.split(path.sep)[0];
    const projectRoot  = path.join(SCRIPTS_DIR, projectSlug);
    const pageObjectsDir = path.join(projectRoot, 'Resource', 'PageObjects');
    const hasHierarchy   = fs.existsSync(path.join(projectRoot, 'Resource'));

    if (!hasHierarchy) {
      const slugResourcesDir = projectSlug
        ? path.join(SCRIPTS_DIR, projectSlug, 'resources')
        : null;
      const cuidResourcesDir = path.join(SCRIPTS_DIR, path.basename(scriptDir), 'resources');
      const resourcesSrcDir  = (slugResourcesDir && fs.existsSync(slugResourcesDir))
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

    // RF listener for auto-screenshot on teardown
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

    const seleniumBrowser = (browser === 'chrome' || browser === 'chromium') ? 'chrome' : 'firefox';

    const robotArgs = [
      '--outputdir', effectiveOutputDir,
      '--output',   'output.xml',
      '--report',   'NONE',
      '--log',      'log.html',
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
      BASE_URL:    baseUrl || '',
      TC_USERNAME: username || '',
      TC_PASSWORD: password || '',
      TEST_ENV:    environment || '',
      DISPLAY:     assignedDisplay,   // ← each worker uses its own display
    });

    if (hasHierarchy && fs.existsSync(pageObjectsDir)) {
      robotEnv.PYTHONPATH = [pageObjectsDir, process.env.PYTHONPATH || ''].filter(Boolean).join(':');
    }

    // ── Video recording on the assigned display ────────────────────────────
    let ffmpegProc  = null;
    let videoPath   = null;
    let thisRunRecords = false;

    if (record) {
      thisRunRecords = true;
      videoPath      = path.join(effectiveOutputDir, 'video.mp4');

      ffmpegProc = spawn('ffmpeg', [
        '-y',
        '-video_size', '1280x900',
        '-framerate', '10',
        '-f', 'x11grab',
        '-i', assignedDisplay,        // ← record THIS worker's display only
        '-codec:v', 'libx264',
        '-preset', 'fast',
        '-crf', '32',
        '-tune', 'stillimage',
        '-pix_fmt', 'yuv420p',
        videoPath,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      displaySlot.ffmpegProc = ffmpegProc;

      ffmpegProc.stderr.on('data', (d) => {
        const msg = d.toString();
        if (/error|invalid|failed/i.test(msg) && !msg.includes('Last message')) {
          sendLine({ type: 'log', text: `[ffmpeg] ${msg.trim().slice(0, 200)}` });
        }
      });
      ffmpegProc.on('error', (err) => {
        console.error(`[qa-runner] ffmpeg error on ${assignedDisplay}: ${err.message}`);
        sendLine({ type: 'log', text: `[runner] ⚠ ffmpeg failed to start: ${err.message}` });
        thisRunRecords = false;
        videoPath      = null;
        displaySlot.ffmpegProc = null;
      });
      ffmpegProc.on('exit', (code) => {
        displaySlot.ffmpegProc = null;
        if (code !== 0 && code !== null && thisRunRecords) {
          sendLine({ type: 'log', text: `[runner] ⚠ ffmpeg exited with code ${code} — video may be missing` });
        }
      });
      sendLine({ type: 'log', text: `[runner] 🎬 Video recording started on display ${assignedDisplay} (1280x900 10fps)` });
    }

    sendLine({ type: 'log', text: `[runner] Starting Robot Framework (${seleniumBrowser}) headless=${headless} display=${assignedDisplay}` });

    proc = spawn(ROBOT_BIN, robotArgs, {
      cwd:   scriptDir,
      env:   robotEnv,
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

    // Release display when connection drops (cancel/stop) — only if proc hasn't
    // already finished (proc.on('close') handles the normal completion path).
    let displayReleased = false;
    const releaseOnce = () => {
      if (displayReleased) return;
      displayReleased = true;
      releaseDisplay(displaySlot);
    };

    req.on('close', () => {
      if (!procDone && !proc.killed) {
        proc.kill('SIGTERM');
        setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 3000);
        clearTimeout(killTimer);
        clearInterval(heartbeatTimer);
        releaseOnce();
      }
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

    proc.on('close', async (exitCode) => {
      procDone = true;
      clearTimeout(killTimer);
      clearInterval(heartbeatTimer);

      // ── Stop ffmpeg and remux for browser playback ─────────────────────
      if (ffmpegProc && thisRunRecords) {
        const rawPath  = videoPath;
        const fastPath = rawPath ? rawPath.replace('.mp4', '_fast.mp4') : null;
        const ffmpegToStop = ffmpegProc;
        displaySlot.ffmpegProc = null;

        ffmpegToStop.on('exit', () => {
          if (!rawPath || !fastPath) return;
          const remux = spawn('ffmpeg', [
            '-y', '-i', rawPath,
            '-movflags', '+faststart',
            '-c', 'copy',
            fastPath,
          ], { stdio: ['ignore', 'ignore', 'ignore'] });
          remux.on('exit', (code) => {
            if (code === 0 && fs.existsSync(fastPath) && fs.statSync(fastPath).size > 0) {
              try { fs.renameSync(fastPath, rawPath); } catch {}
            } else {
              try { fs.unlinkSync(fastPath); } catch {}
            }
          });
        });
        try { ffmpegToStop.kill('SIGTERM'); } catch { try { ffmpegToStop.kill('SIGKILL'); } catch {} }
        setTimeout(() => { try { ffmpegToStop.kill('SIGKILL'); } catch {} }, 8_000);
        sendLine({ type: 'log', text: '[runner] 🎬 Video recording stopped — processing for playback…' });
      }

      // Release display back to pool
      releaseOnce();

      // ── Collect artifacts ──────────────────────────────────────────────
      const reportData = parseRobotXmlReport(xmlOutputPath);
      const errorLines = outputLines.filter(l => /FAIL|Error|Exception|Critical/i.test(l)).slice(-5).join(' | ');

      let screenshotPath = null;
      try {
        const scanDir = (dir) => {
          if (!fs.existsSync(dir)) return;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { scanDir(full); }
            else if (!screenshotPath && /\.(png|jpg|jpeg)$/i.test(entry.name)) {
              screenshotPath = full;
            }
          }
        };
        scanDir(effectiveOutputDir);
      } catch (scanErr) {
        console.error(`[qa-runner] artifact scan error: ${scanErr.message}`);
      }

      sendLine({ type: 'done', exitCode: exitCode ?? 1, reportData, screenshotPath, videoPath, errorSnippet: errorLines || null });
      res.end();
    });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      clearInterval(heartbeatTimer);
      releaseOnce();
      sendLine({ type: 'done', exitCode: 1, reportData: null, error: err.message });
      res.end();
    });

    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, async () => {
  console.log(`[qa-runner] HTTP server listening on port ${PORT}`);
  console.log(`[qa-runner] Robot Framework binary: ${ROBOT_BIN} (exists: ${fs.existsSync(ROBOT_BIN)})`);
  await startDisplayPool();
  await startVncStack();
});
