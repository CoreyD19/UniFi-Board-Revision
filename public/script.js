document.getElementById('tab-board').addEventListener('click', () => {
  document.getElementById('board-section').style.display = 'block';
  document.getElementById('mac-section').style.display = 'none';
  document.getElementById('tab-board').classList.add('active');
  document.getElementById('tab-mac').classList.remove('active');
});

document.getElementById('tab-mac').addEventListener('click', () => {
  document.getElementById('board-section').style.display = 'none';
  document.getElementById('mac-section').style.display = 'block';
  document.getElementById('tab-board').classList.remove('active');
  document.getElementById('tab-mac').classList.add('active');
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
