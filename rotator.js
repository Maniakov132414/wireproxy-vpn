const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIGS_DIR = path.join(__dirname, 'configs');

// Configuration
// Hard Pool Buffer Size: 8 warm instances. Safe under Proton's 10-device limit;
// each wireproxy process costs ~15-20MB RAM so 8 nodes need ~160MB of the container budget.
const POOL_BUFFER_SIZE = parseInt(process.env.POOL_SIZE || '8', 10);
const STICKY_REQUESTS_PER_NODE = parseInt(process.env.STICKY_REQUESTS || '3', 10);
const MAX_REQUESTS_PER_NODE = parseInt(process.env.MAX_REQUESTS_PER_NODE || '200', 10);
// Stickiness guard: once a node carries this many concurrent requests, stop
// sticking new traffic to it so the load spreads across the whole warm pool
// instead of stampeding one IP into an upstream rate limiter.
const STICKY_MAX_INFLIGHT = parseInt(process.env.STICKY_MAX_INFLIGHT || '20', 10);
// No hard concurrency caps: every request is always accepted. New requests are
// spread with weighted least-loaded balancing, and a rotated-away node stays
// alive until its in-flight requests finish (graceful drain on retirement).
// Idle sleep defaults to 5 minutes: back-to-back checker bursts (minutes apart)
// keep hitting a warm pool instead of waking a cold one and eating the client's
// 10s timeout on the first 1-2 requests.
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || '300000', 10);
// Cold-start burst: when the whole pool is asleep, spawn this many nodes in
// parallel so the first request after idle sleep gets a live tunnel in ~2-4s
// instead of 8s+ (sequential startup made burst #1 time out).
const WAKE_BURST = parseInt(process.env.WAKE_BURST || '3', 10);
const ROTATOR_PORT = parseInt(process.env.ROTATOR_PORT || process.env.PORT || '10800', 10);
const BIND_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';

// Auto-detect wireproxy binary
function findWireproxyBin() {
  if (process.env.WIREPROXY_BIN && fs.existsSync(process.env.WIREPROXY_BIN)) {
    return process.env.WIREPROXY_BIN;
  }
  const localExe = path.join(__dirname, 'wireproxy.exe');
  if (fs.existsSync(localExe)) return localExe;
  const linuxBin = '/usr/local/bin/wireproxy';
  if (fs.existsSync(linuxBin)) return linuxBin;
  return 'wireproxy';
}

const WIREPROXY_BIN = findWireproxyBin();

let ALL_NODES = [];
let currentIndex = 0;

function parseConfigs() {
  if (!fs.existsSync(CONFIGS_DIR)) return [];
  const rawFiles = fs.readdirSync(CONFIGS_DIR).filter(f => f.endsWith('.conf'));

  // Group by country code prefix (e.g. vn, sg, jp, hk, tw, kr, us, etc.)
  const groups = {};
  for (const file of rawFiles) {
    const code = file.replace(/^wireproxy-/, '').replace(/\d+\.conf$/, '').replace(/\.conf$/, '');
    if (!groups[code]) groups[code] = [];
    groups[code].push(file);
  }

  // Interleave preferred low-latency regions & hubs across the pool so the warm nodes
  // ALWAYS have distinct public IP addresses close to Railway Southeast Asia (Singapore)!
  const preferredOrder = ['sg', 'my', 'vn', 'th', 'ph', 'id', 'kh', 'in', 'bd', 'bt', 'hk', 'tw', 'jp', 'kr'];
  const files = [];
  const maxLen = Math.max(...Object.values(groups).map(g => g.length));

  for (let i = 0; i < maxLen; i++) {
    for (const code of preferredOrder) {
      if (groups[code] && groups[code][i]) {
        files.push(groups[code][i]);
      }
    }
    for (const [code, list] of Object.entries(groups)) {
      if (!preferredOrder.includes(code) && list[i]) {
        files.push(list[i]);
      }
    }
  }

  const nodes = [];

  for (const file of files) {
    const filePath = path.join(CONFIGS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');

    const httpMatch = content.match(/\[http\][\s\S]*?BindAddress\s*=\s*[\w\.:]+:(\d+)/i);
    const socksMatch = content.match(/\[Socks5\][\s\S]*?BindAddress\s*=\s*[\w\.:]+:(\d+)/i);
    const keyMatch = content.match(/PrivateKey\s*=\s*([^\r\n]+)/i);

    if (httpMatch) {
      const port = parseInt(httpMatch[1], 10);
      const name = path.basename(file, '.conf').replace(/^wireproxy-/, '').toUpperCase();
      nodes.push({
        id: file,
        name: `Node ${name}`,
        file,
        filePath,
        host: '127.0.0.1',
        port,
        socksPort: socksMatch ? parseInt(socksMatch[1], 10) : null,
        privateKey: keyMatch ? keyMatch[1].trim() : '',
        process: null,
        active: false,
        starting: false,
        coolingDown: false,
        failures: 0,
        inFlight: 0,
        servingCount: 0,
        markedForRetire: false,
      });
    }
  }
  return nodes;
}

function getAliveProcessesCount() {
  return ALL_NODES.filter(n => n.process !== null || n.starting).length;
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 4500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tryConnect = () => {
      const sock = net.connect(port, host, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(tryConnect, 80);
        }
      });
    };
    tryConnect();
  });
}

