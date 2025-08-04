import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import ipaddr from 'ipaddr.js';

import fetch from 'node-fetch';
import fetchCookie from 'fetch-cookie';
import tough from 'tough-cookie';

const cookieJar = new tough.CookieJar();
const fetchWithCookies = fetchCookie(fetch, cookieJar);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());

// IP filtering
const allowedRanges = [
  { cidr: '216.196.237.57/29' },
  { ip: '71.66.161.195' }
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

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// Device API
app.post('/get-devices', async (req, res) => {
  try {
    const siteDesc = req.body.site_desc?.trim();
    if (!siteDesc) return res.status(400).json({ error: 'Missing site description' });

    const base_url = 'https://unifi.nexuswifi.com:8443';
    const login_url = `${base_url}/api/login`;
    const username = admin;
    const password = rj1teqptmgmt25!;

    // Login
    const loginRes = await fetchWithCookies(login_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
    });

    const loginBody = await loginRes.json();
    if (loginBody?.meta?.rc !== 'ok') {
      console.error('Login failed:', loginBody);
      return res.status(401).json({ error: 'Login failed' });
    }

    // Get sites
    const sitesRes = await fetchWithCookies(`${base_url}/api/self/sites`, {
      agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
    });

    const sites = (await sitesRes.json()).data;
    const site = sites.find(s => s.desc === siteDesc);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    // Get devices
    const devicesRes = await fetchWithCookies(`${base_url}/api/s/${site.name}/stat/device`, {
      agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
    });

    const devices = (await devicesRes.json()).data;
    const output = devices.map(d => `${d.name || 'Unknown'} - Board Revision: ${d.board_rev || 'N/A'}`);

    res.json(output.sort());
  } catch (err) {
    console.error('Error in /get-devices:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
