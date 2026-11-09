const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const { sanitizeForFilename, getISTParts, listingKey, withTimeout } = require('./lib/util');
const { scrapeQuery, blockUnneededRequests } = require('./lib/scrape');
const { writeBatchWorkbook } = require('./lib/excel');

const BROWSER_CLOSE_TIMEOUT = 15000;

function parseArgs() {
  const argv = process.argv.slice(2);
  let stopFlagPath = null;

  const emailsIdx = argv.indexOf('--emails');
  const scrapeEmails = emailsIdx !== -1;
  if (scrapeEmails) argv.splice(emailsIdx, 1);

  const showIdx = argv.indexOf('--show-browser');
  const showBrowser = showIdx !== -1;
  if (showBrowser) argv.splice(showIdx, 1);

  const stopIdx = argv.indexOf('--stop-flag');
  if (stopIdx !== -1) {
    stopFlagPath = argv[stopIdx + 1] || null;
    argv.splice(stopIdx, 2);
  }

  return { argv, stopFlagPath, scrapeEmails, showBrowser };
}

function loadRun(argv) {
  const mode = argv[0];

  if (mode === '--batch') {
    const batchPath = argv[1];
    if (!batchPath) {
      throw new Error('--batch requires a path to a JSON file');
    }
    const raw = fs.readFileSync(batchPath, 'utf-8');
    const parsed = JSON.parse(raw);

    let taskName = null;
    let rawTerms;
    if (Array.isArray(parsed)) {
      rawTerms = parsed;
    } else {
      taskName = parsed.taskName ? String(parsed.taskName).trim() : null;
      rawTerms = parsed.terms;
    }

    if (!Array.isArray(rawTerms) || rawTerms.length === 0) {
      throw new Error('Batch file must contain a non-empty array of { query, count }');
    }

    const terms = rawTerms
      .map((t) => {
        const parsedCount = parseInt(t.count, 10);
        return {
          query: String(t.query || '').trim(),
          count: Number.isFinite(parsedCount) ? parsedCount : 10,
          priorResults: Array.isArray(t.priorResults) ? t.priorResults : [],
        };
      })
      .filter((t) => t.query);

    return { terms, taskName };
  }

  const query = argv[0] || 'Appliance repair service in Sacramento, CA, USA';
  const count = parseInt(argv[1] || '10', 10);
  return { terms: [{ query, count, priorResults: [] }], taskName: null };
}

function batchBaseName(terms, startIST) {
  if (terms.length === 1) {
    return sanitizeForFilename(terms[0].query);
  }
  return `batch_${startIST.compact}_${terms.length}terms`;
}

function normalizeQuery(query) {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function loadSavedTerms(outFile) {
  if (!fs.existsSync(outFile)) return [];
  try {
    const saved = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    if (!Array.isArray(saved.terms)) return [];
    return saved.terms.filter((t) => t && t.query && Array.isArray(t.results));
  } catch (err) {
    const backup = `${outFile}.unreadable-${Date.now()}`;
    fs.renameSync(outFile, backup);
    console.log(`Existing results file could not be read (${err.message}). Moved it to ${backup}`);
    return [];
  }
}

function addRecords(entry, records) {
  for (const record of records) {
    const key = listingKey(record.mapsUrl);
    if (key && entry.keys.has(key)) continue;
    if (key) entry.keys.add(key);
    entry.results.push(record);
  }
}

// One entry per search term, seeded from the output file already on disk.
// `started` keeps terms this run hasn't reached out of the output.
function buildEntries(terms, savedTerms) {
  const entries = new Map();
  const entryFor = (query) => {
    const key = normalizeQuery(query);
    if (!entries.has(key)) {
      entries.set(key, { query, results: [], keys: new Set(), started: false });
    }
    return entries.get(key);
  };

  for (const saved of savedTerms) {
    const entry = entryFor(saved.query);
    addRecords(entry, saved.results);
    entry.started = true;
  }

  const plannedTerms = terms.map((term) => {
    const entry = entryFor(term.query);
    addRecords(entry, term.priorResults);
    return { query: term.query, entry, target: term.count + term.priorResults.length };
  });

  return { entries: [...entries.values()], plannedTerms };
}

function writeJsonSafely(file, data) {
  const json = JSON.stringify(data, null, 2);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, json, 'utf-8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, json, 'utf-8');
    fs.rmSync(tmp, { force: true });
  }
}

