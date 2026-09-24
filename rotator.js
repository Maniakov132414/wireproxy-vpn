const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIGS_DIR = path.join(__dirname, 'configs');

// Configuration
// Hard Pool Buffer Size: 5 warm instances. Uses only 5 slots, perfectly safe under Proton's 10 limit & Railway 512MB RAM
const POOL_BUFFER_SIZE = parseInt(process.env.POOL_SIZE || '5', 10);
const STICKY_REQUESTS_PER_NODE = parseInt(process.env.STICKY_REQUESTS || '3', 10);
const MAX_REQUESTS_PER_NODE = parseInt(process.env.MAX_REQUESTS_PER_NODE || '200', 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || '90000', 10);
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
function probeNodeConnectivity(port, host = '127.0.0.1', timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get({
      host,
      port,
      path: 'http://1.1.1.1/cdn-cgi/trace',
      timeout: timeoutMs,
      headers: { Host: '1.1.1.1' },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const ipMatch = body.match(/ip=([^\r\n]+)/);
        resolve({ ok: true, ip: ipMatch ? ipMatch[1].trim() : 'live' });
      });
    });
    req.on('error', () => resolve({ ok: false }));
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

    // Actively probe WireGuard tunnel connectivity before exposing to clients!
    const probe = await probeNodeConnectivity(node.port, node.host, 5000);
    if (probe.ok) {
      node.active = true;
      node.starting = false;
      console.log(`[+] Started ${node.name.padEnd(14)} (Port: ${node.port}) -> Verified Live (${probe.ip})`);
    } else {
      console.warn(`[!] Node ${node.name} failed tunnel handshake probe, bypassing...`);
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

function handleRequestDone(target, isError = false) {
  target.inFlight = Math.max(0, (target.inFlight || 1) - 1);
  if (isError) {
    target.failures = (target.failures || 0) + 1;
    // If the current sticky node failed, reset stickiness so retries jump to another node
    if (currentStickyNode === target) {
      currentStickyNode = null;
      currentStickyCount = 0;
    }
    // Only retire if repeated upstream failures occur and no active requests remain
    if (target.failures >= 5 && target.inFlight === 0) {
      console.warn(`[!] Node ${target.name} hit 5 consecutive upstream errors, rotating...`);
      retireAndRotateNode(target);
    }
  } else {
    target.failures = 0;
    if ((target.servingCount || 0) >= MAX_REQUESTS_PER_NODE && target.inFlight === 0) {
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

// Sequential replenishment loop: guarantees NO thundering herd, NO OOM, strict cap
async function replenishPool() {
  if (isReplenishing) return;
  isReplenishing = true;

  try {
    while (getAliveProcessesCount() < POOL_BUFFER_SIZE) {
      const dormantNodes = ALL_NODES.filter(n => !n.process && !n.starting && !n.coolingDown);
      if (dormantNodes.length === 0) break;

      // Pick randomly among dormant nodes
      const candidate = dormantNodes[Math.floor(Math.random() * dormantNodes.length)];
      await startNode(candidate);
      // Small pause between node starts to keep CPU smooth
      await new Promise(r => setTimeout(r, 200));
    }
  } finally {
    isReplenishing = false;
  }
}

// Wait for at least one node to be verified live
function waitForHealthyNode(timeoutMs = 12000) {
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
      setTimeout(check, 100);
    };
    check();
  });
}

async function getOrWarmProxy() {
  lastActivityTime = Date.now();
  let healthy = ALL_NODES.filter(p => p.process && p.active && !p.markedForRetire);

  // If no healthy nodes exist right now, wait for pool to spin up (prevents spawning burst!)
  if (healthy.length === 0) {
    replenishPool(); // Make sure replenishment is running
    await waitForHealthyNode(12000);
    healthy = ALL_NODES.filter(p => p.process && p.active && !p.markedForRetire);
    if (healthy.length === 0) {
      const anyLive = ALL_NODES.find(p => p.process && p.active);
      if (anyLive) return anyLive;
      throw new Error('No proxy nodes currently available in pool');
    }
  }

  // Sticky 3 requests per node: keeps cookie check sessions stable and prevents abrupt IP jumping!
  if (currentStickyNode && currentStickyNode.process && currentStickyNode.active && !currentStickyNode.markedForRetire && currentStickyCount < STICKY_REQUESTS_PER_NODE) {
    currentStickyCount++;
    return currentStickyNode;
  }

  // After STICKY_REQUESTS_PER_NODE requests, pick a new random node from the healthy warm pool
  let candidates = healthy.filter(n => n !== currentStickyNode);
  if (candidates.length === 0) candidates = healthy;
  const randomIndex = Math.floor(Math.random() * candidates.length);
  currentStickyNode = candidates[randomIndex];
  currentStickyCount = 1;
  return currentStickyNode;
}

function initPool() {
  ALL_NODES = parseConfigs();
  // Shuffle all nodes initially for 100% random startup across all countries
  for (let i = ALL_NODES.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ALL_NODES[i], ALL_NODES[j]] = [ALL_NODES[j], ALL_NODES[i]];
  }

  console.log(`==========================================================`);
  console.log(` Wireproxy Ephemeral Rotating Proxy (100% Random Rotation)`);
  console.log(` Total Configs:    ${ALL_NODES.length} servers`);
  console.log(` Warm Buffer:      ${POOL_BUFFER_SIZE} servers pre-warmed & ready`);
  console.log(` Max Per Node:     ${MAX_REQUESTS_PER_NODE} requests`);
  console.log(` Idle Timeout:     ${Math.round(IDLE_TIMEOUT_MS / 1000)}s auto-sleep`);
  console.log(` Authentication:   None (Public / Open for Bot)`);
  console.log(`==========================================================\n`);

  replenishPool();
}

