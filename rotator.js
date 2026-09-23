const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIGS_DIR = path.join(__dirname, 'configs');

// Configuration
// Pool buffer size: number of warm, ready-to-serve WireGuard instances running at once
const POOL_BUFFER_SIZE = parseInt(process.env.POOL_SIZE || '5', 10);
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

  // Find next dormant node from the queue
  const dormantNodes = ALL_NODES.filter(n => !n.process);
  if (dormantNodes.length > 0) {
    const nextNode = dormantNodes[0];
    console.log(`\n[Auto-Rotate] ${usedNode.name} finished task. Launching fresh ${nextNode.name}...`);
    startNode(nextNode);

    // Stop the used node
    stopNode(usedNode);

    // Push the used node to the very end of the queue for next cycles
    const idx = ALL_NODES.indexOf(usedNode);
    if (idx > -1) {
      ALL_NODES.splice(idx, 1);
      ALL_NODES.push(usedNode);
    }
  } else {
    // If no dormant nodes (all nodes are active), just reset
    usedNode.markedForRetire = false;
  }
}

function initPool() {
  ALL_NODES = parseConfigs();
  console.log(`==========================================================`);
  console.log(` Wireproxy Ephemeral Rotating Proxy (One-Shot Per-Server)`);
  console.log(` Total Configs:    ${ALL_NODES.length} servers`);
  console.log(` Warm Buffer:      ${POOL_BUFFER_SIZE} servers pre-warmed & ready`);
  console.log(` Authentication:   None (Public / Open for Bot)`);
  console.log(` Rotation Rule:    After a server serves a request, it shuts down`);
  console.log(`                   and the next fresh country server launches!`);
  console.log(`==========================================================\n`);

  const initialCount = Math.min(POOL_BUFFER_SIZE, ALL_NODES.length);
  for (let i = 0; i < initialCount; i++) {
    startNode(ALL_NODES[i]);
  }
}

// Pick the next available healthy active proxy
function getNextProxy() {
  const healthy = ALL_NODES.filter(p => p.process && p.active && !p.markedForRetire);
  if (healthy.length === 0) {
    // Fallback to any running node
    const anyRunning = ALL_NODES.find(p => p.process && p.active);
    return anyRunning || ALL_NODES[0] || { host: '127.0.0.1', port: 25345, name: 'Fallback' };
  }
  const proxy = healthy[currentIndex % healthy.length];
  currentIndex = (currentIndex + 1) % healthy.length;
  return proxy;
}

// HTTP Proxy Handler (No Auth Required)
const server = http.createServer((req, res) => {
  forwardHttp(req, res, 0);
});

function forwardHttp(req, res, attempt) {
  const activeCount = ALL_NODES.filter(p => p.process && p.active).length;
  if (attempt >= Math.max(activeCount, 3)) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    return res.end('All active upstream proxies failed');
  }

  const target = getNextProxy();
  target.inFlight = (target.inFlight || 0) + 1;
  target.servingCount = (target.servingCount || 0) + 1;

  const options = {
    hostname: target.host,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: req.headers,
    timeout: 5000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    target.failures = 0;
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);

    res.on('finish', () => {
      target.inFlight = Math.max(0, (target.inFlight || 1) - 1);
      // Once request is done, retire this server and bring in a brand new one!
      retireAndRotateNode(target);
    });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    target.inFlight = Math.max(0, (target.inFlight || 1) - 1);
    target.failures = (target.failures || 0) + 1;
    retireAndRotateNode(target);
    forwardHttp(req, res, attempt + 1);
  });

  proxyReq.on('error', () => {
    target.inFlight = Math.max(0, (target.inFlight || 1) - 1);
    target.failures = (target.failures || 0) + 1;
    retireAndRotateNode(target);
    forwardHttp(req, res, attempt + 1);
  });

  req.pipe(proxyReq);
}

// HTTPS CONNECT Tunnel Handler (No Auth Required)
server.on('connect', (req, clientSocket, head) => {
  forwardConnect(req, clientSocket, head, 0);
});

function forwardConnect(req, clientSocket, head, attempt) {
  const activeCount = ALL_NODES.filter(p => p.process && p.active).length;
  if (attempt >= Math.max(activeCount, 3)) {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    return clientSocket.end();
  }

  const target = getNextProxy();
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
        target.inFlight = Math.max(0, (target.inFlight || 1) - 1);
        retireAndRotateNode(target);
        forwardConnect(req, clientSocket, head, attempt + 1);
      }
    });
  });

  function onConnectDone() {
    target.inFlight = Math.max(0, (target.inFlight || 1) - 1);
    retireAndRotateNode(target);
  }

  clientSocket.once('close', onConnectDone);
  upstreamSocket.once('close', onConnectDone);

  upstreamSocket.setTimeout(5000);
  upstreamSocket.on('timeout', () => {
    upstreamSocket.destroy();
    target.inFlight = Math.max(0, (target.inFlight || 1) - 1);
    target.failures = (target.failures || 0) + 1;
    retireAndRotateNode(target);
    forwardConnect(req, clientSocket, head, attempt + 1);
  });

  upstreamSocket.on('error', () => {
    target.inFlight = Math.max(0, (target.inFlight || 1) - 1);
    target.failures = (target.failures || 0) + 1;
    retireAndRotateNode(target);
    forwardConnect(req, clientSocket, head, attempt + 1);
  });
}

// Background idle sweeper: If system is idle for 60s, swap the oldest node anyway to keep IPs fresh
setInterval(() => {
  const activeNodes = ALL_NODES.filter(n => n.process && n.active && n.inFlight === 0);
  const dormantNodes = ALL_NODES.filter(n => !n.process);
  if (activeNodes.length > 0 && dormantNodes.length > 0) {
    retireAndRotateNode(activeNodes[0]);
  }
}, 60000);

server.listen(ROTATOR_PORT, BIND_ADDRESS, () => {
  initPool();
  console.log(` Master Rotating Proxy listening at http://${BIND_ADDRESS}:${ROTATOR_PORT} (NO AUTH REQUIRED)\n`);
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
