import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import ipaddr from 'ipaddr.js';
import https from 'https';

const app = express();
const port = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(express.static('public'));

// ======== IP Filtering =========
const allowedRanges = [
  { cidr: '216.196.237.57/29' },
  { ip: '71.66.161.195' },
  { ip: '35.160.199.141' } // Render health check IP
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

// ======== Constants =========
const baseUrl = 'https://unifi.nexuswifi.com:8443';
const username = 'admin';
const password = 'rj1teqptmgmt25!';

// ======== Login Function =========
async function login() {
  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    headers: { 'Content-Type': 'application/json' },
    agent: new https.Agent({ rejectUnauthorized: false })
  });

  if (!loginResponse.ok) throw new Error('Login failed');

  const cookies = loginResponse.headers.get('set-cookie');
  return cookies;
}

// ======== GET Sites =========
async function getSites(cookies) {
  const response = await fetch(`${baseUrl}/api/self/sites`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookies
    },
    agent: new https.Agent({ rejectUnauthorized: false })
  });

  const data = await response.json();
  return data.data;
}

// ======== Board Revision Endpoint =========
app.post('/board-revision', async (req, res) => {
  const { site } = req.body;
  if (!site) return res.json({ error: 'Site description required.' });

  try {
    const cookies = await login();
    const sites = await getSites(cookies);

    const siteObj = sites.find(s => s.desc?.toLowerCase() === site.toLowerCase());
    if (!siteObj) return res.json({ error: `Site not found: ${site}` });

    const deviceResponse = await fetch(`${baseUrl}/api/s/${siteObj.name}/stat/device`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies
      },
      agent: new https.Agent({ rejectUnauthorized: false })
    });

    const deviceData = await deviceResponse.json();
    const results = deviceData.data.map(d => {
      const name = d.name || 'Unknown';
      const rev = d.board_rev || 'N/A';
      return `${name} - Board Revision: ${rev}`;
    }).sort();

    res.json({ results });
  } catch (err) {
    console.error('Error in /board-revision:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ======== MAC Lookup Endpoint =========
app.post('/mac-lookup', async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.json({ error: 'MAC address required.' });

  try {
    const cookies = await login();
    const sites = await getSites(cookies);

    let foundSite = null;
    let counter = 0;

    const searchPromises = sites.map(site =>
      fetch(`${baseUrl}/api/s/${site.name}/stat/device`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookies
        },
        agent: new https.Agent({ rejectUnauthorized: false })
      })
        .then(response => response.json())
        .then(data => {
          counter++;
          const match = data.data.find(d => d.mac?.toLowerCase() === mac.toLowerCase());
          if (match && !foundSite) {
            foundSite = site.desc;
          }
        })
        .catch(err => console.warn(`Site ${site.name} failed:`, err.message))
    );

    await Promise.all(searchPromises);

    if (foundSite) {
      res.json({ site: foundSite });
    } else {
      res.json({ error: 'Device not found.' });
    }
  } catch (err) {
    console.error('Error in /mac-lookup:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
