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

document.getElementById('lookup-board').addEventListener('click', async () => {
  const site = document.getElementById('site-input').value.trim();
  const res = await fetch('/board-revision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site })
  });
  const data = await res.json();
  if (data.error) return alert(data.error);
  document.getElementById('board-results').textContent = data.map(d => `${d.name} - Board Revision: ${d.board_rev}`).join('\n');
});

document.getElementById('lookup-mac').addEventListener('click', async () => {
  const mac = document.getElementById('mac-input').value.trim();
  const status = document.getElementById('mac-status');
  const progressBar = document.getElementById('progress-bar');
  const wrapper = document.getElementById('progress-wrapper');
  const output = document.getElementById('mac-results');

  wrapper.style.display = 'block';
  status.textContent = 'Starting search...';
  output.textContent = '';
  progressBar.style.width = '0%';

  const res = await fetch('/mac-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mac })
  });

  const result = await res.json();
  wrapper.style.display = 'none';

  if (result.error) {
    status.textContent = 'Error: ' + result.error;
    return;
  }

  if (result.results.length === 0) {
    status.textContent = 'MAC not found in any site.';
  } else {
    status.textContent = '✅ Found at:';
    output.textContent = result.results.map(r => `• ${r.site}`).join('\n');
  }
});
