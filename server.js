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
// Helper function to parse /24 CIDR base IP
function parseCidr(networkStr) {
  if (!networkStr) return null;
  let n = networkStr.trim();
  if (n.includes('/')) n = n.split('/')[0];
  if (!net.isIP(n)) return null;
  const octets = n.split('.').map(o => parseInt(o, 10));
  if (octets[3] !== 0) return null; // Require base .0 for /24
  return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
}

// ---------------- GET /sites endpoint ----------------
app.get('/sites', async (req, res) => {
  try {
    await login();
    const sites = await getSites();
    // Return only name and desc for frontend use
    const out = sites.map(s => ({ name: s.name, desc: s.desc || s.name }));
    res.json({ sites: out });
  } catch (err) {
    console.error('[Sites Error]', err.message);
    res.status(500).json({ error: '❌ Failed to fetch sites' });
  }
});

// ---------------- POST /create-vlan endpoint ----------------
app.post('/create-vlan', async (req, res) => {
  /*
    Expected body:
    {
      siteName: '<unifi site name (site.name)>',
      vlanId: 100,
      networkName: 'VLANSTAFF',
      networkBase: '192.168.50.0',        // For UniFi network creation
      ssid: 'Guest-Wifi',
      pass: 'securepassword',
      interfaceName: 'Vlan100',            // Gateway VLAN interface name (no spaces)
      gatewayNetworkIp: '192.168.50.0',   // Gateway VLAN network IP (base)
      comment: 'My VLAN comment'           // Optional comment for Mikrotik script
    }
  */

  const {
    siteName,
    vlanId,
    networkName,
    networkBase,
    ssid,
    pass,
    interfaceName,
    gatewayNetworkIp,
    comment
  } = req.body || {};

  // --- Validation ---
  const errors = [];
  if (!siteName) errors.push('Site is required.');
  if (!vlanId || isNaN(vlanId)) errors.push('VLAN ID is required and must be a number.');
  else if (vlanId < 1 || vlanId > 4094) errors.push('VLAN ID must be between 1 and 4094.');
  if (!networkName || typeof networkName !== 'string' || networkName.trim().length < 1) errors.push('Network name required.');
  // if (!networkBase) errors.push('Network base (eg. 192.168.50.0) is required.');
  if (!ssid || ssid.length < 1 || ssid.length > 32) errors.push('SSID required (1-32 characters).');
  if (!pass || pass.length < 8 || pass.length > 63) errors.push('Password required (8-63 characters).');

  if (!interfaceName || interfaceName.includes(' ')) errors.push('Interface Name is required and must not contain spaces.');
  if (!gatewayNetworkIp) errors.push('Network IP is required for Gateway VLAN.');

  const parsedBase = parseCidr(gatewayNetworkIp);
  if (!parsedBase) errors.push('Network IP for Gateway VLAN must be a valid /24 network address (eg. 192.168.50.0 or 192.168.50.0/24).');

  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  try {
    // Confirm site exists
    await login();
    const sites = await getSites();
    const site = sites.find(
      s =>
        s.name === siteName ||
        s.desc === siteName ||
        s.desc?.toLowerCase() === siteName?.toLowerCase()
    );
    if (!site) return res.status(400).json({ error: '❌ Site not found.' });

    // 1. Fetch existing networks
    const existingNetworksRes = await fetchWithCookies(
      `${baseUrl}/api/s/${site.name}/rest/networkconf`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        agent,
      }
    );

    if (!existingNetworksRes.ok) {
      const txt = await existingNetworksRes.text().catch(() => '');
      throw new Error(
        `Failed to get existing networks: ${existingNetworksRes.status} ${existingNetworksRes.statusText} ${txt}`
      );
    }

    const existingNetworksJson = await existingNetworksRes.json();
    const existingNetworks = existingNetworksJson.data || [];

    // 2. Check if network name already exists (case-insensitive, trimmed)
    if (
      existingNetworks.some(
        net => net.name?.trim().toLowerCase() === networkName.trim().toLowerCase()
      )
    ) {
      return res
        .status(400)
        .json({ error: `Network name '${networkName.trim()}' already exists.` });
    }

    // 3. Fetch existing WLANs
    const existingWlanRes = await fetchWithCookies(
      `${baseUrl}/api/s/${site.name}/rest/wlanconf`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        agent,
      }
    );

    if (!existingWlanRes.ok) {
      const txt = await existingWlanRes.text().catch(() => '');
      throw new Error(
        `Failed to get existing WLANs: ${existingWlanRes.status} ${existingWlanRes.statusText} ${txt}`
      );
    }

    const existingWlansJson = await existingWlanRes.json();
    const existingWlans = existingWlansJson.data || [];

    // 4. Check if SSID already exists (case-insensitive, trimmed)
    if (
      existingWlans.some(
        wlan => wlan.name && wlan.name.trim().toLowerCase() === ssid.trim().toLowerCase()
      )
    ) {
      return res.status(400).json({ error: `WiFi SSID '${ssid}' already exists.` });
    }

    // --- Create Network in UniFi ---
    const networkPayload = {
      name: networkName,
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: parseInt(vlanId, 10),
      igmp_snooping: true,
    };

    const netRes = await fetchWithCookies(
      `${baseUrl}/api/s/${site.name}/rest/networkconf`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(networkPayload),
        agent,
      }
    );

    if (!netRes.ok) {
      const txt = await netRes.text().catch(() => '');
      throw new Error(`Failed to create network: ${netRes.status} ${netRes.statusText} ${txt}`);
    }

    const netJson = await netRes.json();
    const createdNetwork = Array.isArray(netJson) ? netJson[0] : netJson; // controller versions vary
    const networkId = createdNetwork?._id || createdNetwork?.data?._id || createdNetwork?.name;

    // --- Get existing WLAN configs to obtain ap_group_ids ---
    const wlanRes = await fetchWithCookies(
      `${baseUrl}/api/s/${site.name}/rest/wlanconf`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        agent,
      }
    );

    if (!wlanRes.ok) {
      const txt = await wlanRes.text().catch(() => '');
      throw new Error(`Failed to get WLAN configs: ${wlanRes.status} ${wlanRes.statusText} ${txt}`);
    }

    const wlanJson = await wlanRes.json();
    const wlanConfs = wlanJson.data || [];

    if (wlanConfs.length === 0) {
      throw new Error('No existing WLAN configurations found to get ap_group_ids from.');
    }

    const apGroupWlan =
      wlanConfs.find(w => Array.isArray(w.ap_group_ids) && w.ap_group_ids.length > 0) || wlanConfs[0];
    const apGroupIds = apGroupWlan.ap_group_ids;

    if (!apGroupIds || !Array.isArray(apGroupIds) || apGroupIds.length === 0) {
      throw new Error('No ap_group_ids found on existing WLANs.');
    }
	const netJson = await netRes.json();
	const createdNetwork = Array.isArray(netJson) ? netJson[0] : netJson;
	const networkId = createdNetwork?._id || createdNetwork?.data?._id || createdNetwork?.name;
    // --- Create WLAN in UniFi ---
    const wlanPayload = {
      name: ssid,
      ssid: ssid,
      enabled: true,
      security: 'wpapsk',
      wpa: 2,
      wpa_mode: 'wpa2',
      x_passphrase: pass,
      ap_group_ids: apGroupIds,
      ap_group_mode: 'all',
	  networkconf_id: networkId
    };

    if (networkId) {
      wlanPayload.networkconf_id = networkId;
    } else {
      wlanPayload.vlan = parseInt(vlanId, 10);
    }

    const wlanCreateRes = await fetchWithCookies(
      `${baseUrl}/api/s/${site.name}/rest/wlanconf`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wlanPayload),
        agent,
      }
    );

    if (!wlanCreateRes.ok) {
      const txt = await wlanCreateRes.text().catch(() => '');
      throw new Error(`Failed to create wlan: ${wlanCreateRes.status} ${wlanCreateRes.statusText} ${txt}`);
    }

    // Build Mikrotik script with gatewayNetworkIp and interfaceName
    const octs = parsedBase.split('.').map(o => parseInt(o, 10));
    const gateway = `${octs[0]}.${octs[1]}.${octs[2]}.1`;
    const poolStart = `${octs[0]}.${octs[1]}.${octs[2]}.100`;
    const poolEnd = `${octs[0]}.${octs[1]}.${octs[2]}.250`;
    const networkCidr = `${octs[0]}.${octs[1]}.${octs[2]}.0/24`;

    // Prepare comment line (sanitize newlines)
    const commentLine = comment ? ` comment=${comment.replace(/\n/g, ' ').trim()}` : '';
    const mikrotikScript = `
/interface vlan
add interface=${interfaceName} name=${networkName} vlan-id=${vlanId}

/ip pool
add name=${networkName}-Pool ranges=${poolStart}-${poolEnd}

/ip dhcp-server
add address-pool=${networkName}-Pool authoritative=after-2sec-delay disabled=no interface=${networkName} lease-time=1d name=${networkName}

/ip address
add address=${gateway}/24${commentLine} interface=${networkName} network=${parsedBase}

/ip dhcp-server network
add address=${networkCidr} ${commentLine} dns-server=${gateway} domain=nexuswifi.com gateway=${gateway}

/ip firewall nat
add action=masquerade chain=srcnat ${commentLine} src-address=${networkCidr}

/ip firewall filter
add action=drop chain=forward dst-address=10.11.0.0/21 src-address=${networkCidr}

/ip firewall filter
add action=drop chain=forward dst-address=${networkCidr} src-address=10.11.0.0/21
`;

    res.json({ script: mikrotikScript });
  } catch (err) {
    console.error('[Create VLAN Error]', err.message);
    res.status(500).json({ error: `❌ Failed to create VLAN: ${err.message}` });
  }
});
app.post('/find-gateway-ip', async (req, res) => {
  const { siteName } = req.body || {};
  if (!siteName) return res.status(400).json({ error: 'Site name is required.' });

  // Ordered search list for device names/hostnames
  const searchNames = [
    'ap1', 'ap01',
    'sw1', 'sw01',
    'switch1', 'switch01',
    'sw2', 'sw02',
    'switch2', 'switch02'
  ];

  try {
    await login();

    // Get all devices in the site
    const devicesRes = await fetchWithCookies(
      `${baseUrl}/api/s/${encodeURIComponent(siteName)}/stat/device`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' }, agent }
    );

    if (!devicesRes.ok) {
      const txt = await devicesRes.text().catch(() => '');
      throw new Error(`Failed to fetch devices: ${devicesRes.status} ${devicesRes.statusText} ${txt}`);
    }

    const devicesJson = await devicesRes.json();
    let devices = devicesJson.data || [];
    if (!devices.length) return res.status(404).json({ error: 'No devices found in site.' });

    // Optional: filter only online devices (uncomment if desired)
    // devices = devices.filter(d => d.state === 1 || d.connected === true);

    // Try each search term in order until success
    for (const searchTerm of searchNames) {
      const targetDevice = devices.find(dev =>
        (dev.name && dev.name.toLowerCase().includes(searchTerm)) ||
        (dev.hostname && dev.hostname.toLowerCase().includes(searchTerm))
      );

      if (!targetDevice) continue;

      const mac = targetDevice.mac;
      console.log(`[Find Gateway IP] Trying device: ${targetDevice.name || targetDevice.hostname} (${mac})`);

      // Command for UniFi debug tools - test with echo first
      const debugCmd = {
        cmd: 'debug',
        mac,
        data: 'echo test'  // <-- Change back to 'curl ifconfig.co' after testing
      };

      const debugRes = await fetchWithCookies(
        `${baseUrl}/api/s/${encodeURIComponent(siteName)}/cmd/devmgr`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(debugCmd),
          agent,
        }
      );

      if (!debugRes.ok) {
        console.warn(`[Find Gateway IP] Debug failed for ${searchTerm}, trying next...`);
        continue;
      }

      const debugJson = await debugRes.json();
      console.log('[Find Gateway IP] debugJson:', JSON.stringify(debugJson, null, 2));

      // Extract debug output
      let output = '';
      if (Array.isArray(debugJson.data)) {
        output = debugJson.data[0]?.data || '';
      } else if (typeof debugJson.data === 'string') {
        output = debugJson.data;
      } else if (debugJson.data && typeof debugJson.data.data === 'string') {
        output = debugJson.data.data;
      }

      const ip = output.trim();
      const ipRegex = /(\d{1,3}\.){3}\d{1,3}/;

      if (ipRegex.test(ip)) {
        return res.json({
          ip,
          mac,
          deviceName: targetDevice.name || targetDevice.hostname
        });
      } else {
        console.warn(`[Find Gateway IP] Invalid IP output from ${searchTerm}: "${output}"`);
      }
    }

    // If we got here, nothing worked
    res.status(404).json({ error: 'No valid IP could be retrieved from any device.' });

  } catch (err) {
    console.error('[Find Gateway IP Error]', err);
    res.status(500).json({ error: 'Failed to find gateway IP.', details: err.message });
  }
});







// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
