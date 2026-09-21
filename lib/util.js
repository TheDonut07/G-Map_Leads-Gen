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

module.exports = { textOrNull, sanitizeForFilename, getISTParts };