// Actively probe WireGuard tunnel internet connectivity directly via IP (avoids DNS delays)
function probeNodeConnectivity(port, host = '127.0.0.1', timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get({
      host,
      port,
      path: 'http://1.1.1.1/',
      timeout: timeoutMs,
      headers: { Host: '1.1.1.1', 'User-Agent': 'curl/7.88.1' },
    }, (res) => {
      res.resume();
      if (res.statusCode === 200 || res.statusCode === 301) {
        resolve({ ok: true, ip: 'live' });
      } else {
        resolve({ ok: true, ip: 'live' });
      }
    });
    req.on('error', () => {
      // Fallback probe to 1.0.0.1
      const req2 = http.get({
        host,
        port,
        path: 'http://1.0.0.1/',
        timeout: 2000,
        headers: { Host: '1.0.0.1' },
      }, (res2) => {
        res2.resume();
        resolve({ ok: true, ip: 'live' });
      });
      req2.on('error', () => resolve({ ok: false }));
      req2.on('timeout', () => { req2.destroy(); resolve({ ok: false }); });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}

async function startNode(node) {
  if (node.process || node.starting || node.coolingDown) return;
  // STRICT PROCESS CAP: Never exceed POOL_BUFFER_SIZE under any circumstance
  if (getAliveProcessesCount() >= POOL_BUFFER_SIZE) return;

  // KEY ISOLATION: Never run two nodes with the same PrivateKey concurrently (Proton routing collision)
  const activeKeys = new Set(
    ALL_NODES.filter(n => n !== node && (n.process || n.starting)).map(n => n.privateKey).filter(Boolean)
  );
  if (node.privateKey && activeKeys.has(node.privateKey)) {
    return;
  }

  node.starting = true;

  try {
    const child = spawn(WIREPROXY_BIN, ['-s', '-c', node.filePath], {
      stdio: 'ignore',
      windowsHide: true,
    });

    node.process = child;
    node.failures = 0;
    node.active = false;
    node.markedForRetire = false;

    child.on('error', (err) => {
      console.error(`[!] Failed to spawn ${node.name}: ${err.message}`);
      node.process = null;
      node.active = false;
      node.starting = false;
    });

    child.on('exit', () => {
      node.process = null;
      node.active = false;
      node.starting = false;
    });

    // Wait until local wireproxy port is confirmed listening
    const ready = await waitForPort(node.port, node.host, 4500);
    if (!ready) {
      console.warn(`[!] Node ${node.name} failed local port bind within 4.5s`);
      await stopNode(node);
      return;
    }

    // Allow WireGuard 500ms to complete initial UDP handshake with remote endpoint
    await new Promise(r => setTimeout(r, 500));

    // Actively probe WireGuard tunnel connectivity before exposing to clients
    let probe = await probeNodeConnectivity(node.port, node.host, 3500);
    if (!probe.ok) {
      // Retry once after 500ms for international undersea cable latency
      await new Promise(r => setTimeout(r, 500));
      probe = await probeNodeConnectivity(node.port, node.host, 3500);
    }

    if (probe.ok) {
      node.active = true;
      node.starting = false;
      console.log(`[+] Started ${node.name.padEnd(14)} (Port: ${node.port}) -> Verified Live (${probe.ip})`);
    } else {
      console.warn(`[!] Node ${node.name} failed tunnel probe, cooling down 2m...`);
      node.coolingDown = true;
      setTimeout(() => { node.coolingDown = false; }, 120000);
      await stopNode(node);
      // Deprioritize dead node to end of queue so healthy ones run first
      const idx = ALL_NODES.indexOf(node);
      if (idx > -1) {
        ALL_NODES.splice(idx, 1);
        ALL_NODES.push(node);
      }
    }
  } catch (err) {
    node.starting = false;
    node.active = false;
    console.error(`[!] Error launching ${node.name}: ${err.message}`);
    await stopNode(node);
  }
}

function stopNode(node) {
  node.active = false;
  node.starting = false;
  node.markedForRetire = false;
  node.coolingDown = true;
  setTimeout(() => { node.coolingDown = false; }, 8000); // 8s cooldown before node can restart

  if (!node.process) return Promise.resolve();

  const proc = node.process;
  node.process = null;

  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (!finished) {
        finished = true;
        console.log(`[-] Retired ${node.name.padEnd(14)} (Shut down)`);
        resolve();
      }
    };

    proc.once('exit', done);
    try {
      proc.kill('SIGTERM');
    } catch (e) {
      try { proc.kill('SIGKILL'); } catch (err) {}
      done();
    }
    // Force kill if still lingering after 1.5s
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) {}
      done();
    }, 1500);
  });
}

