document.addEventListener('DOMContentLoaded', () => {
  const boardBtn = document.getElementById('tab-board');
  const macBtn = document.getElementById('tab-mac');
  const boardSection = document.getElementById('board-section');
  const macSection = document.getElementById('mac-section');
  const siteInput = document.getElementById('site-input');
  const macInput = document.getElementById('mac-input');
  const boardResults = document.getElementById('board-results');
  const macResults = document.getElementById('mac-results');
  const macStatus = document.getElementById('mac-status');
  const progressWrapper = document.getElementById('progress-wrapper');
  const progressBar = document.getElementById('progress-bar');

  // Tab switching
  boardBtn.addEventListener('click', () => {
    boardBtn.classList.add('active');
    macBtn.classList.remove('active');
    boardSection.style.display = 'block';
    macSection.style.display = 'none';
    boardResults.textContent = '';
  });

  macBtn.addEventListener('click', () => {
    macBtn.classList.add('active');
    boardBtn.classList.remove('active');
    macSection.style.display = 'block';
    boardSection.style.display = 'none';
    macResults.textContent = '';
  });

  // Board Revision Lookup
  document.getElementById('lookup-board').addEventListener('click', lookupBoard);
  siteInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') document.getElementById('lookup-board').click();
  });

  function lookupBoard() {
    const site = siteInput.value.trim();
    boardResults.style.color = 'black';
    boardResults.textContent = '';

    if (!site) {
      displayBoardError('Please enter a site description.');
      return;
    }

    boardResults.innerHTML = '🔄 Loading...';

    fetch('/board-revision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site })
    })
      .then(response => response.json())
      .then(data => {
        if (data.error) {
          displayBoardError(data.error);
        } else {
          boardResults.style.color = 'black';
          boardResults.textContent = data.results.join('\n');
        }
      })
      .catch(() => {
        displayBoardError('Unexpected error occurred');
      });
  }

  function displayBoardError(message) {
    boardResults.textContent = `❌ ${message}`;
    boardResults.style.color = 'red';
  }

  // MAC Lookup
  document.getElementById('lookup-mac').addEventListener('click', lookupMac);
  macInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') document.getElementById('lookup-mac').click();
  });

  function lookupMac() {
    const mac = macInput.value.trim();
    macStatus.textContent = '';
    macResults.textContent = '';
    progressBar.style.width = '0%';

    if (!mac) {
      macStatus.textContent = '❌ Please enter a MAC address.';
      macStatus.style.color = 'red';
      return;
    }

    macStatus.style.color = 'black';
    macStatus.innerHTML = '🔄 Scanning...';
    progressWrapper.style.display = 'block';

    fetch('/mac-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac })
    })
      .then(response => response.json())
      .then(data => {
        if (data.site) {
          macStatus.textContent = `✅ Device found at site: ${data.site}`;
          macStatus.style.color = 'green';
        } else {
          macStatus.textContent = '❌ Device not found.';
          macStatus.style.color = 'red';
        }
        progressWrapper.style.display = 'none';
      })
      .catch(() => {
        macStatus.textContent = '❌ Unexpected error occurred.';
        macStatus.style.color = 'red';
        progressWrapper.style.display = 'none';
      });
  }
});
