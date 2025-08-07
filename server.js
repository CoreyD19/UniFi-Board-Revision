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

app.use(express.static(path.join(__dirname, 'public')));

// MAC Lookup Endpoint (Parallel Search)
app.post('/mac-lookup', async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.status(400).json({ error: 'MAC address required' });

  const base_url = 'https://unifi.nexuswifi.com:8443';
  const username = process.env.UNIFI_USERNAME;
  const password = process.env.UNIFI_PASSWORD;

  const login_url = `${base_url}/api/login`;

  const agent = new (await import('https')).Agent({ rejectUnauthorized: false });

  try {
    const loginRes = await fetchWithCookies(login_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      agent
    });

    const loginData = await loginRes.json();
    if (loginData?.meta?.rc !== 'ok') {
      return res.status(401).json({ error: 'Login failed' });
    }

    const sitesRes = await fetchWithCookies(`${base_url}/api/self/sites`, { agent });
    const sites = (await sitesRes.json()).data;
    const siteCount = sites.length;
    let checked = 0;
    let found = false;
    const startTime = Date.now();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    function sendUpdate(site, deviceName) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = found ? 0 : Math.max(0, Math.floor((elapsed / checked) * (siteCount - checked)));
      const percent = Math.round((checked / siteCount) * 100);
      const elapsedMinSec = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
      const remainingMinSec = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

      res.write(`data: ${JSON.stringify({
        checked,
        total: siteCount,
        percent,
        elapsed: elapsedMinSec,
        remaining: remainingMinSec,
        site,
        deviceName,
        found
      })}\n\n`);
    }

    const searchSites = async (siteList) => {
      for (const site of siteList) {
        if (found) break;
        const devicesRes = await fetchWithCookies(`${base_url}/api/s/${site.name}/stat/device`, { agent });
        const devices = (await devicesRes.json()).data;
        checked++;

        const match = devices.find(d => d.mac?.toLowerCase() === mac.toLowerCase());
        if (match) {
          found = true;
          sendUpdate(site.desc, match.name || 'Unknown');
          break;
        } else {
          sendUpdate(null, null);
        }
      }
    };

    const midpoint = Math.floor(siteCount / 2);
    const firstHalf = sites.slice(0, midpoint);
    const secondHalf = sites.slice().reverse().slice(0, siteCount - midpoint);

    await Promise.all([
      searchSites(firstHalf),
      searchSites(secondHalf)
    ]);

    res.end();
  } catch (err) {
    console.error('MAC Lookup error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
