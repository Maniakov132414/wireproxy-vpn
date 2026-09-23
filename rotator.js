const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIGS_DIR = path.join(__dirname, 'configs');

// Configuration
// Pool buffer size: number of warm WireGuard instances running at once (default 7, reserving 2 slots for personal PC & phone, 1 safety buffer under Proton's 10 limit)
const POOL_BUFFER_SIZE = parseInt(process.env.POOL_SIZE || '7', 10);
const MAX_REQUESTS_PER_NODE = parseInt(process.env.MAX_REQUESTS_PER_NODE || '25', 10);
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

function startNode(node) {
  if (node.process) return;

  try {
    const child = spawn(WIREPROXY_BIN, ['-s', '-c', node.filePath], {
      stdio: 'ignore',
      windowsHide: true,
    });

    node.process = child;
    node.failures = 0;
    node.active = true;
    node.markedForRetire = false;

    child.on('error', (err) => {
      console.error(`[!] Failed to spawn ${node.name}: ${err.message}`);
      node.process = null;
      node.active = false;
    });

    child.on('exit', () => {
      node.process = null;
      node.active = false;
    });

    console.log(`[+] Started ${node.name.padEnd(14)} (Port: ${node.port}) -> Pre-warmed & Ready`);
  } catch (err) {
    console.error(`[!] Error launching ${node.name}: ${err.message}`);
  }
}

function stopNode(node) {
  if (!node.process) {
    node.active = false;
    node.markedForRetire = false;
    return;
  }
  const proc = node.process;
  node.process = null;
  node.active = false;
  node.markedForRetire = false;
  try {
    proc.kill('SIGTERM');
  } catch (e) {
    try { proc.kill('SIGKILL'); } catch (err) {}
  }
  console.log(`[-] Retired ${node.name.padEnd(14)} (Finished request -> Shut down)`);
}

// Retire a node that just finished its request, and immediately warm up the next dormant node
function retireAndRotateNode(usedNode) {
  // If already retired or not running, skip
  if (!usedNode.process) return;

  usedNode.markedForRetire = true;

  // If node still has other concurrent in-flight requests, wait until they finish
  if (usedNode.inFlight > 0) return;

  // Shut down the finished node first to free the device slot immediately
  stopNode(usedNode);

  // Push used node to the back of queue
  const idx = ALL_NODES.indexOf(usedNode);
  if (idx > -1) {
    ALL_NODES.splice(idx, 1);
    ALL_NODES.push(usedNode);
  }

  // Pre-warm the next node up to POOL_BUFFER_SIZE
  const activeCount = ALL_NODES.filter(n => n.process && n.active).length;
  if (activeCount < POOL_BUFFER_SIZE) {
    const dormantNodes = ALL_NODES.filter(n => !n.process);
    if (dormantNodes.length > 0) {
      const nextNode = dormantNodes[0];
      console.log(`\n[Auto-Rotate] ${usedNode.name} finished task. Launching fresh ${nextNode.name}...`);
      startNode(nextNode);
    }
  }
}

function handleRequestDone(target, isError = false) {
  target.inFlight = Math.max(0, (target.inFlight || 1) - 1);
  if (isError) {
    target.failures = (target.failures || 0) + 1;
    retireAndRotateNode(target);
  } else if ((target.servingCount || 0) >= MAX_REQUESTS_PER_NODE) {
    retireAndRotateNode(target);
  }
}

let lastActivityTime = Date.now();

function waitForPort(port, host = '127.0.0.1', timeoutMs = 3000) {
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
          setTimeout(tryConnect, 50);
        }
      });
    };
    tryConnect();
  });
}

// Pre-warm background nodes up to POOL_BUFFER_SIZE if below target
function replenishPool() {
  const activeCount = ALL_NODES.filter(n => n.process && n.active).length;
  if (activeCount < POOL_BUFFER_SIZE) {
    const needed = POOL_BUFFER_SIZE - activeCount;
    const dormantNodes = ALL_NODES.filter(n => !n.process);
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

  // If all were sleeping or none available:
  const dormant = ALL_NODES.filter(n => !n.process);
  const candidate = dormant[0] || ALL_NODES[0];
  if (candidate) {
    console.log(`[On-Demand Wakeup] Starting ${candidate.name}...`);
    startNode(candidate);
    await waitForPort(candidate.port, candidate.host, 3000);
    setTimeout(replenishPool, 300);
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
  console.log(` Idle Timeout:     ${Math.round(IDLE_TIMEOUT_MS / 1000)}s auto-sleep`);
  console.log(` Authentication:   None (Public / Open for Bot)`);
  console.log(` Rotation Rule:    After a server serves a request, it shuts down`);
  console.log(`                   and the next fresh country server launches!`);
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
  if (attempt >= 3) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    return res.end('All active upstream proxies failed');
  }

  const target = await getOrWarmProxy();
  target.inFlight = (target.inFlight || 0) + 1;
  target.servingCount = (target.servingCount || 0) + 1;

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

    res.on('finish', () => {
      handleRequestDone(target, false);
    });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    handleRequestDone(target, true);
    forwardHttp(req, res, attempt + 1);
  });

  proxyReq.on('error', () => {
    handleRequestDone(target, true);
    forwardHttp(req, res, attempt + 1);
  });

  req.pipe(proxyReq);
}

// HTTPS CONNECT Tunnel Handler (No Auth Required)
httpServer.on('connect', async (req, clientSocket, head) => {
  await forwardConnect(req, clientSocket, head, 0);
});

async function forwardConnect(req, clientSocket, head, attempt) {
  if (attempt >= 3) {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    return clientSocket.end();
  }

  const target = await getOrWarmProxy();
  target.inFlight = (target.inFlight || 0) + 1;
  target.servingCount = (target.servingCount || 0) + 1;

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
        handleRequestDone(target, true);
        forwardConnect(req, clientSocket, head, attempt + 1);
      }
    });
  });

  function onConnectDone() {
    handleRequestDone(target, false);
  }

  clientSocket.once('close', onConnectDone);
  upstreamSocket.once('close', onConnectDone);

  upstreamSocket.setTimeout(30000);
  upstreamSocket.on('timeout', () => {
    upstreamSocket.destroy();
    handleRequestDone(target, true);
    forwardConnect(req, clientSocket, head, attempt + 1);
  });

  upstreamSocket.on('error', () => {
    handleRequestDone(target, true);
    forwardConnect(req, clientSocket, head, attempt + 1);
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
