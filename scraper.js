// Google Maps lead scraper — live console test (Playwright, headed/incognito)
// Usage: node scraper.js "Appliance repair service in Sacramento, CA, USA" 10

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const EMAIL_REGEX = /[a-zA-Z0-9.\-_+]+@[a-zA-Z0-9.\-_]+\.[a-zA-Z]{2,}/g;
const IGNORE_EMAIL_SUFFIXES = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];

function cleanEmails(matches) {
  if (!matches) return [];
  const uniq = new Set();
  for (const m of matches) {
    const lower = m.toLowerCase();
    if (IGNORE_EMAIL_SUFFIXES.some((ext) => lower.endsWith(ext))) continue;
    if (lower.includes('example.com') || lower.includes('sentry.io') || lower.includes('wixpress.com')) continue;
    uniq.add(m);
  }
  return [...uniq];
}

async function extractEmailsFromPage(page) {
  try {
    const html = await page.content();
    const mailtoHrefs = await page.$$eval('a[href^="mailto:"]', (as) =>
      as.map((a) => a.getAttribute('href').replace('mailto:', '').split('?')[0])
    ).catch(() => []);
    const bodyMatches = html.match(EMAIL_REGEX) || [];
    return cleanEmails([...mailtoHrefs, ...bodyMatches]);
  } catch {
    return [];
  }
}

async function findContactLink(page) {
  try {
    const links = await page.$$eval('a[href]', (as) =>
      as
        .map((a) => ({ href: a.href, text: (a.textContent || '').toLowerCase() }))
        .filter((l) => l.href && l.href.startsWith('http'))
    );
    const keywords = ['contact', 'about', 'get-in-touch', 'reach-us'];
    const match = links.find((l) =>
      keywords.some((kw) => l.text.includes(kw) || l.href.toLowerCase().includes(kw))
    );
    return match ? match.href : null;
  } catch {
    return null;
  }
}

async function scrapeWebsiteForEmail(context, websiteUrl) {
  if (!websiteUrl) return [];
  const page = await context.newPage();
  let emails = [];
  try {
    await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    emails = await extractEmailsFromPage(page);

    if (emails.length === 0) {
      const contactUrl = await findContactLink(page);
      if (contactUrl) {
        await page.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        emails = await extractEmailsFromPage(page);
      }
    }
  } catch (err) {
    console.log(`   (website load failed: ${err.message.split('\n')[0]})`);
  } finally {
    await page.close().catch(() => {});
  }
  return emails;
}

async function autoScrollFeed(page, maxResults) {
  const feedSelector = 'div[role="feed"]';
  await page.waitForSelector(feedSelector, { timeout: 15000 });

  let lastCount = 0;
  let sameCountTries = 0;

  while (sameCountTries < 4) {
    const count = await page.$$eval(`${feedSelector} a.hfpxzc`, (as) => as.length);
    if (count >= maxResults) break;

    await page.$eval(feedSelector, (el) => el.scrollBy(0, el.scrollHeight));
    await page.waitForTimeout(1500 + Math.random() * 800);

    if (count === lastCount) {
      sameCountTries++;
    } else {
      sameCountTries = 0;
    }
    lastCount = count;
  }
}

async function getResultLinks(page, maxResults) {
  const links = await page.$$eval('div[role="feed"] a.hfpxzc', (as) =>
    as.map((a) => a.href)
  );
  return links.slice(0, maxResults);
}

function textOrNull(val) {
  return val && val.trim().length > 0 ? val.trim() : null;
}

function sanitizeForFilename(query) {
  return query
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
  };
}

async function scrapeListingDetails(page) {
  const name = await page
    .locator('h1.DUwDvf, h1.fontHeadlineLarge')
    .first()
    .textContent()
    .catch(() => null);

  const ratingText = await page
    .locator('div.F7nice span[aria-hidden="true"]')
    .first()
    .textContent()
    .catch(() => null);

  const reviewCountText = await page
    .locator('div.F7nice span[aria-label*="reviews" i]')
    .first()
    .getAttribute('aria-label')
    .catch(() => null);

  const address = await page
    .locator('button[data-item-id="address"]')
    .first()
    .getAttribute('aria-label')
    .catch(() => null);

  const phone = await page
    .locator('button[data-item-id^="phone:tel:"]')
    .first()
    .getAttribute('aria-label')
    .catch(() => null);

  const website = await page
    .locator('a[data-item-id="authority"]')
    .first()
    .getAttribute('href')
    .catch(() => null);

  const category = await page
    .locator('button.DkEaL')
    .first()
    .textContent()
    .catch(() => null);

  const reviewCount = reviewCountText
    ? (reviewCountText.match(/[\d,]+/) || [null])[0]?.replace(/,/g, '')
    : null;

  const phoneClean = phone ? phone.replace(/^Phone:\s*/i, '').trim() : null;
  const addressClean = address ? address.replace(/^Address:\s*/i, '').trim() : null;

  return {
    name: textOrNull(name),
    category: textOrNull(category),
    rating: textOrNull(ratingText),
    reviewCount: reviewCount,
    address: addressClean,
    phone: phoneClean,
    website: textOrNull(website),
  };
}

async function main() {
  const query = process.argv[2] || 'Appliance repair service in Sacramento, CA, USA';
  const maxResults = parseInt(process.argv[3] || '10', 10);

  console.log(`\nSearching Google Maps for: "${query}"  (target ${maxResults} results)\n`);

  const startTime = Date.now();
  const startIST = getISTParts(new Date(startTime));

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  await page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  // Dismiss consent dialog if present
  const consentButton = page.locator('button:has-text("Accept all")').first();
  if (await consentButton.isVisible().catch(() => false)) {
    await consentButton.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  await autoScrollFeed(page, maxResults);
  const links = await getResultLinks(page, maxResults);
  console.log(`Found ${links.length} listing(s). Visiting each...\n`);

  const results = [];

  for (let i = 0; i < links.length; i++) {
    const href = links[i];
    console.log(`[${i + 1}/${links.length}] Opening listing...`);
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const details = await scrapeListingDetails(page);
    let emails = [];
    if (details.website) {
      emails = await scrapeWebsiteForEmail(context, details.website);
    }

    const record = { ...details, emails, mapsUrl: href };
    results.push(record);

    console.log(`   Name:     ${record.name}`);
    console.log(`   Category: ${record.category}`);
    console.log(`   Rating:   ${record.rating}  (${record.reviewCount} reviews)`);
    console.log(`   Phone:    ${record.phone}`);
    console.log(`   Address:  ${record.address}`);
    console.log(`   Website:  ${record.website}`);
    console.log(`   Emails:   ${emails.length ? emails.join(', ') : 'none found'}`);
    console.log('');
  }

  const endTime = Date.now();
  const endIST = getISTParts(new Date(endTime));
  const durationMinutes = Number(((endTime - startTime) / 60000).toFixed(2));

  const resultsDir = path.join(__dirname, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const outFile = path.join(resultsDir, `${sanitizeForFilename(query)}.json`);

  const output = {
    query,
    resultCount: results.length,
    results,
    dateIST: startIST.date,
    startedAtIST: startIST.timestamp,
    endedAtIST: endIST.timestamp,
    durationMinutes,
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Done. Saved ${results.length} records to ${outFile}`);
  console.log(`Started: ${startIST.timestamp}  Ended: ${endIST.timestamp}  Duration: ${durationMinutes} min\n`);

  await browser.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
