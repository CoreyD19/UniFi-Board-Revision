import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import ipaddr from 'ipaddr.js';
import https from 'https';
import cors from 'cors';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const app = express();
app.use(cors());
app.use(express.json());

// Paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ IP Filtering - BEFORE routes
const allowedRanges = [
  { cidr: '216.196.237.57/29' },
  { ip: '71.66.161.195' },
  { ip: '66.228.53.233' }
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

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// UniFi credentials and agent (used only for /board-revision)
const baseUrl = 'https://unifi.nexuswifi.com:8443';
const username = 'admin';
const password = 'rj1teqptmgmt25!';
const agent = new https.Agent({ rejectUnauthorized: false });

// --- Helper functions for UniFi API login ---
import fetch from 'node-fetch';
import fetchCookie from 'fetch-cookie';
import tough from 'tough-cookie';

const cookieJar = new tough.CookieJar();
const fetchWithCookies = fetchCookie(fetch, cookieJar, { agent });

async function login() {
  const response = await fetchWithCookies(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    agent,
  });
  if (!response.ok) {
    throw new Error(`Login failed: ${response.statusText}`);
  }
}

async function getSites() {
  const res = await fetchWithCookies(`${baseUrl}/api/self/sites`, { agent });
  const json = await res.json();
  return json.data;
}

// ✅ BOARD REVISION ENDPOINT (unchanged)
app.post('/board-revision', async (req, res) => {
  const { site } = req.body;
  if (!site) return res.json({ error: '❌ Site description required.' });

  try {
    await login();
    const sites = await getSites();
    const matchedSite = sites.find(s => s.desc?.toLowerCase() === site.toLowerCase());
    if (!matchedSite) return res.json({ error: `❌ Site not found: ${site}` });

    const deviceRes = await fetchWithCookies(`${baseUrl}/api/s/${matchedSite.name}/stat/device`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      agent
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

// ⚡️ DB-backed MAC LOOKUP endpoint
app.post('/mac-lookup', async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.json({ error: '❌ MAC address required.' });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const db = await open({
      filename: './devices.db',
      driver: sqlite3.Database
    });

    const macLower = mac.toLowerCase();

    // Query the DB for the MAC address
    const device = await db.get(
      'SELECT mac, name, site, board_rev FROM devices WHERE mac = ?',
      macLower
    );

    if (device) {
      // Device found
      res.write(`FOUND ${device.site} || ${device.name}\n`);
    } else {
      // Not found
      res.write('NOT_FOUND\n');
    }
    res.end();
    await db.close();
  } catch (err) {
    console.error('[MAC Lookup Error]', err.message);
    if (!res.headersSent) {
      res.status(500).send('❌ Internal server error');
    }
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