async function main() {
  const { argv, stopFlagPath, scrapeEmails, showBrowser } = parseArgs();
  const { terms, taskName } = loadRun(argv);

  const stopRequested = () => !!(stopFlagPath && fs.existsSync(stopFlagPath));

  const startTime = Date.now();
  const startIST = getISTParts(new Date(startTime));

  const resultsDir = path.join(__dirname, 'results');
  const excelDir = path.join(resultsDir, 'excel');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(excelDir, { recursive: true });

  const baseName = (taskName && sanitizeForFilename(taskName)) || batchBaseName(terms, startIST);
  const outFile = path.join(resultsDir, `${baseName}.json`);
  const excelFile = path.join(excelDir, `${baseName}.xlsx`);

  const { entries, plannedTerms } = buildEntries(terms, loadSavedTerms(outFile));

  let stoppedByUser = false;

  const savedEntries = () => entries.filter((e) => e.started);
  const countRecords = () => savedEntries().reduce((sum, e) => sum + e.results.length, 0);

  function saveJson() {
    const endTime = Date.now();
    const saved = savedEntries();
    writeJsonSafely(outFile, {
      taskName: taskName || baseName,
      terms: saved.map((e) => ({
        query: e.query,
        resultCount: e.results.length,
        results: e.results,
      })),
      termCount: saved.length,
      totalRecords: countRecords(),
      stoppedByUser,
      dateIST: startIST.date,
      startedAtIST: startIST.timestamp,
      endedAtIST: getISTParts(new Date(endTime)).timestamp,
      durationMinutes: Number(((endTime - startTime) / 60000).toFixed(2)),
    });
  }

  const needsScraping = plannedTerms.some((t) => t.target > t.entry.results.length);
  let browser = null;
  let context = null;
  let page = null;

  if (needsScraping) {
    const launchArgs = [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ];
    if (!showBrowser) {
      launchArgs.push('--window-position=-32000,-32000');
    }
    browser = await chromium.launch({ headless: false, args: launchArgs });
    context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
    });
    await blockUnneededRequests(context);
    page = await context.newPage();
    console.log(`Email scraping: ${scrapeEmails ? 'ON' : 'OFF'}`);
  }

  let runError = null;

  try {
    for (let i = 0; i < plannedTerms.length; i++) {
      const { query, entry, target } = plannedTerms[i];
      const label = `[Term ${i + 1}/${plannedTerms.length}]`;
      const remaining = target - entry.results.length;
      entry.started = true;

      if (remaining <= 0) {
        console.log(`\n${label} "${query}" already complete (${entry.results.length} record(s) carried over).`);
        continue;
      }

      const resumeNote = entry.results.length ? `, resuming with ${entry.results.length} already collected` : '';
      console.log(`\n${label} Searching Google Maps for: "${query}"  (target ${remaining} more result(s)${resumeNote})\n`);

      await scrapeQuery(page, context, query, remaining, {
        shouldStop: stopRequested,
        knownKeys: entry.keys,
        scrapeEmails,
        onRecord: (record) => {
          addRecords(entry, [record]);
          try {
            saveJson();
          } catch (err) {
            console.log(`   (could not save progress: ${err.message})`);
          }
        },
      });

      console.log(`${label} Done. ${entry.results.length} record(s) total.`);

      if (stopRequested()) {
        stoppedByUser = true;
        console.log('\nStop requested by user. Saving collected data now...\n');
        break;
      }
    }
  } catch (err) {
    runError = err;
    console.error('Run failed:', err);
  }

  if (browser) {
    await withTimeout(browser.close(), BROWSER_CLOSE_TIMEOUT, 'closing the browser').catch((err) => {
      console.log(`(${err.message})`);
    });
  }

  saveJson();

  let excelSaved = false;
  try {
    writeBatchWorkbook(savedEntries(), excelFile);
    excelSaved = true;
  } catch (err) {
    console.log(`Could not write the Excel file (is it open in Excel?): ${err.message}`);
  }

  const totalRecords = countRecords();
  const durationMinutes = Number(((Date.now() - startTime) / 60000).toFixed(2));
  const endIST = getISTParts(new Date());

  const donePrefix = runError
    ? 'Failed part-way; progress kept.'
    : stoppedByUser ? 'Stopped early by user.' : 'Done.';
  console.log(`\n${donePrefix} Saved ${totalRecords} record(s) across ${savedEntries().length} term(s) to ${outFile}`);
  if (excelSaved) console.log(`Saved excel workbook to ${excelFile}`);
  console.log(`Started: ${startIST.timestamp}  Ended: ${endIST.timestamp}  Duration: ${durationMinutes} min\n`);

  return runError ? 1 : 0;
}

main()
  .then((exitCode) => process.exit(exitCode))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
