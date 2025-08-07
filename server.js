import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import ipaddr from 'ipaddr.js';
import fetch from 'node-fetch';
import fetchCookie from 'fetch-cookie';
import tough from 'tough-cookie';
import https from 'https';
import cors from 'cors';

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
    { ip: '::1' }
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

// UniFi credentials
const baseUrl = 'https://unifi.nexuswifi.com:8443';
const username = 'admin';
const password = 'rj1teqptmgmt25!';

const agent = new https.Agent({ rejectUnauthorized: false });
const cookieJar = new tough.CookieJar();
const fetchWithCookies = fetchCookie(fetch, cookieJar, { agent });

// Helper functions
async function login() {
    const response = await fetchWithCookies(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        agent, // Keep agent here for initial login if needed, though fetchCookie handles it for subsequent calls
    });
    if (!response.ok) {
        throw new Error(`Login failed: ${response.statusText}`);
    }
}

async function getSites() {
    const res = await fetchWithCookies(`${baseUrl}/api/self/sites`, { agent }); // Keep agent here for initial sites call if needed
    const json = await res.json();
    return json.data;
}

// ✅ BOARD REVISION ENDPOINT (No changes needed here for this request)
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
            agent // Keep agent here
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

// ⚡️ OPTIMIZED MAC LOOKUP ENDPOINT
app.post('/mac-lookup', async (req, res) => {
    const { mac } = req.body;
    if (!mac) return res.json({ error: '❌ MAC address required.' });

    res.setHeader('Content-Type', 'text/plain'); // Set content type for streaming updates
    res.setHeader('Cache-Control', 'no-cache'); // Prevent caching of the stream
    res.setHeader('Connection', 'keep-alive'); // Keep connection open for streaming

    try {
        await login();
        const sites = await getSites();
        const sortedSites = sites.sort((a, b) => a.desc.localeCompare(b.desc));
        const totalSites = sortedSites.length;

        let found = false; // Flag to signal if MAC is found by any concurrent search
        let sitesProcessed = 0; // Shared counter for overall progress

        const midpoint = Math.ceil(totalSites / 2);
        const firstHalf = sortedSites.slice(0, midpoint);
        const secondHalf = sortedSites.slice(midpoint);

        // Function to search a portion of sites (either forward or backward)
        const searchSites = async (sitesToSearch, isReverse = false) => {
            for (let i = 0; i < sitesToSearch.length; i++) {
                if (found) { // If MAC is found by another thread, stop this one
                    break;
                }

                const siteIndex = isReverse ? sitesToSearch.length - 1 - i : i;
                const site = sitesToSearch[siteIndex];

                try {
                    const clientRes = await fetchWithCookies(`${baseUrl}/api/s/${site.name}/stat/sta`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        agent // Ensure agent is used for these calls as well
                    });

                    const json = await clientRes.json();
                    const match = json.data.find(dev => dev.mac?.toLowerCase() === mac.toLowerCase());

                    if (match) {
                        if (!found) { // Ensure only the first one to find writes the result
                            found = true;
                            const name = match.name || 'Unnamed Device';
                            res.write(`FOUND ${site.desc} || ${name}\n`);
                            res.end(); // End the response stream immediately
                        }
                        return; // Exit this search function
                    }
                } catch (err) {
                    console.error(`[MAC Lookup Site Error - ${site.desc}]`, err.message);
                    // Continue to the next site even if one fails
                }

                // Safely increment and report progress
                sitesProcessed++;
                // Use a temporary variable to avoid race conditions on res.write
                const currentProgress = sitesProcessed;
                const totalProgress = totalSites;
                res.write(`PROGRESS ${currentProgress} ${totalProgress}\n`);
            }
        };

        // Run both searches concurrently
        await Promise.all([
            searchSites(firstHalf, false), // Search from front to midpoint
            searchSites(secondHalf, true)  // Search from back to midpoint in reverse
        ]);

        // If not found by either search and the response stream is still open
        if (!found && !res.headersSent) {
            res.write('NOT_FOUND\n');
            res.end();
        }
    } catch (err) {
        console.error('[MAC Lookup Error]', err.message);
        // Ensure response is sent even on outer catch
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