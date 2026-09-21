// Google Maps lead scraper — live console test (Playwright, headed/incognito)
//
// Single term:  node scraper.js "Appliance repair service in Sacramento, CA, USA" 10
// Batch:        node scraper.js --batch batch.json [--stop-flag stop.flag]
//
//               batch.json is either a plain array of { query, count }, or an object:
//               {
//                 "taskName": "...",                 // used as the output file base name
//                 "terms": [
//                   { "query": "...", "count": 10, "skip": 0, "priorResults": [] },
//                   ...
//                 ]
//               }
//               skip/priorResults let a "Continue" run resume a term without re-scraping
//               listings a previous run already collected; count 0 carries priorResults
//               forward untouched.
//
//               stop.flag: if this file exists, the run stops after the current listing
//               (and current term) and saves whatever was collected so far.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const { sanitizeForFilename, getISTParts } = require('./lib/util');
const { scrapeQuery } = require('./lib/scrape');
const { writeBatchWorkbook } = require('./lib/excel');

function parseArgs() {
  const argv = process.argv.slice(2);
  let stopFlagPath = null;

  const stopIdx = argv.indexOf('--stop-flag');
  if (stopIdx !== -1) {
    stopFlagPath = argv[stopIdx + 1] || null;
    argv.splice(stopIdx, 2);
  }

  return { argv, stopFlagPath };
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
          skip: parseInt(t.skip, 10) || 0,
          priorResults: Array.isArray(t.priorResults) ? t.priorResults : [],
        };
      })
      .filter((t) => t.query);

    return { terms, taskName };
  }

  const query = argv[0] || 'Appliance repair service in Sacramento, CA, USA';
  const count = parseInt(argv[1] || '10', 10);
  return { terms: [{ query, count, skip: 0, priorResults: [] }], taskName: null };
}

function batchBaseName(terms, startIST) {
  if (terms.length === 1) {
    return sanitizeForFilename(terms[0].query);
  }
  return `batch_${startIST.compact}_${terms.length}terms`;
}

async function main() {
  const { argv, stopFlagPath } = parseArgs();
  const { terms, taskName } = loadRun(argv);

  const stopRequested = () => !!(stopFlagPath && fs.existsSync(stopFlagPath));

  const startTime = Date.now();
  const startIST = getISTParts(new Date(startTime));

  const needsScraping = terms.some((t) => t.count > 0);
  let browser = null;
  let context = null;
  let page = null;

  if (needsScraping) {
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
    });
    page = await context.newPage();
  }

  const termResults = [];
  let stoppedByUser = false;

  for (let i = 0; i < terms.length; i++) {
    const { query, count, skip, priorResults } = terms[i];

    if (count <= 0) {
      termResults.push({ query, results: priorResults });
      console.log(`\n[Term ${i + 1}/${terms.length}] "${query}" already complete (${priorResults.length} record(s) carried over).`);
      continue;
    }

    const resumeNote = skip ? `, resuming after ${skip} already collected` : '';
    console.log(`\n[Term ${i + 1}/${terms.length}] Searching Google Maps for: "${query}"  (target ${count} more result(s)${resumeNote})\n`);

    const newResults = await scrapeQuery(page, context, query, count, stopRequested, skip);
    const results = [...priorResults, ...newResults];
    termResults.push({ query, results });

    console.log(`[Term ${i + 1}/${terms.length}] Done. ${results.length} record(s) total.`);

    if (stopRequested()) {
      stoppedByUser = true;
      console.log('\nStop requested by user. Saving collected data now...\n');
      break;
    }
  }

  if (browser) {
    await browser.close();
  }

  const endTime = Date.now();
  const endIST = getISTParts(new Date(endTime));
  const durationMinutes = Number(((endTime - startTime) / 60000).toFixed(2));

  const resultsDir = path.join(__dirname, 'results');
  const excelDir = path.join(resultsDir, 'excel');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(excelDir, { recursive: true });

  const baseName = (taskName && sanitizeForFilename(taskName)) || batchBaseName(terms, startIST);
  const outFile = path.join(resultsDir, `${baseName}.json`);
  const excelFile = path.join(excelDir, `${baseName}.xlsx`);

  const totalRecords = termResults.reduce((sum, t) => sum + t.results.length, 0);

  const output = {
    taskName: taskName || baseName,
    terms: termResults.map((t) => ({
      query: t.query,
      resultCount: t.results.length,
      results: t.results,
    })),
    termCount: termResults.length,
    totalRecords,
    stoppedByUser,
    dateIST: startIST.date,
    startedAtIST: startIST.timestamp,
    endedAtIST: endIST.timestamp,
    durationMinutes,
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');
  writeBatchWorkbook(termResults, excelFile);

  const donePrefix = stoppedByUser ? 'Stopped early by user.' : 'Done.';
  console.log(`\n${donePrefix} Saved ${totalRecords} record(s) across ${termResults.length} term(s) to ${outFile}`);
  console.log(`Saved excel workbook to ${excelFile}`);
  console.log(`Started: ${startIST.timestamp}  Ended: ${endIST.timestamp}  Duration: ${durationMinutes} min\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
