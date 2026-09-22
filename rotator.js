const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const CONFIGS_DIR = path.join(__dirname, 'configs');

// Function to auto-discover proxy configs from configs/*.conf
function loadProxiesFromConfigs() {
  const proxies = [];
  if (!fs.existsSync(CONFIGS_DIR)) return proxies;

  const files = fs.readdirSync(CONFIGS_DIR).filter(f => f.endsWith('.conf'));
  for (const file of files) {
    const filePath = path.join(CONFIGS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Parse HTTP bind port
    const httpMatch = content.match(/\[http\][\s\S]*?BindAddress\s*=\s*[\w\.:]+:(\d+)/i);
    const socksMatch = content.match(/\[Socks5\][\s\S]*?BindAddress\s*=\s*[\w\.:]+:(\d+)/i);

    if (httpMatch) {
      const port = parseInt(httpMatch[1], 10);
      const name = path.basename(file, '.conf').replace(/^wireproxy-/, '').toUpperCase();
      proxies.push({
        name: `Node ${name}`,
        file,
        host: '127.0.0.1',
        port,
        socksPort: socksMatch ? parseInt(socksMatch[1], 10) : null,
        active: true,
      });
    }
  }
  return proxies;
}

let PROXIES = loadProxiesFromConfigs();

// Auto-reload configs when files are added, modified, or removed
if (fs.existsSync(CONFIGS_DIR)) {
  let reloadTimeout = null;
  fs.watch(CONFIGS_DIR, (eventType, filename) => {
    if (filename && filename.endsWith('.conf')) {
      clearTimeout(reloadTimeout);
      reloadTimeout = setTimeout(() => {
        const updated = loadProxiesFromConfigs();
        if (updated.length > 0) {
          PROXIES = updated;
          console.log(`[Config Auto-Reload] Discovered ${PROXIES.length} proxy configurations in configs/`);
        }
      }, 500);
    }
  });
}

// Optional Authentication for Public Expose
const PROXY_AUTH_USER = process.env.PROXY_USER || 'admin';
const PROXY_AUTH_PASS = process.env.PROXY_PASS || 'proxy123';
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';

let currentIndex = 0;
function getNextProxy() {
  const healthy = PROXIES.filter(p => p.active);
  if (healthy.length === 0) return PROXIES[0] || { host: '127.0.0.1', port: 25345, name: 'Default' };
  const proxy = healthy[currentIndex % healthy.length];
  currentIndex = (currentIndex + 1) % healthy.length;
  return proxy;
}

const ROTATOR_PORT = parseInt(process.env.ROTATOR_PORT || process.env.PORT || '10800', 10);
const BIND_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';

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

// 1. Plain HTTP Proxy Handler with auto-failover
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
  if (attempt >= PROXIES.length) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    return res.end('All upstream proxies failed');
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
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    target.active = false;
    setTimeout(() => { target.active = true; }, 30000);
    forwardHttp(req, res, attempt + 1);
  });

  proxyReq.on('error', () => {
    target.active = false;
    setTimeout(() => { target.active = true; }, 30000);
    forwardHttp(req, res, attempt + 1);
  });

  req.pipe(proxyReq);
}

// 2. HTTPS CONNECT Tunnel Handler with auto-failover
server.on('connect', (req, clientSocket, head) => {
  if (!checkAuth(req)) {
    clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Rotating Wireproxy"\r\n\r\n');
    return clientSocket.end();
  }

  forwardConnect(req, clientSocket, head, 0);
});

function forwardConnect(req, clientSocket, head, attempt) {
  if (attempt >= PROXIES.length) {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    return clientSocket.end();
  }

  const target = getNextProxy();
  const upstreamSocket = net.connect(target.port, target.host, () => {
    upstreamSocket.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n\r\n`);

    upstreamSocket.once('data', (data) => {
      if (data.toString().includes('200')) {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) upstreamSocket.write(head);
        clientSocket.pipe(upstreamSocket);
        upstreamSocket.pipe(clientSocket);
      } else {
        forwardConnect(req, clientSocket, head, attempt + 1);
      }
    });
  });

  upstreamSocket.setTimeout(4000);
  upstreamSocket.on('timeout', () => {
    upstreamSocket.destroy();
    target.active = false;
    setTimeout(() => { target.active = true; }, 30000);
    forwardConnect(req, clientSocket, head, attempt + 1);
  });

  upstreamSocket.on('error', () => {
    target.active = false;
    setTimeout(() => { target.active = true; }, 30000);
    forwardConnect(req, clientSocket, head, attempt + 1);
  });

  clientSocket.on('error', () => upstreamSocket.end());
}

server.listen(ROTATOR_PORT, BIND_ADDRESS, () => {
  console.log(`==========================================================`);
  console.log(` Dynamic Rotating Proxy Pool Running!`);
  console.log(` Master Proxy Address: http://${BIND_ADDRESS}:${ROTATOR_PORT}`);
  console.log(` Auto-discovered ${PROXIES.length} server nodes from configs/:`);
  PROXIES.forEach(p => console.log(`   - ${p.name.padEnd(16)}: HTTP port ${p.port} | SOCKS5 port ${p.socksPort || 'N/A'}`));
  console.log(` Authentication: ${REQUIRE_AUTH ? 'Enabled (user: ' + PROXY_AUTH_USER + ')' : 'Disabled (Open)'}`);
  console.log(`==========================================================`);
});
