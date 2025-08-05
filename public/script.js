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
  resultsBox.textContent = '';
  progressBar.style.width = '0%';
  siteCounter.textContent = '';
  timerUp.textContent = '';
  timerDown.textContent = '';

  let startTime = Date.now();
  let intervalId = null;

  intervalId = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    timerUp.textContent = `Elapsed: ${elapsed}s`;

    // Estimate total time: ~20 min for 836 = ~1.43s/site
    if (currentProgress && totalSites) {
      const avgPerSite = (Date.now() - startTime) / currentProgress;
      const remaining = Math.round((totalSites - currentProgress) * avgPerSite / 1000);
      timerDown.textContent = `Remaining: ${remaining}s`;
    }
  }, 1000);

  let currentProgress = 0;
  let totalSites = 0;

  fetch('/mac-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mac })
  })
    .then(res => res.body.getReader())
    .then(reader => {
      const decoder = new TextDecoder();
      let buffer = '';

      const processText = ({ done, value }) => {
        if (done) {
          clearInterval(intervalId);
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        lines.forEach(line => {
          if (line.startsWith('PROGRESS')) {
            const [, curr, total] = line.trim().split(' ');
            currentProgress = parseInt(curr);
            totalSites = parseInt(total);
            const percent = ((curr / total) * 100).toFixed(1);
            progressBar.style.width = `${percent}%`;
            siteCounter.textContent = `Checked: ${curr}/${total}`;
          } else if (line.startsWith('FOUND')) {
            const site = line.replace('FOUND ', '').trim();
            resultsBox.textContent = `✅ Found at site: ${site}`;
            statusBox.textContent = '';
            clearInterval(intervalId);
          } else if (line.startsWith('DONE')) {
            if (!resultsBox.textContent) {
              statusBox.textContent = '❌ Not found on any site.';
            }
            clearInterval(intervalId);
          }
        });

        return reader.read().then(processText);
      };

      return reader.read().then(processText);
    })
    .catch(() => {
      statusBox.textContent = '❌ Error during lookup.';
      clearInterval(intervalId);
    });
}
