// update-db.js
import fs from 'fs';
import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import https from 'https';

// UniFi Controller Credentials (DO NOT CHANGE)
const controller = 'https://unifi.nexuswifi.com:8443';
const username = 'admin';
const password = 'rj1teqptmgmt25!'; //

const db = new Database('./devices.db');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function login() {
  const response = await fetch(`${controller}/api/login`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    headers: { 'Content-Type': 'application/json' },
    agent: httpsAgent,
  });

  if (!response.ok) throw new Error(`Login failed: ${response.statusText}`);

  const cookies = response.headers.raw()['set-cookie'];
  return cookies.map(cookie => cookie.split(';')[0]).join('; ');
}

async function getSites(cookie) {
  const response = await fetch(`${controller}/api/self/sites`, {
    headers: { Cookie: cookie },
    agent: httpsAgent,
  });

  if (!response.ok) throw new Error(`Failed to get sites: ${response.statusText}`);
  const json = await response.json();
  const sites = json.data.map(site => ({ name: site.name, desc: site.desc }));
  return sites.sort((a, b) => a.desc.localeCompare(b.desc));
}

async function getDevicesForSite(site, cookie) {
  const response = await fetch(`${controller}/api/s/${site.name}/stat/device`, {
    headers: { Cookie: cookie },
    agent: httpsAgent,
  });

  if (!response.ok) {
    console.warn(`Failed to get devices for site ${site.desc}`);
    return [];
  }

  const json = await response.json();
  return json.data.map(device => ({
    mac: device.mac.toLowerCase(),
    name: device.name || '',
    site: site.desc,
  }));
}

function initDB() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS devices (
      mac TEXT PRIMARY KEY,
      name TEXT,
      site TEXT
    )
  `).run();
}

function saveDevices(devices) {
  const stmt = db.prepare(`
    INSERT INTO devices (mac, name, site)
    VALUES (?, ?, ?)
    ON CONFLICT(mac) DO UPDATE SET
      name = excluded.name,
      site = excluded.site
  `);

  const insertMany = db.transaction(devices => {
    for (const device of devices) {
      stmt.run(device.mac, device.name, device.site);
    }
  });

  insertMany(devices);
}

(async () => {
  try {
    console.log('Logging in...');
    const cookie = await login();

    console.log('Initializing database...');
    initDB();

    console.log('Fetching sites...');
    const sites = await getSites(cookie);

    let totalDevices = 0;

    for (const site of sites) {
      console.log(`Fetching devices for: ${site.desc}`);
      const devices = await getDevicesForSite(site, cookie);
      saveDevices(devices);
      totalDevices += devices.length;
      console.log(`  Saved ${devices.length} devices`);
    }

    console.log(`Done. Total devices saved: ${totalDevices}`);
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
