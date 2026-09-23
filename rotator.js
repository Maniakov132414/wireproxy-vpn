const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIGS_DIR = path.join(__dirname, 'configs');

// Configuration
const MAX_ACTIVE_NODES = parseInt(process.env.MAX_ACTIVE || '7', 10);
const SHIFT_INTERVAL_MS = parseInt(process.env.SHIFT_INTERVAL_SEC || '180', 10) * 1000; // 3 minutes default
const ROTATOR_PORT = parseInt(process.env.ROTATOR_PORT || process.env.PORT || '10800', 10);
const BIND_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';
const PROXY_AUTH_USER = process.env.PROXY_USER || 'admin';
const PROXY_AUTH_PASS = process.env.PROXY_PASS || 'proxy123';
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';

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
        startedAt: 0,
        totalRequests: 0,
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
    node.startedAt = Date.now();
    node.failures = 0;
    node.active = true;

    child.on('error', (err) => {
      console.error(`[!] Failed to spawn ${node.name}: ${err.message}`);
      node.process = null;
      node.active = false;
    });

    child.on('exit', () => {
      node.process = null;
      node.active = false;
    });

    console.log(`[+] Started ${node.name.padEnd(14)} (HTTP: ${node.port} | SOCKS5: ${node.socksPort || 'N/A'})`);
  } catch (err) {
    console.error(`[!] Error launching ${node.name}: ${err.message}`);
  }
}

function stopNode(node) {
  if (!node.process) {
    node.active = false;
    return;
  }
  const proc = node.process;
  node.process = null;
  node.active = false;
  try {
    proc.kill('SIGTERM');
  } catch (e) {
    try { proc.kill('SIGKILL'); } catch (err) {}
  }
  console.log(`[-] Stopped ${node.name.padEnd(14)} (Shift resting / Cooldown)`);
}

function initPool() {
  ALL_NODES = parseConfigs();
  console.log(`==========================================================`);
  console.log(` Wireproxy Smart Dynamic Shift Rotator Running!`);
  console.log(` Total Configs:    ${ALL_NODES.length} servers`);
  console.log(` Max Active Nodes: ${MAX_ACTIVE_NODES} concurrent (safe under Proton 10-conn limit)`);
  console.log(` Shift Interval:   ${SHIFT_INTERVAL_MS / 1000}s (auto-rotates dormant servers in/out)`);
  console.log(` Binary Location:  ${WIREPROXY_BIN}`);
  console.log(`==========================================================\n`);

  const initialCount = Math.min(MAX_ACTIVE_NODES, ALL_NODES.length);
  for (let i = 0; i < initialCount; i++) {
    startNode(ALL_NODES[i]);
  }
}

function performShiftRotation() {
  const activeNodes = ALL_NODES.filter(n => n.process && n.active);
  const dormantNodes = ALL_NODES.filter(n => !n.process);

  if (dormantNodes.length === 0 || activeNodes.length === 0) {
    return;
  }

  // Oldest running node goes off-duty
  activeNodes.sort((a, b) => a.startedAt - b.startedAt);
  const retiringNode = activeNodes[0];
  const incomingNode = dormantNodes[0];

  console.log(`\n[Shift Rotation] Rotating: Bringing in ${incomingNode.name}, resting ${retiringNode.name}...`);

  // Start new node first
  startNode(incomingNode);

  // Wait 1.5s for WireGuard handshake before stopping the retired node
  setTimeout(() => {
    stopNode(retiringNode);

    // Push retiring node to the back of the queue
    const index = ALL_NODES.indexOf(retiringNode);
    if (index > -1) {
      ALL_NODES.splice(index, 1);
      ALL_NODES.push(retiringNode);
    }

    const currentActive = ALL_NODES.filter(n => n.process && n.active).length;
    console.log(`[Shift Rotation Done] Active: ${currentActive}/${ALL_NODES.length} nodes online.\n`);
  }, 1500);
}

function handleNodeFailure(failedNode) {
  failedNode.failures = (failedNode.failures || 0) + 1;

  if (failedNode.failures >= 2) {
    const dormantNodes = ALL_NODES.filter(n => !n.process);
    if (dormantNodes.length > 0) {
      const replacement = dormantNodes[0];
      console.warn(`[Auto-Healing] ${failedNode.name} had 2 errors. Immediate swap with ${replacement.name}...`);
      startNode(replacement);
      setTimeout(() => {
        stopNode(failedNode);
        const idx = ALL_NODES.indexOf(failedNode);
        if (idx > -1) {
          ALL_NODES.splice(idx, 1);
          ALL_NODES.push(failedNode);
        }
      }, 1500);
    } else {
      console.warn(`[Auto-Healing] ${failedNode.name} cooling down for 30s.`);
      failedNode.active = false;
      setTimeout(() => {
        failedNode.active = true;
        failedNode.failures = 0;
      }, 30000);
    }
  }
}

