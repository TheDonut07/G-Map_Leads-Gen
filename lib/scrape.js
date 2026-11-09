const { textOrNull, listingKey, withTimeout } = require('./util');

const EMAIL_REGEX = /[a-zA-Z0-9.\-_+]+@[a-zA-Z0-9.\-_]+\.[a-zA-Z]{2,}/g;
const IGNORE_EMAIL_SUFFIXES = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
const FIELD_TIMEOUT = 1500;
const PAGE_CALL_TIMEOUT = 15000;

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);
const BLOCKED_URL_PATTERNS = [
  /google-analytics\.com/,
  /googletagmanager\.com/,
  /doubleclick\.net/,
  /googlesyndication\.com/,
  /\/maps\/vt/,
  /\/maps\/preview\/log/,
  /\/gen_204/,
  /\/log\?format=json/,
];

async function blockUnneededRequests(context) {
  await context.route('**/*', (route) => {
    const req = route.request();
    if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) return route.abort();
    const url = req.url();
    if (BLOCKED_URL_PATTERNS.some((re) => re.test(url))) return route.abort();
    return route.continue();
  });
}

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
    const html = await withTimeout(page.content(), PAGE_CALL_TIMEOUT, 'reading website content');
    const mailtoHrefs = await withTimeout(
      page.$$eval('a[href^="mailto:"]', (as) =>
        as.map((a) => a.getAttribute('href').replace('mailto:', '').split('?')[0])
      ),
      PAGE_CALL_TIMEOUT,
      'reading mailto links'
    ).catch(() => []);
    const bodyMatches = html.match(EMAIL_REGEX) || [];
    return cleanEmails([...mailtoHrefs, ...bodyMatches]);
  } catch {
    return [];
  }
}

