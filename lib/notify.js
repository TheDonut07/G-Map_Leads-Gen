const SEND_TIMEOUT = 10000;
const DISCORD_MAX_LENGTH = 2000;

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid URL';
  }
}

function buildPayload(url, message, details) {
  const host = hostOf(url);
  if (/(^|\.)discord(app)?\.com$/.test(host)) return { content: message.slice(0, DISCORD_MAX_LENGTH) };
  if (host === 'hooks.slack.com') return { text: message };
  return { text: message, ...details };
}

async function send(url, message, details) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(url, message, details)),
      signal: AbortSignal.timeout(SEND_TIMEOUT),
    });
    if (!res.ok) console.log(`   (webhook to ${hostOf(url)} failed: HTTP ${res.status})`);
  } catch (err) {
    console.log(`   (webhook to ${hostOf(url)} failed: ${err.cause?.code || err.name})`);
  }
}

function createNotifier(urls) {
  return async (message, details = {}) => {
    await Promise.all(urls.map((url) => send(url, message, details)));
  };
}

module.exports = { createNotifier };
