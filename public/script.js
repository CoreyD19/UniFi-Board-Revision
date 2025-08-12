document.getElementById('tab-board').addEventListener('click', () => {
  document.getElementById('board-section').style.display = 'block';
  document.getElementById('mac-section').style.display = 'none';
  document.getElementById('vlan-section').style.display = 'none';

  document.getElementById('tab-board').classList.add('active');
  document.getElementById('tab-mac').classList.remove('active');
  document.getElementById('tab-vlan').classList.remove('active');
});

document.getElementById('tab-mac').addEventListener('click', () => {
  document.getElementById('board-section').style.display = 'none';
  document.getElementById('mac-section').style.display = 'block';
  document.getElementById('vlan-section').style.display = 'none';

  document.getElementById('tab-board').classList.remove('active');
  document.getElementById('tab-mac').classList.add('active');
  document.getElementById('tab-vlan').classList.remove('active');
});

document.getElementById('tab-vlan').addEventListener('click', () => {
  document.getElementById('board-section').style.display = 'none';
  document.getElementById('mac-section').style.display = 'none';
  document.getElementById('vlan-section').style.display = 'block';

  document.getElementById('tab-board').classList.remove('active');
  document.getElementById('tab-mac').classList.remove('active');
  document.getElementById('tab-vlan').classList.add('active');
});



document.getElementById('lookup-board').addEventListener('click', lookupBoard);
document.getElementById('site-input').addEventListener('keypress', e => {
  if (e.key === 'Enter') lookupBoard();
});

function lookupBoard() {
  const site = document.getElementById('site-input').value.trim();
  const resultBox = document.getElementById('board-results');
  const errorBox = document.getElementById('board-error');
  resultBox.textContent = '';
  errorBox.textContent = '';

  if (!site) {
    errorBox.textContent = '❌ Site is required.';
    return;
  }

  resultBox.textContent = '🔄 Searching...';

  fetch('/board-revision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site })
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        errorBox.textContent = data.error;
        resultBox.textContent = '';
      } else {
        resultBox.textContent = data.results.join('\n');
      }
    })
    .catch(() => {
      errorBox.textContent = '❌ Internal error. Try again.';
      resultBox.textContent = '';
    });
}

// MAC Lookup logic
document.getElementById('lookup-mac').addEventListener('click', lookupMac);
document.getElementById('mac-input').addEventListener('keypress', e => {
  if (e.key === 'Enter') lookupMac();
});

function lookupMac() {
  const mac = document.getElementById('mac-input').value.trim();
  const resultsBox = document.getElementById('mac-results');
  const statusBox = document.getElementById('mac-status');

  if (!mac) {
    statusBox.textContent = '❌ MAC address is required.';
    statusBox.style.color = 'red';
    return;
  }

  statusBox.textContent = '🔄 Searching...';
  statusBox.style.color = '';
  resultsBox.textContent = '';

  fetch('/mac-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mac })
  })
    .then(res => res.text())
    .then(text => {
      if (text.startsWith('FOUND')) {
        const foundData = text.substring(6).split('||').map(s => s.trim());
        const siteName = foundData[0] || 'Unknown Site';
        const deviceName = foundData[1] || 'Unknown Device';

        statusBox.textContent = `✅ Device found at site: ${siteName}`;
        statusBox.style.color = 'green';
        resultsBox.textContent = `📟 Device Name: ${deviceName}`;
        resultsBox.style.color = 'green';
      } else if (text.startsWith('NOT_FOUND') || text.trim() === '') {
        statusBox.textContent = '❌ MAC address not found on any site.';
        statusBox.style.color = 'red';
        resultsBox.textContent = '';
      } else {
        statusBox.textContent = '❌ Unexpected response from server.';
        statusBox.style.color = 'red';
      }
    })
    .catch(() => {
      statusBox.textContent = '❌ Error during lookup.';
      statusBox.style.color = 'red';
      resultsBox.textContent = '';
    });
}
// Populate site list for VLAN on page load
let vlanSites = [];
const vlanSiteList = document.getElementById('vlan-site-list');
const vlanSiteSearch = document.getElementById('vlan-site-search');

async function loadVlanSites() {
  try {
    const res = await fetch('/sites');
    if (!res.ok) throw new Error(`Failed to fetch sites: ${res.statusText}`);
    const data = await res.json();
    if (data.sites && Array.isArray(data.sites)) {
      vlanSites = data.sites;
      vlanSiteList.innerHTML = ''; // keep list empty initially
      console.log(`Loaded ${vlanSites.length} VLAN sites`);
    } else {
      vlanSites = [];
      vlanSiteList.innerHTML = '';
      console.warn('No sites array found in /sites response');
    }
  } catch (err) {
    console.error('Failed to load sites for VLAN:', err);
    vlanSites = [];
    vlanSiteList.innerHTML = '';
  }
}

vlanSiteSearch.addEventListener('input', () => {
  const val = vlanSiteSearch.value.trim().toLowerCase();
  if (val.length < 1) {
    vlanSiteList.innerHTML = ''; // clear list if empty input
    return;
  }
  const filtered = vlanSites.filter(s => {
    const desc = s.desc || s.name || '';
    return desc.toLowerCase().includes(val);
  });
  renderVlanSiteList(filtered);
});

