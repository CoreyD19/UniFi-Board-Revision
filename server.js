const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const https = require('https');
require('dotenv').config();

const app = express();
const agent = new https.Agent({ rejectUnauthorized: false });

app.use(cors()); // Allow frontend to access API
app.use(express.json());

app.post('/get-devices', async (req, res) => {
  const siteDesc = req.body.site_desc?.trim();
  const baseURL = 'https://unifi.nexuswifi.com:8443';
  const username = process.env.UNIFI_USER;
  const password = process.env.UNIFI_PASS;

  if (!siteDesc) return res.status(400).json({ error: 'Missing site description' });

  try {
    // 1. Login
    const loginRes = await fetch(`${baseURL}/api/login`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      headers: { 'Content-Type': 'application/json' },
      agent
    });

    const cookie = loginRes.headers.get('set-cookie');
    if (!cookie) return res.status(401).json({ error: 'Login failed' });

    // 2. Get Sites
    const sitesRes = await fetch(`${baseURL}/api/self/sites`, {
      headers: { Cookie: cookie },
      agent
    });

    const sites = (await sitesRes.json()).data;
    const site = sites.find(s => s.desc === siteDesc);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    // 3. Get Devices
    const devicesRes = await fetch(`${baseURL}/api/s/${site.name}/stat/device`, {
      headers: { Cookie: cookie },
      agent
    });

    const devices = (await devicesRes.json()).data;
    const result = devices.map(d => `${d.name} - Board Revision: ${d.board_rev || 'N/A'}`);
    res.json(result.sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server running on port ${port}`));