function getNextProxy() {
  const healthy = ALL_NODES.filter(p => p.process && p.active);
  if (healthy.length === 0) {
    const anyRunning = ALL_NODES.find(p => p.process);
    return anyRunning || ALL_NODES[0] || { host: '127.0.0.1', port: 25345, name: 'Fallback' };
  }
  const proxy = healthy[currentIndex % healthy.length];
  currentIndex = (currentIndex + 1) % healthy.length;
  proxy.totalRequests = (proxy.totalRequests || 0) + 1;
  return proxy;
}

function checkAuth(req) {
  if (!REQUIRE_AUTH) return true;
  const auth = req.headers['proxy-authorization'];
  if (!auth) return false;
  const [scheme, credentials] = auth.split(' ');
  if (scheme !== 'Basic' || !credentials) return false;
  const decoded = Buffer.from(credentials, 'base64').toString('ascii');
  const [user, pass] = decoded.split(':');
  return user === PROXY_AUTH_USER && pass === PROXY_AUTH_PASS;
}

const server = http.createServer((req, res) => {
  if (!checkAuth(req)) {
    res.writeHead(407, {
      'Proxy-Authenticate': 'Basic realm="Rotating Wireproxy"',
      'Content-Type': 'text/plain',
    });
    return res.end('Proxy Authentication Required');
  }

  forwardHttp(req, res, 0);
});

function forwardHttp(req, res, attempt) {
  const activeCount = ALL_NODES.filter(p => p.process && p.active).length;
  if (attempt >= Math.max(activeCount, 3)) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    return res.end('All active upstream proxies failed');
  }

  const target = getNextProxy();
  const options = {
    hostname: target.host,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: req.headers,
    timeout: 4000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    target.failures = 0;
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    handleNodeFailure(target);
    forwardHttp(req, res, attempt + 1);
  });

  proxyReq.on('error', () => {
    handleNodeFailure(target);
    forwardHttp(req, res, attempt + 1);
  });

  req.pipe(proxyReq);
}

server.on('connect', (req, clientSocket, head) => {
  if (!checkAuth(req)) {
    clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Rotating Wireproxy"\r\n\r\n');
    return clientSocket.end();
  }

  forwardConnect(req, clientSocket, head, 0);
});

function forwardConnect(req, clientSocket, head, attempt) {
  const activeCount = ALL_NODES.filter(p => p.process && p.active).length;
  if (attempt >= Math.max(activeCount, 3)) {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    return clientSocket.end();
  }

  const target = getNextProxy();
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
        handleNodeFailure(target);
        forwardConnect(req, clientSocket, head, attempt + 1);
      }
    });
  });

  upstreamSocket.setTimeout(4000);
  upstreamSocket.on('timeout', () => {
    upstreamSocket.destroy();
    handleNodeFailure(target);
    forwardConnect(req, clientSocket, head, attempt + 1);
  });

  upstreamSocket.on('error', () => {
    handleNodeFailure(target);
    forwardConnect(req, clientSocket, head, attempt + 1);
  });

  clientSocket.on('error', () => upstreamSocket.end());
}

server.listen(ROTATOR_PORT, BIND_ADDRESS, () => {
  initPool();
  console.log(`==========================================================`);
  console.log(` Master Rotating Proxy listening at http://${BIND_ADDRESS}:${ROTATOR_PORT}`);
  console.log(` Authentication:  ${REQUIRE_AUTH ? `Enabled (User: ${PROXY_AUTH_USER})` : 'Disabled (Open)'}`);
  console.log(`==========================================================\n`);

  setInterval(performShiftRotation, SHIFT_INTERVAL_MS);
});

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
          console.log(`[Config Discovery] Registered ${newlyAdded.name} into dormant queue.`);
          const activeCount = ALL_NODES.filter(n => n.process && n.active).length;
          if (activeCount < MAX_ACTIVE_NODES) {
            startNode(newlyAdded);
          }
        }
      }
    }
  });
}

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
