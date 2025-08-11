import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import ipaddr from 'ipaddr.js';
import https from 'https';
import cors from 'cors';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import net from 'net'; // <--- Added this import

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

// ---------------- New: /sites endpoint (returns list of sites) ----------------
app.get('/sites', async (req, res) => {
  try {
    await login();
    const sites = await getSites();
    // Return only the fields the frontend needs
    const out = sites.map(s => ({ name: s.name, desc: s.desc || s.name }));
    res.json({ sites: out });
  } catch (err) {
    console.error('[Sites Error]', err.message);
    res.status(500).json({ error: '❌ Failed to fetch sites' });
  }
});

// ---------------- Helper: validate IPv4 network (accepts x.y.z.0 or x.y.z.0/24) ----------------
function parseCidr(networkStr) {
  // Accept '192.168.50.0' or '192.168.50.0/24'
  if (!networkStr) return null;
  let n = networkStr.trim();
  if (n.includes('/')) n = n.split('/')[0];
  if (!net.isIP(n)) return null;
  const octets = n.split('.').map(o => parseInt(o, 10));
  if (octets[3] !== 0) return null; // require .0 network base for /24
  return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
}

// ---------------- New: /create-vlan endpoint ----------------
app.post('/create-vlan', async (req, res) => {
  /*
    Expected body:
    {
      siteName: '<unifi site name (site.name)>',
      vlanId: 100,
      networkName: 'VLANSTAFF',
      networkBase: '192.168.50.0', // or '192.168.50.0/24'
      ssid: 'Guest-Wifi',
      pass: 'securepassword'
    }
  */

  const { siteName, vlanId, networkName, networkBase, ssid, pass } = req.body || {};

  // --- Validation ---
  const errors = [];
  if (!siteName) errors.push('Site is required.');
  if (!vlanId || isNaN(vlanId)) errors.push('VLAN ID is required and must be a number.');
  else if (vlanId < 1 || vlanId > 4094) errors.push('VLAN ID must be between 1 and 4094.');
  if (!networkName || typeof networkName !== 'string' || networkName.trim().length < 1) errors.push('Network name required.');
  if (!networkBase) errors.push('Network base (eg. 192.168.50.0) is required.');
  if (!ssid || ssid.length < 1 || ssid.length > 32) errors.push('SSID required (1-32 characters).');
  if (!pass || pass.length < 8 || pass.length > 63) errors.push('Password required (8-63 characters).');

  const parsedBase = parseCidr(networkBase);
  if (!parsedBase) errors.push('Network base must be a valid /24 network address (eg. 192.168.50.0 or 192.168.50.0/24).');

  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  try {
    // Confirm site exists
    await login();
    const sites = await getSites();
    const site = sites.find(s => s.name === siteName || s.desc === siteName || s.desc?.toLowerCase() === siteName?.toLowerCase());
    if (!site) return res.status(400).json({ error: '❌ Site not found.' });

    // --- Create Network in UniFi ---
    const networkPayload = {
      name: networkName,
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: parseInt(vlanId, 10),
      // many UniFi controllers accept igmp settings — we'll include commonly used field
      igmp_snooping_enabled: true
    };

    const netRes = await fetchWithCookies(`${baseUrl}/api/s/${site.name}/rest/networkconf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(networkPayload),
      agent
    });

    if (!netRes.ok) {
      const txt = await netRes.text().catch(() => '');
      throw new Error(`Failed to create network: ${netRes.status} ${netRes.statusText} ${txt}`);
    }

    const netJson = await netRes.json();
    const createdNetwork = Array.isArray(netJson) ? netJson[0] : netJson; // controller versions vary
    const networkId = createdNetwork?._id || createdNetwork?.data?._id || createdNetwork?.name;

    // --- Create WLAN in UniFi ---
    // The WLAN needs a reference to the networkconf; different controllers expect networkconf_id or mapping via 'vlan'
    const wlanPayload = {
      name: ssid,
      ssid: ssid,
      enabled: true,
      // common fields for WPA2-PSK
      security: 'wpawpa2',
      wpa: 2,
      wpa_mode: 'wpa2_only',
      wpa_psk: pass
    };

    // Attach the WLAN to the VLAN/network. Try common field names if available
    if (networkId) {
      // try to link by networkconf_id
      wlanPayload.networkconf_id = networkId;
    } else {
      // fallback to setting vlan
      wlanPayload.vlan = parseInt(vlanId, 10);
    }

    const wlanRes = await fetchWithCookies(`${baseUrl}/api/s/${site.name}/rest/wlanconf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wlanPayload),
      agent
    });

    if (!wlanRes.ok) {
      const txt = await wlanRes.text().catch(() => '');
      throw new Error(`Failed to create wlan: ${wlanRes.status} ${wlanRes.statusText} ${txt}`);
    }

    // --- Build Mikrotik script output ---
    // networkBase is like 192.168.50.0
    const octs = parsedBase.split('.').map(o => parseInt(o, 10));
    const gateway = `${octs[0]}.${octs[1]}.${octs[2]}.1`;
    const poolStart = `${octs[0]}.${octs[1]}.${octs[2]}.100`;
    const poolEnd = `${octs[0]}.${octs[1]}.${octs[2]}.250`;
    const networkCidr = `${octs[0]}.${octs[1]}.${octs[2]}.0/24`;

    const mikrotikScript = `# Paste into gateway (automatically generated)
/interface vlan
add interface=GuestNet-Bridge name=${networkName} vlan-id=${vlanId}

/ip pool
add name=${networkName}-Pool ranges=${poolStart}-${poolEnd}

/ip dhcp-server
add address-pool=${networkName}-Pool authoritative=after-2sec-delay disabled=no interface=${networkName} lease-time=1d name=${networkName}

/ip address
add address=${gateway}/24 comment=PrivateVLAN interface=${networkName} network=${parsedBase}

/ip dhcp-server network
add address=${networkCidr} comment=PrivateVLAN dns-server=${gateway} domain=nexuswifi.com gateway=${gateway}

/ip firewall nat
add action=masquerade chain=srcnat comment=PrivateVLAN src-address=${networkCidr}

/ip firewall filter
add action=drop chain=forward dst-address=10.11.0.0/21 src-address=${networkCidr}
`;

    res.json({ script: mikrotikScript });
  } catch (err) {
    console.error('[Create VLAN Error]', err.message);
    res.status(500).json({ error: `❌ Failed to create VLAN: ${err.message}` });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
