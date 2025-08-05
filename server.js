import express from 'express';
import fetch from 'node-fetch';
import ipaddr from 'ipaddr.js';
import https from 'https';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

const baseUrl = 'https://unifi.nexuswifi.com:8443';
const username = 'admin';
const password = 'rj1teqptmgmt25!'; // Replace with env vars for production

// IP filtering setup
const allowedRanges = [
  { cidr: '216.196.237.57/29' },
  { ip: '71.66.161.195' },
  { ip: '127.0.0.1' }, // local dev
  { ip: '::1' },       // IPv6 localhost
  { ip: '35.160.204.44' }, // Render health check IP (example)
];

function isAllowedIp(ip) {
  if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
  try {
    const addr = ipaddr.parse(ip);
    return allowedRanges.some(rule => {
      if (rule.ip) return addr.toString() === rule.ip;
      if (rule.cidr) return addr.match(ipaddr.parseCIDR(rule.cidr));
      return false;
    });
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  if (!isAllowedIp(clientIp)) {
    console.warn(`Blocked IP: ${clientIp}`);
    return res.status(403).send('Access Denied');
  }
  next();
});

// Login function to UniFi controller
async function login() {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    agent: new https.Agent({ rejectUnauthorized: false })
  });

  if (!response.ok) {
    throw new Error(`Login failed: ${response.statusText}`);
  }

  const cookies = response.headers.get('set-cookie');
  return cookies;
}

// Get all sites
async function getSites(cookies) {
  const res = await fetch(`${baseUrl}/api/self/sites`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookies
    },
    agent: new https.Agent({ rejectUnauthorized: false })
  });

  const json = await res.json();
  return json.data;
}

// Board Revision endpoint
app.post('/board-revision', async (req, res) => {
  const { site } = req.body;
  if (!site) return res.json({ error: '❌ Site description required.' });

  try {
    const cookies = await login();
    const sites = await getSites(cookies);

    const matchedSite = sites.find(s => s.desc?.toLowerCase() === site.toLowerCase());
    if (!matchedSite) return res.json({ error: `❌ Site not found: ${site}` });

    const deviceRes = await fetch(`${baseUrl}/api/s/${matchedSite.name}/stat/device`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies
      },
      agent: new https.Agent({ rejectUnauthorized: false })
    });

    const json = await deviceRes.json();
    const result = json.data.map(d => {
      const name = d.name || 'Unknown';
      const rev = d.board_rev || 'N/A';
      return `${name} - Board Revision: ${rev}`;
    }).sort();

    res.json({ results: result });
  } catch (err) {
    console.error('[Board Revision Error]', err.message);
    res.status(500).json({ error: '❌ Internal server error' });
  }
});

// Add your MAC Lookup endpoint here if you have one

// Serve index.html on root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