// Retire a node safely: wait for any in-flight requests to complete before killing
async function retireAndRotateNode(usedNode) {
  if (!usedNode.process && !usedNode.starting) return;

  usedNode.markedForRetire = true;

  // If node still has concurrent in-flight requests, wait until they finish naturally
  if ((usedNode.inFlight || 0) > 0) return;

  await stopNode(usedNode);

  // Push used node to the back of queue
  const idx = ALL_NODES.indexOf(usedNode);
  if (idx > -1) {
    ALL_NODES.splice(idx, 1);
    ALL_NODES.push(usedNode);
  }

  // Pre-warm the next node up to POOL_BUFFER_SIZE
  replenishPool();
}

function handleRequestDone(target, isError = false, failureWeight = 1) {
  target.inFlight = Math.max(0, (target.inFlight || 1) - 1);
  if (isError) {
    target.failures = (target.failures || 0) + failureWeight;
    // If the current sticky node failed, reset stickiness so retries jump to another node
    if (currentStickyNode === target) {
      currentStickyNode = null;
      currentStickyCount = 0;
    }
    // Retire as soon as the failure threshold trips, even with requests still in
    // flight (markedForRetire stops new assignments; the drain path stops the
    // process once the last request finishes). Under sustained load inFlight never
    // reaches 0, so gating on it here would let a dying node serve errors forever.
    if (target.failures >= 5 && !target.markedForRetire) {
      console.warn(`[!] Node ${target.name} hit ${target.failures} consecutive upstream errors, rotating...`);
      retireAndRotateNode(target);
    }
  } else {
    target.failures = 0;
    if ((target.servingCount || 0) >= MAX_REQUESTS_PER_NODE && !target.markedForRetire) {
      retireAndRotateNode(target);
    }
  }

  // If this node was marked for retirement and in-flight reached 0:
  if (target.markedForRetire && target.inFlight === 0) {
    retireAndRotateNode(target);
  }
}

let lastActivityTime = Date.now();
let currentStickyNode = null;
let currentStickyCount = 0;
let isReplenishing = false;
// Requests that entered the handler but have not been assigned a node yet.
// The idle sweeper must count these, otherwise it can tear the pool down in the
// window between "node selected" and "inFlight++" and kill a live request.
let pendingCount = 0;

