const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIGS_DIR = path.join(__dirname, 'configs');

function getConfigs() {
  const files = fs.readdirSync(CONFIGS_DIR).filter(f => f.endsWith('.conf'));
  const configs = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(CONFIGS_DIR, file), 'utf8');
    const m = content.match(/\[http\][\s\S]*?BindAddress\s*=\s*[\w\.:]+:(\d+)/i);
    if (m) {
      configs.push({
        file,
        name: file.replace(/^wireproxy-|\.conf$/g, '').toUpperCase(),
        port: parseInt(m[1], 10),
      });
    }
  }
  return configs.sort((a, b) => a.port - b.port);
}

function testProxy(node) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = http.request({
      host: '127.0.0.1',
      port: node.port,
      method: 'GET',
      path: 'http://ip-api.com/json',
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;
        try {
          const json = JSON.parse(data);
          resolve({
            name: node.name,
            port: node.port,
            status: 'ONLINE',
            ip: json.query || 'N/A',
            country: json.countryCode || json.country || 'N/A',
            city: json.city || 'N/A',
            isp: json.isp || json.org || 'N/A',
            ping: `${duration}ms`,
          });
        } catch (e) {
          resolve({
            name: node.name,
            port: node.port,
            status: 'ERROR',
            ip: 'JSON Error',
            country: '-',
            city: '-',
            isp: '-',
            ping: `${duration}ms`,
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        name: node.name,
        port: node.port,
        status: 'TIMEOUT',
        ip: 'Handshake/Off',
        country: '-',
        city: '-',
        isp: '-',
        ping: `${Date.now() - startTime}ms`,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        name: node.name,
        port: node.port,
        status: 'TIMEOUT',
        ip: 'Timeout (5s)',
        country: '-',
        city: '-',
        isp: '-',
        ping: '>5000ms',
      });
    });

    req.end();
  });
}

async function run() {
  const configs = getConfigs();
  console.log(`\nTesting all ${configs.length} Proxy Nodes simultaneously...\n`);
  const results = await Promise.all(configs.map(testProxy));

  console.table(results);

  const online = results.filter(r => r.status === 'ONLINE');
  const uniqueIPs = new Set(online.map(r => r.ip));

  console.log('='.repeat(60));
  console.log(`Total Configured Nodes: ${configs.length}`);
  console.log(`Active / Online Nodes:  ${online.length} / ${configs.length}`);
  console.log(`Unique Public Egress IPs: ${uniqueIPs.size}`);
  console.log('='.repeat(60));
  console.log('Unique IPs list:');
  Array.from(uniqueIPs).forEach((ip, idx) => {
    const match = online.find(o => o.ip === ip);
    console.log(`  ${idx + 1}. ${ip.padEnd(16)} | ${match.country} (${match.city}) | ${match.isp}`);
  });
}

run();
