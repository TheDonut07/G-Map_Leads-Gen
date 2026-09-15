const queryInput = document.getElementById('query');
const maxResultsInput = document.getElementById('maxResults');
const startBtn = document.getElementById('startBtn');
const logEl = document.getElementById('log');
const resultsBody = document.getElementById('resultsBody');
const resultCountEl = document.getElementById('resultCount');
const openFolderBtn = document.getElementById('openFolderBtn');

let lastOutFile = null;

function appendLog(message) {
  const line = document.createElement('div');
  line.textContent = message;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function appendResultRow(record) {
  const row = document.createElement('tr');
  row.className = 'border-b border-slate-100';
  row.innerHTML = `
    <td class="py-1.5 pr-3">${escapeHtml(record.name)}</td>
    <td class="py-1.5 pr-3">${escapeHtml(record.category)}</td>
    <td class="py-1.5 pr-3">${escapeHtml(record.rating)} ${record.reviewCount ? `(${escapeHtml(record.reviewCount)})` : ''}</td>
    <td class="py-1.5 pr-3">${escapeHtml(record.phone)}</td>
    <td class="py-1.5 pr-3 truncate max-w-[180px]">${record.website ? `<a class="text-blue-600 hover:underline" href="${escapeHtml(record.website)}" target="_blank">${escapeHtml(record.website)}</a>` : ''}</td>
    <td class="py-1.5 pr-3">${record.emails && record.emails.length ? escapeHtml(record.emails.join(', ')) : '—'}</td>
  `;
  resultsBody.appendChild(row);
  resultCountEl.textContent = resultsBody.children.length;
}

window.api.onProgress((progress) => {
  if (progress.type === 'status') {
    appendLog(progress.message);
  } else if (progress.type === 'listing') {
    appendLog(`[${progress.index}/${progress.total}] ${progress.record.name || 'Unknown'}`);
    appendResultRow(progress.record);
  }
});

startBtn.addEventListener('click', async () => {
  const query = queryInput.value.trim();
  const maxResults = parseInt(maxResultsInput.value, 10) || 10;

  if (!query) {
    appendLog('Please enter a search query.');
    return;
  }

  startBtn.disabled = true;
  startBtn.textContent = 'Running...';
  openFolderBtn.disabled = true;
  logEl.innerHTML = '';
  resultsBody.innerHTML = '';
  resultCountEl.textContent = '0';

  const result = await window.api.startScrape(query, maxResults);

  startBtn.disabled = false;
  startBtn.textContent = 'Start';

  if (!result.ok) {
    appendLog(`Error: ${result.error}`);
    return;
  }

  lastOutFile = result.outFile;
  openFolderBtn.disabled = false;
});

openFolderBtn.addEventListener('click', () => {
  if (lastOutFile) window.api.showInFolder(lastOutFile);
});