// Sequential replenishment loop: guarantees NO thundering herd, NO OOM, strict cap
async function replenishPool() {
  if (isReplenishing) return;
  isReplenishing = true;

  try {
    while (getAliveProcessesCount() < POOL_BUFFER_SIZE) {
      const activeKeys = new Set(
        ALL_NODES.filter(n => n.process || n.starting).map(n => n.privateKey).filter(Boolean)
      );

      const eligibleNodes = ALL_NODES.filter(n =>
        !n.process &&
        !n.starting &&
        !n.coolingDown &&
        (!n.privateKey || !activeKeys.has(n.privateKey))
      );

      if (eligibleNodes.length === 0) break;

      // Cold start (whole pool asleep): launch a small parallel burst instead of
      // one-by-one, so the first request after idle sleep waits ~1.5s for a live
      // tunnel rather than 8s+. Steady-state top-ups stay sequential.
      if (getAliveProcessesCount() === 0) {
        const burst = eligibleNodes.slice(0, Math.min(WAKE_BURST, POOL_BUFFER_SIZE));
        await Promise.all(burst.map(n => startNode(n)));
        if (ALL_NODES.some(n => n.process && n.active)) continue;
      }

      // Pick randomly among eligible nodes
      const candidate = eligibleNodes[Math.floor(Math.random() * eligibleNodes.length)];
      await startNode(candidate);
      // Small pause between node starts to keep CPU smooth
      await new Promise(r => setTimeout(r, 150));
    }
  } finally {
    isReplenishing = false;
  }
}

// Wait for at least one node to be verified live
function waitForHealthyNode(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const healthy = ALL_NODES.find(p => p.process && p.active && !p.markedForRetire);
      if (healthy) {
        return resolve(healthy);
      }
      if (Date.now() - start >= timeoutMs) {
        return resolve(null);
      }
      setTimeout(check, 80);
    };
    check();
  });
}

// Strict least-loaded pick with a small random tiebreak. Target-agnostic:
// spreading requests evenly across all exit IPs is what keeps ANY upstream
// (Netflix, other sites, bots) from rate-limiting a single IP.
function pickLeastLoaded(candidates) {
  const min = Math.min(...candidates.map(n => n.inFlight || 0));
  const lightest = candidates.filter(n => (n.inFlight || 0) === min);
  // When many nodes tie at the lightest load (the normal idle case), pick
  // randomly across ALL of them for maximum exit-IP diversity. Only fall back
  // to the top-3 window when a single node is strictly lightest.
  const pool = lightest.length >= 2
    ? lightest
    : candidates.slice().sort((a, b) => (a.inFlight || 0) - (b.inFlight || 0)).slice(0, 3);
  return pool[Math.floor(Math.random() * pool.length)];
}

async function getOrWarmProxy() {
  lastActivityTime = Date.now();
  let healthy = ALL_NODES.filter(p => p.process && p.active && !p.markedForRetire);

  // If no healthy nodes exist right now, wait for pool to spin up (prevents spawning burst!)
  if (healthy.length === 0) {
    replenishPool(); // Make sure replenishment is running
    // 4.5s fail-fast: cold-start burst prepares nodes quickly
    await waitForHealthyNode(4500);
    healthy = ALL_NODES.filter(p => p.process && p.active && !p.markedForRetire);
    if (healthy.length === 0) {
      const anyLive = ALL_NODES.find(p => p.process && p.active);
      if (anyLive) return anyLive;
      throw new Error('No proxy nodes currently available in pool');
    }
  }

  // Sticky for STICKY_REQUESTS_PER_NODE requests: keeps sessions that benefit
  // from IP stability short-lived but predictable. The count gates WHEN
  // rotation happens, never whether a request is accepted - under a thread
  // storm every request still gets a node instantly. A saturated node loses
  // stickiness so new traffic steers away.
  if (currentStickyNode && currentStickyNode.process && currentStickyNode.active && !currentStickyNode.markedForRetire && currentStickyCount < STICKY_REQUESTS_PER_NODE && (currentStickyNode.inFlight || 0) < STICKY_MAX_INFLIGHT) {
    currentStickyCount++;
    return currentStickyNode;
  }

  // Rotation time: strict least-loaded pick (target-agnostic - works for any
  // upstream site). The previous node keeps its port and process open:
  // existing tunnels drain naturally, and it stays warm in the pool.
  const nonSticky = healthy.filter(n => n !== currentStickyNode);
  const candidates = nonSticky.length > 0 ? nonSticky : healthy;
  const pick = pickLeastLoaded(candidates);
  currentStickyNode = pick;
  currentStickyCount = 1;
  return pick;
}