// HTTP Proxy Handler (No Auth Required)
const httpServer = http.createServer(async (req, res) => {
  await forwardHttp(req, res, 0);
});

async function forwardHttp(req, res, attempt) {
  let target;
  try {
    target = await getOrWarmProxy();
  } catch (err) {
    if (attempt < 2) {
      setTimeout(() => forwardHttp(req, res, attempt + 1), 600);
      return;
    }
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Service Unavailable');
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

  const options = {
    hostname: target.host,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: req.headers,
    timeout: 25000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    target.failures = 0;
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);

    res.on('finish', () => done(false));
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    done(true);
    if (attempt < 2) {
      forwardHttp(req, res, attempt + 1);
    } else {
      res.writeHead(504, { 'Content-Type': 'text/plain' });
      res.end('Gateway Timeout');
    }
  });

  proxyReq.on('error', () => {
    done(true);
    if (attempt < 2) {
      forwardHttp(req, res, attempt + 1);
    } else {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    }
  });

  req.on('error', () => {
    done(false); // Client aborted, not a node failure
  });

  req.pipe(proxyReq);
}

// HTTPS CONNECT Tunnel Handler (No Auth Required)
httpServer.on('connect', async (req, clientSocket, head) => {
  await forwardConnect(req, clientSocket, head, 0);
});

async function forwardConnect(req, clientSocket, head, attempt) {
  let target;
  try {
    target = await getOrWarmProxy();
  } catch (err) {
    if (attempt < 2) {
      setTimeout(() => forwardConnect(req, clientSocket, head, attempt + 1), 600);
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

  let connectTimer = setTimeout(() => {
    if (!finished) {
      try { upstreamSocket.destroy(); } catch (e) {}
      done(true);
      if (attempt < 2) {
        forwardConnect(req, clientSocket, head, attempt + 1);
      } else {
        try {
          clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
          clientSocket.end();
        } catch (e) {}
      }
    }
  }, 12000);

  const upstreamSocket = net.connect(target.port, target.host);

  upstreamSocket.on('error', () => {
    clearTimeout(connectTimer);
    try { clientSocket.destroy(); } catch (e) {}
    done(true);
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

  upstreamSocket.setTimeout(30000);
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

  upstreamSocket.setTimeout(30000);
  upstreamSocket.on('timeout', () => {
    try { upstreamSocket.destroy(); } catch (e) {}
    try { clientSocket.destroy(); } catch (e) {}
    onSocksDone(true);
  });
}

// Periodic rolling replacement: Every 45s, retire the oldest idle node so the pool rotates through all 73 catalog servers over time
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
}, 45000);

// Background idle sweeper: If system is idle for IDLE_TIMEOUT_MS, put WireGuard instances to sleep
// to free the Proton device slot 100% so you can use Proton on phone/PC without collision!
setInterval(() => {
  const idleDuration = Date.now() - lastActivityTime;
  const inFlightCount = ALL_NODES.reduce((sum, n) => sum + (n.inFlight || 0), 0);

  if (idleDuration >= IDLE_TIMEOUT_MS && inFlightCount === 0) {
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
