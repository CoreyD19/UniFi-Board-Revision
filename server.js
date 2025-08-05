import express from 'express';
import bodyParser from 'body-parser';
import https from 'https';
import ipaddr from 'ipaddr.js';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 10000;

// Serve static files (logo, css, html, etc.)
app.use(express.static('public'));
app.use(bodyParser.json());

// --- 🔒 IP Filtering Middleware ---
const allowedRanges = [
  { cidr: '216.196.237.57/29' },
  { ip: '71.66.161.195' },
  { ip: '35.160.177.10' },     // Render health check IP
  { ip: '34.211.20.157' }      // Render health check IP
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

// --- 🔐 Hardcoded Credentials for Testing (Use env vars in production) ---
const CONTROLLER_URL = 'https://unifi.nexuswifi.com:8443';
const USERNAME = 'admin';
const PASSWORD = 'rj1teqptmgmt25!';

// --- 🔁 Login and return a session cookie
async function login() {
  const response = await fetch(`${CONTROLLER_URL}/api/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    agent: new https.Agent({ rejectUnauthorized: false })
  });

  if (!response.ok) throw new Error('Login failed');
  const cookie = response.headers.get('set-cookie');
  return cookie;
}

// --- 📦 GET sites list
async function getSites(cookie) {
  const response = await fetch(`${CONTROLLER_URL}/api/self/sites`, {
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie
    },
    agent: new https.Agent({ rejectUnauthorized: false })
  });

  if (!response.ok) throw new Error('Failed to fetch sites');
  const json = await response.json();
  return json.data;
}

// --- 🔎 Endpoint for Board Revision
app.post('/board-revision', async (req, res) => {
  try {
    const siteDesc = req.body.site?.trim();
    if (!siteDesc) return res.status(400).json({ error: 'Site description required' });

    const cookie = await login();
    const sites = await getSites(cookie);
    const site = sites.find(s => s.desc === siteDesc);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const devicesUrl = `${CONTROLLER_URL}/api/s/${site.name}/stat/device`;
    const devicesResp = await fetch(devicesUrl, {
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      agent: new https.Agent({ rejectUnauthorized: false })
    });

    const devicesData = await devicesResp.json();
    const deviceList = devicesData.data.map(device => {
      const name = device.name || 'Unknown';
      const boardRev = device.board_rev || 'N/A';
      return `${name} - Board Revision: ${boardRev}`;
    });

    res.json({ results: deviceList.sort() });
  } catch (err) {
    console.error('Board Revision Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- 🔎 Endpoint for MAC Lookup
app.post('/mac-lookup', async (req, res) => {
  try {
    const inputMac = req.body.mac?.toLowerCase().replace(/[^a-f0-9:]/gi, '');
    if (!inputMac) return res.status(400).json({ error: 'MAC address required' });

    const cookie = await login();
    const sites = await getSites(cookie);

    const foundSite = await searchSitesForMac(sites, cookie, inputMac, res);
    if (foundSite) {
      res.json({ site: foundSite });
    } else {
      res.json({ site: null });
    }
  } catch (err) {
    console.error('MAC Lookup Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- 🔁 Search function with live progress (optional for socket.io, basic version here)
async function searchSitesForMac(sites, cookie, targetMac, res) {
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const url = `${CONTROLLER_URL}/api/s/${site.name}/stat/device`;

    const resp = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      agent: new https.Agent({ rejectUnauthorized: false })
    });

    const data = await resp.json();
    const match = data.data.find(device => device.mac?.toLowerCase() === targetMac);
    if (match) return site.desc;
  }

  return null;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
