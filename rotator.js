const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIGS_DIR = path.join(__dirname, 'configs');

// Configuration
// Pool buffer size: number of warm WireGuard instances running at once (default 7, reserving 2 slots for personal PC & phone, 1 safety buffer under Proton's 10 limit)
const POOL_BUFFER_SIZE = parseInt(process.env.POOL_SIZE || '7', 10);
const MAX_REQUESTS_PER_NODE = parseInt(process.env.MAX_REQUESTS_PER_NODE || '100', 10);
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
  const files = fs.readdirSync(CONFIGS_DIR).filter(f => f.endsWith('.conf'));

  // Priority Sort: Vietnam & Singapore first (ultra-low latency from Railway SG), then East Asia, then major hubs, then worldwide
  const priorityPrefixes = [
    'wireproxy-vn',
    'wireproxy-sg',
    'wireproxy-hk',
    'wireproxy-jp',
    'wireproxy-tw',
    'wireproxy-kr',
    'wireproxy-us',
    'wireproxy-de',
    'wireproxy-uk',
  ];

  files.sort((a, b) => {
    const aPrio = priorityPrefixes.findIndex(p => a.startsWith(p));
    const bPrio = priorityPrefixes.findIndex(p => b.startsWith(p));
    if (aPrio !== -1 && bPrio !== -1) {
      if (aPrio === bPrio) return a.localeCompare(b);
      return aPrio - bPrio;
    }
    if (aPrio !== -1) return -1;
    if (bPrio !== -1) return 1;
    return a.localeCompare(b);
  });

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
        failures: 0,
        inFlight: 0,
        servingCount: 0,
        markedForRetire: false,
      });
    }
  }
  return nodes;
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 4000) {
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

async function startNode(node) {
  if (node.process || node.starting) return;
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

    // Wait until local wireproxy port is confirmed listening before routing any traffic!
    const ready = await waitForPort(node.port, node.host, 4000);
    if (ready) {
      node.active = true;
      node.starting = false;
      console.log(`[+] Started ${node.name.padEnd(14)} (Port: ${node.port}) -> Pre-warmed & Ready`);
    } else {
      console.warn(`[!] Node ${node.name} failed port check within 4s`);
      stopNode(node);
    }
  } catch (err) {
    node.starting = false;
    node.active = false;
    console.error(`[!] Error launching ${node.name}: ${err.message}`);
  }
}

function stopNode(node) {
  node.active = false;
  node.starting = false;
  node.markedForRetire = false;
  if (!node.process) return;

  const proc = node.process;
  node.process = null;
  try {
    proc.kill('SIGTERM');
  } catch (e) {
    try { proc.kill('SIGKILL'); } catch (err) {}
  }
  console.log(`[-] Retired ${node.name.padEnd(14)} (Shut down)`);
}

// Retire a node safely: wait for any in-flight requests to complete before killing
function retireAndRotateNode(usedNode) {
  if (!usedNode.process && !usedNode.starting) return;

  usedNode.markedForRetire = true;

  // If node still has concurrent in-flight requests, wait until they finish naturally
  if ((usedNode.inFlight || 0) > 0) return;

  stopNode(usedNode);

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
    // Only retire if repeated failures occur and no active requests remain
    if (target.failures >= 5 && target.inFlight === 0) {
      console.warn(`[!] Node ${target.name} hit 5 consecutive errors, rotating...`);
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

// Pre-warm background nodes up to POOL_BUFFER_SIZE if below target
function replenishPool() {
  const activeOrStarting = ALL_NODES.filter(n => (n.process && n.active) || n.starting).length;
  if (activeOrStarting < POOL_BUFFER_SIZE) {
    const needed = POOL_BUFFER_SIZE - activeOrStarting;
    const dormantNodes = ALL_NODES.filter(n => !n.process && !n.starting);
    for (let i = 0; i < Math.min(needed, dormantNodes.length); i++) {
      startNode(dormantNodes[i]);
    }
  }
}

async function getOrWarmProxy() {
  lastActivityTime = Date.now();
  const healthy = ALL_NODES.filter(p => p.process && p.active && !p.markedForRetire);
  if (healthy.length > 0) {
    const proxy = healthy[currentIndex % healthy.length];
    currentIndex = (currentIndex + 1) % healthy.length;
    replenishPool();
    return proxy;
  }

  // If all were sleeping or none ready yet:
  const starting = ALL_NODES.find(n => n.starting);
  if (starting) {
    await waitForPort(starting.port, starting.host, 3000);
    if (starting.active) return starting;
  }

  const dormant = ALL_NODES.filter(n => !n.process && !n.starting);
  const candidate = dormant[0] || ALL_NODES[0];
  if (candidate) {
    console.log(`[On-Demand Wakeup] Starting ${candidate.name}...`);
    await startNode(candidate);
    replenishPool();
    return candidate;
  }
  return ALL_NODES[0];
}

function initPool() {
  ALL_NODES = parseConfigs();
  console.log(`==========================================================`);
  console.log(` Wireproxy Ephemeral Rotating Proxy (One-Shot Per-Server)`);
  console.log(` Total Configs:    ${ALL_NODES.length} servers`);
  console.log(` Warm Buffer:      ${POOL_BUFFER_SIZE} servers pre-warmed & ready`);
  console.log(` Max Per Node:     ${MAX_REQUESTS_PER_NODE} requests`);
  console.log(` Idle Timeout:     ${Math.round(IDLE_TIMEOUT_MS / 1000)}s auto-sleep`);
  console.log(` Authentication:   None (Public / Open for Bot)`);
  console.log(`==========================================================\n`);

  const initialCount = Math.min(POOL_BUFFER_SIZE, ALL_NODES.length);
  for (let i = 0; i < initialCount; i++) {
    startNode(ALL_NODES[i]);
  }
}

// HTTP Proxy Handler (No Auth Required)
const httpServer = http.createServer(async (req, res) => {
  await forwardHttp(req, res, 0);
});

async function forwardHttp(req, res, attempt) {
  const target = await getOrWarmProxy();
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
    done(true);
  });

  req.pipe(proxyReq);
}

