import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import ipaddr from 'ipaddr.js';
import fetch from 'node-fetch';
import fetchCookie from 'fetch-cookie';
import tough from 'tough-cookie';
import https from 'https';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));

// UniFi credentials and URL
const baseUrl = 'https://unifi.nexuswifi.com:8443';
const username = 'admin';
const password = 'rj1teqptmgmt25!'; // For production, use env vars

// Handle self-signed SSL cert
const agent = new https.Agent({ rejectUnauthorized: false });
const cookieJar = new tough.CookieJar();
const fetchWithCookies = fetchCookie(fetch, cookieJar);

// IP filtering
const allowedRanges = [
  { cidr: '216.196.237.57/29' },
  { ip: '71.66.161.195' },
  { ip: '127.0.0.1' },
  { ip: '::1' },
  { ip: '35.160.204.44' } // Render health check
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

// Login to UniFi Controller
async function login() {
  const res = await fetchWithCookies(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    agent
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[Login Error] ${res.status}: ${text}`);
    throw new Error(`Login failed: ${res.statusText}`);
  }
}

// Fetch all sites
async function getSites() {
  const res = await fetchWithCookies(`${baseUrl}/api/self/sites`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    agent
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[Get Sites Error] ${res.status}: ${text}`);
    throw new Error('Failed to fetch sites');
  }

  const json = await res.json();
  return json.data;
}

// Board Revision Lookup
app.post('/board-revision', async (req, res) => {
  const { site } = req.body;
  if (!site) return res.json({ error: '❌ Site description required.' });

  try {
    await login();
    const sites = await getSites();
    const matchedSite = sites.find(s => s.desc?.toLowerCase() === site.toLowerCase());

    if (!matchedSite) {
      return res.json({ error: `❌ Site not found: ${site}` });
    }

    const devicesRes = await fetchWithCookies(`${baseUrl}/api/s/${matchedSite.name}/stat/device`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      agent
    });

    const json = await devicesRes.json();
    const results = json.data.map(d => {
      const name = d.name || 'Unknown';
      const rev = d.board_rev || 'N/A';
      return `${name} - Board Revision: ${rev}`;
    }).sort();

    return res.json({ results });
  } catch (err) {
    console.error('[Board Revision Error]', err);
    return res.status(500).json({ error: '❌ Internal server error' });
  }
});

// MAC Lookup endpoint
app.post('/mac-lookup', async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.json({ error: '❌ MAC address required.' });

  try {
    await login();
    const sites = await getSites();

    let foundSite = null;
    const inputMac = mac.toLowerCase().replace(/[:-]/g, '');

    for (const site of sites) {
      const deviceRes = await fetchWithCookies(`${baseUrl}/api/s/${site.name}/stat/device`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await deviceRes.json();

      for (const d of json.data) {
        const deviceMac = d.mac?.toLowerCase().replace(/[:-]/g, '');
        if (deviceMac === inputMac) {
          foundSite = site.desc;
          break;
        }
      }

      if (foundSite) break;
    }

    if (foundSite) {
      res.json({ site: foundSite });
    } else {
      res.json({ error: '❌ MAC address not found on any site.' });
    }

  } catch (err) {
    console.error('[MAC Lookup Error]', err.message);
    res.status(500).json({ error: '❌ Internal server error' });
  }
});


// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