function renderVlanSiteList(sites) {
  vlanSiteList.innerHTML = '';
  sites.forEach(site => {
    const text = site.desc || site.name || 'Unnamed Site';
    const li = document.createElement('li');
    li.textContent = text;
    li.dataset.name = site.name || '';
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => {
      Array.from(vlanSiteList.children).forEach(c => c.classList.remove('selected'));
      li.classList.add('selected');
    });
    vlanSiteList.appendChild(li);
  });
}

// Link VLAN ID fields between UniFi and Gateway VLAN (two-way)
const vlanIdField = document.getElementById('vlan-id');
const gatewayVlanIdField = document.getElementById('gateway-vlan-id');
vlanIdField.addEventListener('input', () => gatewayVlanIdField.value = vlanIdField.value);
gatewayVlanIdField.addEventListener('input', () => vlanIdField.value = gatewayVlanIdField.value);

// Auto-fill interface name from network name (remove spaces, lowercase, allow manual override)
const networkNameField = document.getElementById('vlan-network-name');
const interfaceNameField = document.getElementById('gateway-interface-name');
interfaceNameField.dataset.manualEdit = false;
networkNameField.addEventListener('input', () => {
  if (!interfaceNameField.dataset.manualEdit) {
    interfaceNameField.value = networkNameField.value.replace(/\s+/g, '').toLowerCase();
  }
});
interfaceNameField.addEventListener('input', () => {
  interfaceNameField.dataset.manualEdit = true;
});

// VLAN form submission
document.getElementById('create-vlan').addEventListener('click', async () => {
  const vlanId = vlanIdField.value.trim();
  const networkName = networkNameField.value.trim();
  const ssid = document.getElementById('vlan-ssid').value.trim();
  const pass = document.getElementById('vlan-password').value.trim();

  const gatewayVlanId = gatewayVlanIdField.value.trim();
  const interfaceName = interfaceNameField.value.trim();
  const gatewayNetworkIp = document.getElementById('gateway-network-ip').value.trim();
  const gatewayComment = document.getElementById('gateway-comment').value.trim();

  const errorBox = document.getElementById('vlan-error');
  const scriptBox = document.getElementById('vlan-gateway-script');
  errorBox.textContent = '';
  scriptBox.value = '';

  const selectedLi = vlanSiteList.querySelector('li.selected');
  if (!selectedLi) {
    errorBox.textContent = '❌ Please select a site from the list.';
    return;
  }
  const siteName = selectedLi.dataset.name;

  const errors = [];
  if (!vlanId || isNaN(vlanId)) errors.push('VLAN ID must be a number.');
  else if (+vlanId < 1 || +vlanId > 4094) errors.push('VLAN ID must be between 1 and 4094.');
  if (!networkName) errors.push('Network Name is required.');
  if (!ssid || ssid.length < 1 || ssid.length > 32) errors.push('SSID must be 1-32 characters.');
  if (!pass || pass.length < 8 || pass.length > 63) errors.push('Password must be 8-63 characters.');
  if (!interfaceName) errors.push('Interface Name is required.');
  if (/\s/.test(interfaceName)) errors.push('Interface Name cannot contain spaces.');
  if (!gatewayNetworkIp) errors.push('Network IP is required for Gateway VLAN.');

  if (errors.length) {
    errorBox.textContent = '❌ ' + errors.join(' ');
    return;
  }

  errorBox.textContent = '🔄 Creating VLAN...';

  try {
    const res = await fetch('/create-vlan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteName,
        vlanId: +vlanId,
        networkName,
        ssid,
        pass,
        interfaceName,
        gatewayNetworkIp,
        comment: gatewayComment
      })
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.error) {
        try {
          const errorMatch = data.error.match(/\{.*\}/s);
          if (errorMatch) {
            const errorObj = JSON.parse(errorMatch[0]);
            if (errorObj.meta?.msg === 'api.err.VlanUsed') {
              errorBox.textContent = `❌ VLAN ID ${errorObj.meta.vlan} is already in use.`;
            } else {
              errorBox.textContent = `❌ ${errorObj.meta?.msg || data.error}`;
            }
          } else {
            errorBox.textContent = `❌ ${data.error}`;
          }
        } catch {
          errorBox.textContent = `❌ ${data.error}`;
        }
      } else {
        errorBox.textContent = '❌ Failed to create VLAN.';
      }
      return;
    }

    errorBox.textContent = '✅ VLAN created successfully.';
    scriptBox.value = data.script || '';
  } catch (err) {
    errorBox.textContent = '❌ Error creating VLAN.';
  }
});

loadVlanSites();

document.getElementById('pushGatewayBtn').addEventListener('click', () => {
  const passInput = document.getElementById('gatewayPass');
  const errorElem = document.getElementById('pushError');

  const correctPassword = 'N3xusW1f1';

  if (passInput.value === correctPassword) {
    errorElem.style.display = 'none';
    alert('Password correct! (Pushing to gateway logic not implemented yet.)');
    // TODO: Implement push to gateway logic here
  } else {
    errorElem.textContent = '❌ Wrong password, please try again.';
    errorElem.style.display = 'block';
  }
});