async function findContactLink(page) {
  try {
    const links = await withTimeout(
      page.$$eval('a[href]', (as) =>
        as
          .map((a) => ({ href: a.href, text: (a.textContent || '').toLowerCase() }))
          .filter((l) => l.href && l.href.startsWith('http'))
      ),
      PAGE_CALL_TIMEOUT,
      'reading website links'
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
  let page;
  try {
    page = await withTimeout(context.newPage(), PAGE_CALL_TIMEOUT, 'opening a website tab');
  } catch (err) {
    console.log(`   (website load failed: ${err.message.split('\n')[0]})`);
    return [];
  }
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
    await withTimeout(page.close(), PAGE_CALL_TIMEOUT, 'closing a website tab').catch(() => {});
  }
  return emails;
}

async function readNewLinks(page, knownKeys, maxResults) {
  const hrefs = await withTimeout(
    page.$$eval('div[role="feed"] a.hfpxzc', (as) => as.map((a) => a.href)),
    PAGE_CALL_TIMEOUT,
    'reading the results list'
  );

  const seen = new Set(knownKeys);
  const links = [];
  for (const href of hrefs) {
    const key = listingKey(href);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(href);
  }
  return { links: links.slice(0, maxResults), total: hrefs.length };
}

async function autoScrollFeed(page, knownKeys, maxResults, shouldStop) {
  const feedSelector = 'div[role="feed"]';
  await page.waitForSelector(feedSelector, { timeout: 15000 });

  let bestTotal = 0;
  let stalledTries = 0;

  while (stalledTries < 4) {
    if (shouldStop && shouldStop()) return;

    const { links, total } = await readNewLinks(page, knownKeys, maxResults);
    if (links.length >= maxResults) break;

    await withTimeout(
      page.$eval(feedSelector, (el) => el.scrollBy(0, el.scrollHeight)),
      PAGE_CALL_TIMEOUT,
      'scrolling the results list'
    );
    await page.waitForTimeout(900 + Math.random() * 500);

    if (total > bestTotal) {
      bestTotal = total;
      stalledTries = 0;
    } else {
      stalledTries++;
    }
  }
}

async function scrapeListingDetails(page) {
  const name = await page
    .locator('h1.DUwDvf, h1.fontHeadlineLarge')
    .first()
    .textContent({ timeout: FIELD_TIMEOUT })
    .catch(() => null);

  const ratingText = await page
    .locator('div.F7nice span[aria-hidden="true"]')
    .first()
    .textContent({ timeout: FIELD_TIMEOUT })
    .catch(() => null);

  const reviewCountText = await page
    .locator('div.F7nice span[aria-label*="reviews" i]')
    .first()
    .getAttribute('aria-label', { timeout: FIELD_TIMEOUT })
    .catch(() => null);

  const address = await page
    .locator('button[data-item-id="address"]')
    .first()
    .getAttribute('aria-label', { timeout: FIELD_TIMEOUT })
    .catch(() => null);

  const phone = await page
    .locator('button[data-item-id^="phone:tel:"]')
    .first()
    .getAttribute('aria-label', { timeout: FIELD_TIMEOUT })
    .catch(() => null);

  const website = await page
    .locator('a[data-item-id="authority"]')
    .first()
    .getAttribute('href', { timeout: FIELD_TIMEOUT })
    .catch(() => null);

  const category = await page
    .locator('button.DkEaL')
    .first()
    .textContent({ timeout: FIELD_TIMEOUT })
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

async function scrapeQuery(page, context, query, maxResults, { shouldStop = null, knownKeys = new Set(), scrapeEmails = false, onRecord = null } = {}) {
  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  await page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const consentButton = page.locator('button:has-text("Accept all")').first();
  await page
    .waitForSelector('div[role="feed"], button:has-text("Accept all")', { timeout: 15000 })
    .catch(() => {});
  if (await withTimeout(consentButton.isVisible(), PAGE_CALL_TIMEOUT, 'checking the consent prompt').catch(() => false)) {
    await consentButton.click().catch(() => {});
    await page.waitForSelector('div[role="feed"]', { timeout: 15000 }).catch(() => {});
  }

  await autoScrollFeed(page, knownKeys, maxResults, shouldStop);

  if (shouldStop && shouldStop()) {
    console.log('Stop requested before visiting listings for this term.\n');
    return;
  }

  const { links } = await readNewLinks(page, knownKeys, maxResults);
  const savedNote = knownKeys.size ? ` (ignoring ${knownKeys.size} already saved)` : '';
  console.log(`Found ${links.length} new listing(s)${savedNote}. Visiting each...\n`);

  for (let i = 0; i < links.length; i++) {
    const href = links[i];
    console.log(`[${i + 1}/${links.length}] Opening listing...`);
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForSelector('h1.DUwDvf, h1.fontHeadlineLarge', { timeout: 10000 }).catch(() => {});
    await page
      .waitForSelector('button[data-item-id="address"], button[data-item-id^="phone:tel:"], a[data-item-id="authority"]', { timeout: 3000 })
      .catch(() => {});

    const details = await scrapeListingDetails(page);
    let emails = [];
    if (scrapeEmails && details.website) {
      emails = await scrapeWebsiteForEmail(context, details.website);
    }

    const record = { ...details, emails, mapsUrl: href };
    if (onRecord) onRecord(record);

    console.log(`   Name:     ${record.name}`);
    console.log(`   Category: ${record.category}`);
    console.log(`   Rating:   ${record.rating}  (${record.reviewCount} reviews)`);
    console.log(`   Phone:    ${record.phone}`);
    console.log(`   Address:  ${record.address}`);
    console.log(`   Website:  ${record.website}`);
    if (scrapeEmails) {
      console.log(`   Emails:   ${emails.length ? emails.join(', ') : 'none found'}`);
    }
    console.log('');

    if (shouldStop && shouldStop()) {
      console.log(`Stop requested — stopping after ${i + 1}/${links.length} listing(s) for this term.\n`);
      break;
    }
  }
}

module.exports = { scrapeQuery, blockUnneededRequests };
