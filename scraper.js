// Google Maps lead scraper — live console test (Playwright, headed/incognito)
//
// Single term:  node scraper.js "Appliance repair service in Sacramento, CA, USA" 10
// Batch:        node scraper.js --batch batch.json [--stop-flag stop.flag]
//               batch.json: [{ "query": "...", "count": 10 }, ...]
//               stop.flag: if this file exists, the run stops after the current
//               listing (and current term) and saves whatever was collected so far.

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

function parseTerms(argv) {
  const mode = argv[0];

  if (mode === '--batch') {
    const batchPath = argv[1];
    if (!batchPath) {
      throw new Error('--batch requires a path to a JSON file of [{ query, count }, ...]');
    }
    const raw = fs.readFileSync(batchPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Batch file must contain a non-empty array of { query, count }');
    }
    return parsed.map((t) => ({
      query: String(t.query || '').trim(),
      count: parseInt(t.count, 10) || 10,
    })).filter((t) => t.query);
  }

  const query = argv[0] || 'Appliance repair service in Sacramento, CA, USA';
  const count = parseInt(argv[1] || '10', 10);
  return [{ query, count }];
}

function batchBaseName(terms, startIST) {
  if (terms.length === 1) {
    return sanitizeForFilename(terms[0].query);
  }
  return `batch_${startIST.compact}_${terms.length}terms`;
}

async function main() {
  const { argv, stopFlagPath } = parseArgs();
  const terms = parseTerms(argv);

  const stopRequested = () => !!(stopFlagPath && fs.existsSync(stopFlagPath));

  const startTime = Date.now();
  const startIST = getISTParts(new Date(startTime));

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const termResults = [];
  let stoppedByUser = false;

  for (let i = 0; i < terms.length; i++) {
    const { query, count } = terms[i];
    console.log(`\n[Term ${i + 1}/${terms.length}] Searching Google Maps for: "${query}"  (target ${count} results)\n`);

    const results = await scrapeQuery(page, context, query, count, stopRequested);
    termResults.push({ query, results });

    console.log(`[Term ${i + 1}/${terms.length}] Done. ${results.length} record(s).`);

    if (stopRequested()) {
      stoppedByUser = true;
      console.log('\nStop requested by user. Saving collected data now...\n');
      break;
    }
  }

  await browser.close();

  const endTime = Date.now();
  const endIST = getISTParts(new Date(endTime));
  const durationMinutes = Number(((endTime - startTime) / 60000).toFixed(2));

  const resultsDir = path.join(__dirname, 'results');
  const excelDir = path.join(resultsDir, 'excel');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(excelDir, { recursive: true });

  const baseName = batchBaseName(terms, startIST);
  const outFile = path.join(resultsDir, `${baseName}.json`);
  const excelFile = path.join(excelDir, `${baseName}.xlsx`);

  const totalRecords = termResults.reduce((sum, t) => sum + t.results.length, 0);

  const output = {
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
