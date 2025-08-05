import express from 'express';
import fetch from 'node-fetch';
import ipaddr from 'ipaddr.js';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 10000;

// ─────────────────────────────────────────────────────────────
// HARDCODED UNIFI CONTROLLER INFO
const UNIFI_URL = 'https://unifi.nexuswifi.com:8443';
const UNIFI_USERNAME = 'admin';
const UNIFI_PASSWORD = 'rj1teqptmgmt25!';

// ─────────────────────────────────────────────────────────────
// IP FILTERING
const allowedRanges = [
  { cidr: '216.196.237.57/29' },
  { ip: '71.66.161.195' },
  { ip: '35.160.3.103' } // Render health check
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

// ─────────────────────────────────────────────────────────────
// STATIC FILES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// LOGIN FUNCTION
async function loginToController() {
  const response = await fetch(`${UNIFI_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: UNIFI_USERNAME,
      password: UNIFI_PASSWORD
    }),
    agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
  });

  if (!response.ok) throw new Error('Failed to login to UniFi controller');

  return response.headers.get('set-cookie');
}

// ─────────────────────────────────────────────────────────────
// BOARD REVISION ENDPOINT
app.post('/board-revision', async (req, res) => {
  try {
    const siteDesc = req.body.site?.trim();
    if (!siteDesc) return res.status(400).json({ error: 'Missing site description.' });

    const cookies = await loginToController();

    const sitesRes = await fetch(`${UNIFI_URL}/api/self/sites`, {
      headers: { Cookie: cookies },
      agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
    });

    const { data: sites } = await sitesRes.json();
    const targetSite = sites.find(site => site.desc === siteDesc);
    if (!targetSite) return res.status(404).json({ error: 'Site not found' });

    const devicesRes = await fetch(`${UNIFI_URL}/api/s/${targetSite.name}/stat/device`, {
      headers: { Cookie: cookies },
      agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
    });

    const { data: devices } = await devicesRes.json();
    const result = devices.map(d => ({
      name: d.name || 'Unknown',
      board_rev: d.board_rev || 'N/A'
    }));

    res.json(result.sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// MAC ADDRESS LOOKUP ENDPOINT
app.post('/mac-lookup', async (req, res) => {
  try {
    const targetMac = req.body.mac?.toLowerCase();
    if (!targetMac) return res.status(400).json({ error: 'Missing MAC address.' });

    const cookies = await loginToController();

    const sitesRes = await fetch(`${UNIFI_URL}/api/self/sites`, {
      headers: { Cookie: cookies },
      agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
    });

    const { data: sites } = await sitesRes.json();

    const results = [];
    const batches = [];
    const batchSize = 10;

    for (let i = 0; i < sites.length; i += batchSize) {
      batches.push(sites.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      const promises = batch.map(site =>
        fetch(`${UNIFI_URL}/api/s/${site.name}/stat/device`, {
          headers: { Cookie: cookies },
          agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
        })
          .then(r => r.json())
          .then(json => {
            const match = json.data.find(d => d.mac.toLowerCase() === targetMac);
            if (match) results.push({ site: site.desc });
          })
      );

      await Promise.allSettled(promises);
    }

    res.json({ results, totalSites: sites.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// START SERVER
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