function initPool() {
  ALL_NODES = parseConfigs();

  // Prioritize low-latency Asia-Pacific servers for Railway Southeast Asia (Singapore)
  const asiaCodes = new Set(['sg', 'my', 'vn', 'th', 'ph', 'id', 'kh', 'in', 'bd', 'bt', 'hk', 'tw', 'jp', 'kr']);
  const asiaNodes = ALL_NODES.filter(n => {
    const code = n.file.replace(/^wireproxy-/, '').replace(/\d+\.conf$/, '').replace(/\.conf$/, '').toLowerCase().replace('-', '');
    return asiaCodes.has(code);
  });
  const otherNodes = ALL_NODES.filter(n => !asiaNodes.includes(n));

  // Shuffle within Asia nodes
  for (let i = asiaNodes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [asiaNodes[i], asiaNodes[j]] = [asiaNodes[j], asiaNodes[i]];
  }
  ALL_NODES = [...asiaNodes, ...otherNodes];

  console.log(`==========================================================`);
  console.log(` Wireproxy Ephemeral Rotating Proxy (Optimized Low-Latency)`);
  console.log(` Total Configs:    ${ALL_NODES.length} servers (${asiaNodes.length} Asia prioritized)`);
  console.log(` Warm Buffer:      ${POOL_BUFFER_SIZE} servers pre-warmed & ready`);
  console.log(` Max Per Node:     ${MAX_REQUESTS_PER_NODE} requests`);
  console.log(` Balancing:        unlimited requests, least-loaded spread`);
  console.log(` Idle Timeout:     ${Math.round(IDLE_TIMEOUT_MS / 1000)}s auto-sleep (wake burst: ${WAKE_BURST})`);
  console.log(` Authentication:   None (Public / Open for Bot)`);
  console.log(`==========================================================\n`);

  replenishPool();
}

// HTTP Proxy Handler (No Auth Required)
const httpServer = http.createServer(async (req, res) => {
  pendingCount++;
  try {
    await forwardHttp(req, res, 0);
  } finally {
    pendingCount--;
  }
});

async function forwardHttp(req, res, attempt) {
  if (res.headersSent || res.destroyed) return;
  let target;
  try {
    target = await getOrWarmProxy();
  } catch (err) {
    if (attempt < 2 && !res.headersSent && !res.destroyed) {
      setTimeout(() => forwardHttp(req, res, attempt + 1), 300);
      return;
    }
    if (!res.headersSent && !res.destroyed) {
      try {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
      } catch (e) {}
    }
    return;
  }

  target.inFlight = (target.inFlight || 0) + 1;
  target.servingCount = (target.servingCount || 0) + 1;

  let finished = false;
  function done(isErr, waf = false) {
    if (finished) return;
    finished = true;
    handleRequestDone(target, isErr, waf ? 2 : 1);
  }

  const options = {
    hostname: target.host,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: req.headers,
    timeout: 3800, // 3.8s fast timeout on stalled node
  };

  let responseStarted = false;
  let retryScheduled = false;

  function scheduleRetry(statusCode, statusMessage) {
    if (retryScheduled || responseStarted || res.headersSent || res.destroyed) return;
    retryScheduled = true;
    done(true);
    if (attempt < 2 && !res.headersSent && !res.destroyed) {
      setTimeout(() => forwardHttp(req, res, attempt + 1), 100);
    } else if (!res.headersSent && !res.destroyed) {
      try {
        res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
        res.end(statusMessage);
      } catch (e) {}
    }
  }

  const proxyReq = http.request(options, (proxyRes) => {
    if (res.headersSent || res.destroyed) {
      proxyReq.destroy();
      return;
    }
    responseStarted = true;
    const wafHit = proxyRes.statusCode === 403 || proxyRes.statusCode === 429;
    if (!wafHit) target.failures = 0;
    try {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    } catch (e) {
      done(true);
      return;
    }

    res.on('finish', () => done(wafHit, wafHit));
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    scheduleRetry(504, 'Gateway Timeout');
  });

  proxyReq.on('error', () => {
    scheduleRetry(502, 'Bad Gateway');
  });

  req.on('error', () => {
    done(false); // Client aborted, not a node failure
  });

  req.pipe(proxyReq);
}

// HTTPS CONNECT Tunnel Handler (No Auth Required)
httpServer.on('connect', async (req, clientSocket, head) => {
  pendingCount++;
  try {
    await forwardConnect(req, clientSocket, head, 0);
  } finally {
    pendingCount--;
  }
});

