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
  const progressBar = document.getElementById('progress-bar');
  const siteCounter = document.getElementById('site-counter');
  const timerUp = document.getElementById('timer-up');
  const timerDown = document.getElementById('timer-down');

  if (!mac) {
    statusBox.textContent = '❌ MAC address is required.';
    return;
  }

  statusBox.textContent = '🔄 Searching...';
  statusBox.style.color = '';
  resultsBox.textContent = '';
  progressBar.style.width = '0%';
  siteCounter.textContent = '';
  timerUp.textContent = '';
  timerDown.textContent = '';

  let startTime = Date.now();
  let currentProgress = 0;
  let totalSites = 0;
  let found = false;

  const formatTime = ms => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  let intervalId = setInterval(() => {
    const elapsedMs = Date.now() - startTime;
    timerUp.textContent = `Elapsed: ${formatTime(elapsedMs)}`;

    if (currentProgress > 0 && totalSites > 0 && !found) {
      const avgPerSite = elapsedMs / currentProgress;
      const remainingMs = Math.round((totalSites - currentProgress) * avgPerSite);
      timerDown.textContent = `Remaining: ${formatTime(remainingMs)}`;
    }
  }, 1000);

  fetch('/mac-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mac })
  })
    .then(res => {
      if (!res.body) throw new Error('ReadableStream not supported.');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function read() {
        return reader.read().then(({ done, value }) => {
          if (done) {
            clearInterval(intervalId);
            if (!found) {
              statusBox.textContent = '❌ MAC address not found on any site.';
              statusBox.style.color = 'red';
              resultsBox.textContent = '';
            }
            progressBar.style.width = '100%';
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          lines.forEach(line => {
            if (line.startsWith('PROGRESS')) {
              const [, curr, total] = line.trim().split(' ');
              currentProgress = parseInt(curr);
              totalSites = parseInt(total);
              const percent = ((currentProgress / totalSites) * 100).toFixed(1);
              progressBar.style.width = `${percent}%`;
              siteCounter.textContent = `Checked: ${currentProgress}/${totalSites}`;
            } else if (line.startsWith('FOUND')) {
              found = true;
              const foundData = line.substring(6).split('||').map(s => s.trim());
              const siteName = foundData[0] || 'Unknown Site';
              const deviceName = foundData[1] || 'Unknown Device';

              statusBox.textContent = `✅ Device found at site: ${siteName}`;
              statusBox.style.color = 'green';
              resultsBox.textContent = `📟 Device Name: ${deviceName}`;
              resultsBox.style.color = 'green';

              clearInterval(intervalId);
              timerDown.textContent = `Remaining: 00:00`;
            } else if (line.startsWith('DONE')) {
              progressBar.style.width = '100%';
              if (!found) {
                statusBox.textContent = '❌ MAC address not found on any site.';
                statusBox.style.color = 'red';
                resultsBox.textContent = '';
              }
              clearInterval(intervalId);
            }
          });

          return read();
        });
      }

      return read();
    })
    .catch(() => {
      clearInterval(intervalId);
      statusBox.textContent = '❌ Error during lookup.';
      statusBox.style.color = 'red';
    });
}
