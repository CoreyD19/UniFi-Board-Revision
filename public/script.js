document.getElementById('tab-board').addEventListener('click', () => {
  document.getElementById('board-section').style.display = 'block';
  document.getElementById('mac-section').style.display = 'none';
  document.getElementById('tab-board').classList.add('active');
  document.getElementById('tab-mac').classList.remove('active');
});

document.getElementById('tab-mac').addEventListener('click', () => {
  document.getElementById('board-section').style.display = 'none';
  document.getElementById('mac-section').style.display = 'block';
  document.getElementById('tab-mac').classList.add('active');
  document.getElementById('tab-board').classList.remove('active');
});

// Board Revision Lookup
document.getElementById('lookup-board').addEventListener('click', lookupBoard);
document.getElementById('site-input').addEventListener('keypress', e => {
  if (e.key === 'Enter') lookupBoard();
});

function lookupBoard() {
  const input = document.getElementById('site-input').value.trim();
  const output = document.getElementById('board-results');
  output.textContent = '';

  if (!input) {
    output.textContent = '❌ Please enter a site description.';
    return;
  }

  output.textContent = '⏳ Searching...';

  fetch('/board-revision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site: input })
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        output.textContent = data.error;
      } else {
        output.textContent = data.results.join('\n');
      }
    })
    .catch(err => {
      output.textContent = '❌ Error contacting server.';
    });
}

// MAC Lookup
document.getElementById('lookup-mac').addEventListener('click', lookupMac);
document.getElementById('mac-input').addEventListener('keypress', e => {
  if (e.key === 'Enter') lookupMac();
});

function lookupMac() {
  const mac = document.getElementById('mac-input').value.trim();
  const status = document.getElementById('mac-status');
  const results = document.getElementById('mac-results');

  results.textContent = '';
  if (!mac) {
    status.style.color = 'red';
    status.textContent = '❌ Please enter a MAC address.';
    return;
  }

  status.style.color = 'black';
  status.textContent = `🔄 Scanning all sites for ${mac}...`;

  fetch('/mac-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mac })
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        status.style.color = 'red';
        status.textContent = data.error;
      } else {
        status.style.color = 'green';
        status.textContent = `✅ Device found at site: ${data.site}`;
      }
    })
    .catch(err => {
      status.style.color = 'red';
      status.textContent = '❌ Error contacting server.';
    });
}