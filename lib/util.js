function textOrNull(val) {
  return val && val.trim().length > 0 ? val.trim() : null;
}

function sanitizeForFilename(text) {
  return text
    .trim()
    .replace(/,\s*/g, '-')
    .replace(/\s+/g, '_')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/-+/g, '-')
    .replace(/_+/g, '_');
}

function getISTParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map = {};
  for (const p of parts) map[p.type] = p.value;

  return {
    date: `${map.year}-${map.month}-${map.day}`,
    timestamp: `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} IST`,
    compact: `${map.year}${map.month}${map.day}_${map.hour}${map.minute}${map.second}`,
  };
}

// Maps URLs carry session-specific query params, so identify a listing by the
// place ID embedded in the URL (e.g. !1s0x3ba35b03a04bac51:0x6b120b088a799e21).
function listingKey(url) {
  if (!url) return null;
  const match = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  return match ? match[1].toLowerCase() : url.split('?')[0];
}

// Playwright's evaluate-style calls have no timeout and hang forever on a frozen page.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { textOrNull, sanitizeForFilename, getISTParts, listingKey, withTimeout };
