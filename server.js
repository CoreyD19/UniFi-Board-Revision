import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import ipaddr from 'ipaddr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

// Middleware to parse JSON
app.use(express.json());

// --- 🔐 IP Restriction Middleware ---
const allowedRanges = [
  { cidr: '216.196.237.57/29' }, // CIDR range (8 IPs)
  { ip: '71.66.161.195' }        // Single IP
];

function isAllowedIp(ip) {
  // Normalize IPv6-wrapped IPv4 addresses (e.g. ::ffff:1.2.3.4)
  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }

  try {
    const addr = ipaddr.parse(ip);
    return allowedRanges.some(rule => {
      if (rule.ip) {
        return addr.toString() === rule.ip;
      } else if (rule.cidr) {
        const range = ipaddr.parseCIDR(rule.cidr);
        return addr.match(range);
      }
      return false;
    });
  } catch (e) {
    return false;
  }
}

app.use((req, res, next) => {
  const clientIp =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket.remoteAddress;

  if (!isAllowedIp(clientIp)) {
    console.warn(`Blocked IP: ${clientIp}`);
    return res.status(403).send('Access Denied');
  }

  next();
});

// --- Static Frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// --- POST Endpoint ---
app.post('/get-devices', async (req, res) => {
  try {
    const siteDesc = req.body.site_desc?.trim();
    if (!siteDesc) {
      return res.status(400).json({ error: 'Missing site description.' });
    }

    const base_url = 'https://unifi.nexuswifi.com:8443';
    const login_url = `${base_url}/api/auth/login`;
    const username = process.env.UNIFI_USERNAME;
    const password = process.env.UNIFI_PASSWORD;

    const session = await fetch(login_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
    });

    if (!session.ok) {
      return res.status(401).json({ error: 'Login failed' });
    }

    const cookie = session.headers.get('set-cookie');

    const siteListRes = await fetch(`${base_url}/api/self/sites`, {
      headers: { Cookie: cookie },
      agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
    });

    const sites = (await siteListRes.json()).data;
    const matching = sites.find(site => site.desc === siteDesc);

    if (!matching) {
      return res.status(404).json({ error: 'Site not found.' });
    }

    const devicesRes = await fetch(`${base_url}/api/s/${matching.name}/stat/device`, {
      headers: { Cookie: cookie },
      agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
    });

    const devices = (await devicesRes.json()).data;
    const output = devices.map(d => {
      const name = d.name || 'Unknown';
      const board = d.board_rev || 'N/A';
      return `${name} - Board Revision: ${board}`;
    });

    return res.json(output.sort());
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