async function forwardConnect(req, clientSocket, head, attempt) {
  let target;
  try {
    target = await getOrWarmProxy();
  } catch (err) {
    if (attempt < 2 && !clientSocket.destroyed) {
      setTimeout(() => forwardConnect(req, clientSocket, head, attempt + 1), 300);
      return;
    }
    try {
      clientSocket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      clientSocket.end();
    } catch (e) {}
    return;
  }

  target.inFlight = (target.inFlight || 0) + 1;
  target.servingCount = (target.servingCount || 0) + 1;

  let finished = false;
  function done(isErr) {
    if (finished) return;
    finished = true;
    handleRequestDone(target, isErr);
  }

  // 2.8s fast failover: if node has not established tunnel within 2.8s, jump to next warm node!
  let connectTimer = setTimeout(() => {
    if (!finished) {
      try { upstreamSocket.destroy(); } catch (e) {}
      done(true);
      if (attempt < 2 && !clientSocket.destroyed) {
        forwardConnect(req, clientSocket, head, attempt + 1);
      } else {
        try {
          clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
          clientSocket.end();
        } catch (e) {}
      }
    }
  }, 2800);

  const upstreamSocket = net.connect(target.port, target.host);

  upstreamSocket.on('error', () => {
    clearTimeout(connectTimer);
    done(true);
    if (attempt < 2 && !clientSocket.destroyed) {
      forwardConnect(req, clientSocket, head, attempt + 1);
    } else {
      try { clientSocket.destroy(); } catch (e) {}
    }
  });

  clientSocket.on('error', () => {
    clearTimeout(connectTimer);
    try { upstreamSocket.destroy(); } catch (e) {}
    done(false);
  });

  upstreamSocket.on('connect', () => {
    try {
      upstreamSocket.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n\r\n`);
    } catch (e) {
      done(true);
    }
  });

  upstreamSocket.once('data', (data) => {
    clearTimeout(connectTimer);
    if (data.toString().includes('200')) {
      target.failures = 0;
      try {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) upstreamSocket.write(head);
        clientSocket.pipe(upstreamSocket);
        upstreamSocket.pipe(clientSocket);
      } catch (e) {
        done(true);
      }
    } else {
      done(true);
      if (attempt < 2) {
        forwardConnect(req, clientSocket, head, attempt + 1);
      } else {
        try {
          clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          clientSocket.end();
        } catch (e) {}
      }
    }
  });

  clientSocket.once('close', () => done(false));
  upstreamSocket.once('close', () => done(false));

  // Inactivity reap: a healthy client writes within a second of the CONNECT
  // handshake. 9s of silence means the node's exit is stuck - kill the tunnel
  // and count it as a failure before a typical 10s client timeout does.
  upstreamSocket.setTimeout(9000);
  upstreamSocket.on('timeout', () => {
    try { upstreamSocket.destroy(); } catch (e) {}
    try { clientSocket.destroy(); } catch (e) {}
    done(true);
  });
}

// SOCKS5 Tunnel Handler (Transparent Forwarding to Node's Socks5 Port)
async function handleSocks5(clientSocket, initialChunk) {
  let target;
  try {
    target = await getOrWarmProxy();
  } catch (err) {
    try { clientSocket.end(); } catch (e) {}
    return;
  }
  if (!target || !target.socksPort) {
    try { clientSocket.end(); } catch (e) {}
    return;
  }

  target.inFlight = (target.inFlight || 0) + 1;
  target.servingCount = (target.servingCount || 0) + 1;

  let finished = false;
  function onSocksDone(isError = false) {
    if (finished) return;
    finished = true;
    handleRequestDone(target, isError);
  }

  const upstreamSocket = net.connect(target.socksPort, target.host);

  upstreamSocket.on('error', () => {
    try { clientSocket.destroy(); } catch (e) {}
    onSocksDone(true);
  });

  clientSocket.on('error', () => {
    try { upstreamSocket.destroy(); } catch (e) {}
    onSocksDone(false);
  });

  upstreamSocket.on('connect', () => {
    try {
      upstreamSocket.write(initialChunk);
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);
    } catch (e) {
      onSocksDone(true);
    }
  });

  clientSocket.once('close', () => onSocksDone(false));
  upstreamSocket.once('close', () => onSocksDone(false));

  // Same inactivity reap as the CONNECT path: 9s of silence = stuck exit.
  upstreamSocket.setTimeout(9000);
  upstreamSocket.on('timeout', () => {
    try { upstreamSocket.destroy(); } catch (e) {}
    try { clientSocket.destroy(); } catch (e) {}
    onSocksDone(true);
  });
}

// Periodic rolling replacement: retire the busiest idle node and spin up a
// fresh catalog config so the pool cycles IPs over long runs. The interval is
// deliberately long: Proton device slots take time to free server-side, and
// killing nodes every few seconds caused a spawn->probe-fail->spawn churn that
// collapsed the live pool to 3-4 nodes (fewer live IPs = more requests per IP
// = rate-limit errors on any upstream).
const ROLLING_REPLACE_MS = parseInt(process.env.ROLLING_REPLACE_MS || '300000', 10);
setInterval(async () => {
  const activeNodes = ALL_NODES.filter(n => n.process && n.active && !n.markedForRetire && n.inFlight === 0);
  if (activeNodes.length >= POOL_BUFFER_SIZE) {
    // Pick the node that has served the most requests or a random active node
    const oldest = activeNodes.sort((a, b) => (b.servingCount || 0) - (a.servingCount || 0))[0];
    if (oldest) {
      await retireAndRotateNode(oldest);
    }
  } else {
    replenishPool();
  }
}, ROLLING_REPLACE_MS);

// Background idle sweeper: If system is idle for IDLE_TIMEOUT_MS, put WireGuard instances to sleep
// to free the Proton device slot 100% so you can use Proton on phone/PC without collision!
setInterval(() => {
  const idleDuration = Date.now() - lastActivityTime;
  const inFlightCount = ALL_NODES.reduce((sum, n) => sum + (n.inFlight || 0), 0);

  if (idleDuration >= IDLE_TIMEOUT_MS && inFlightCount === 0 && pendingCount === 0) {
    const activeNodes = ALL_NODES.filter(n => n.process && n.active);
    if (activeNodes.length > 0) {
      console.log(`[Idle Sleep] Inactive for ${Math.round(idleDuration / 1000)}s. Shutting down active WireGuard nodes to free Proton device slot...`);
      for (const node of activeNodes) {
        stopNode(node);
      }
    }
  }
}, 15000);

// Master Dual-Protocol Server (Listens on ROTATOR_PORT and auto-sniffs HTTP vs SOCKS5)
const masterServer = net.createServer((clientSocket) => {
  clientSocket.once('data', async (chunk) => {
    if (chunk.length > 0 && chunk[0] === 0x05) {
      // SOCKS5 protocol detected
      await handleSocks5(clientSocket, chunk);
    } else {
      // HTTP or HTTPS CONNECT protocol detected
      clientSocket.unshift(chunk);
      httpServer.emit('connection', clientSocket);
    }
  });

  clientSocket.on('error', () => {
    clientSocket.destroy();
  });
});

masterServer.listen(ROTATOR_PORT, BIND_ADDRESS, () => {
  initPool();
  console.log(` Master Rotating Proxy (DUAL HTTP & SOCKS5) listening at ${BIND_ADDRESS}:${ROTATOR_PORT} (NO AUTH REQUIRED)\n`);
});

// Watch configs folder for new additions
if (fs.existsSync(CONFIGS_DIR)) {
  fs.watch(CONFIGS_DIR, (eventType, filename) => {
    if (filename && filename.endsWith('.conf')) {
      const currentFiles = ALL_NODES.map(n => n.file);
      if (!currentFiles.includes(filename)) {
        console.log(`[Config Discovery] Detected new server file: ${filename}`);
        const newNodes = parseConfigs();
        const newlyAdded = newNodes.find(n => n.file === filename);
        if (newlyAdded) {
          ALL_NODES.push(newlyAdded);
          console.log(`[Config Discovery] Registered ${newlyAdded.name} into rotation queue.`);
          const activeCount = ALL_NODES.filter(n => n.process && n.active).length;
          if (activeCount < POOL_BUFFER_SIZE) {
            startNode(newlyAdded);
          }
        }
      }
    }
  });
}

// Cleanup and safety
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err && err.stack ? err.stack : err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

function cleanup(signal) {
  console.log(`\n[!] Shutting down all Wireproxy instances (Signal: ${signal})...`);
  for (const node of ALL_NODES) {
    if (node.process) {
      stopNode(node);
    }
  }
  process.exit(0);
}

process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));