// HTTPS CONNECT Tunnel Handler (No Auth Required)
httpServer.on('connect', async (req, clientSocket, head) => {
  await forwardConnect(req, clientSocket, head, 0);
});

async function forwardConnect(req, clientSocket, head, attempt) {
  const target = await getOrWarmProxy();
  target.inFlight = (target.inFlight || 0) + 1;
  target.servingCount = (target.servingCount || 0) + 1;

  let finished = false;
  function done(isErr) {
    if (finished) return;
    finished = true;
    handleRequestDone(target, isErr);
  }

  const upstreamSocket = net.connect(target.port, target.host, () => {
    upstreamSocket.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n\r\n`);

    upstreamSocket.once('data', (data) => {
      if (data.toString().includes('200')) {
        target.failures = 0;
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) upstreamSocket.write(head);
        clientSocket.pipe(upstreamSocket);
        upstreamSocket.pipe(clientSocket);
      } else {
        done(true);
        if (attempt < 2) {
          forwardConnect(req, clientSocket, head, attempt + 1);
        } else {
          clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          clientSocket.end();
        }
      }
    });
  });

  clientSocket.once('close', () => done(false));
  upstreamSocket.once('close', () => done(false));

  upstreamSocket.setTimeout(30000);
  upstreamSocket.on('timeout', () => {
    upstreamSocket.destroy();
    clientSocket.destroy();
    done(true);
  });

  upstreamSocket.on('error', () => {
    clientSocket.destroy();
    done(true);
  });

  clientSocket.on('error', () => {
    upstreamSocket.destroy();
    done(true);
  });
}

// SOCKS5 Tunnel Handler (Transparent Forwarding to Node's Socks5 Port)
async function handleSocks5(clientSocket, initialChunk) {
  const target = await getOrWarmProxy();
  if (!target || !target.socksPort) {
    clientSocket.end();
    return;
  }

  target.inFlight = (target.inFlight || 0) + 1;
  target.servingCount = (target.servingCount || 0) + 1;

  const upstreamSocket = net.connect(target.socksPort, target.host, () => {
    upstreamSocket.write(initialChunk);
    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);
  });

  let finished = false;
  function onSocksDone(isError = false) {
    if (finished) return;
    finished = true;
    handleRequestDone(target, isError);
  }

  clientSocket.once('close', () => onSocksDone(false));
  upstreamSocket.once('close', () => onSocksDone(false));

  upstreamSocket.setTimeout(30000);
  upstreamSocket.on('timeout', () => {
    upstreamSocket.destroy();
    clientSocket.destroy();
    onSocksDone(true);
  });

  upstreamSocket.on('error', () => {
    clientSocket.destroy();
    onSocksDone(true);
  });

  clientSocket.on('error', () => {
    upstreamSocket.destroy();
    onSocksDone(true);
  });
}

// Periodic graceful rotation: Every 30s, swap the oldest node to ensure continuous rotation across all 42 countries
setInterval(() => {
  const activeNodes = ALL_NODES.filter(n => n.process && n.active && !n.markedForRetire && n.inFlight === 0);
  const dormantNodes = ALL_NODES.filter(n => !n.process);
  if (activeNodes.length > 0 && dormantNodes.length > 0) {
    retireAndRotateNode(activeNodes[0]);
  }
}, 30000);

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

// Cleanup on exit
function cleanup() {
  console.log('\n[!] Shutting down all Wireproxy instances...');
  for (const node of ALL_NODES) {
    if (node.process) {
      stopNode(node);
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
