const XLSX = require('xlsx');

function rowsForResults(results) {
  return results.map((r) => ({
    Name: r.name || '',
    Category: r.category || '',
    Rating: r.rating || '',
    Reviews: r.reviewCount || '',
    Phone: r.phone || '',
    Address: r.address || '',
    Website: r.website || '',
    Email: (r.emails && r.emails.length) ? r.emails.join(', ') : '',
    'Maps URL': r.mapsUrl || '',
  }));
}

// Excel sheet names: max 31 chars, no \ / * ? : [ ], and must be unique in the workbook.
function sheetNameFor(query, usedLower) {
  let base = (query || 'Sheet').trim().replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) base = 'Sheet';
  base = base.slice(0, 31);

  let name = base;
  let n = 2;
  while (usedLower.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  usedLower.add(name.toLowerCase());
  return name;
}

// termResults: [{ query, results }, ...] -> one workbook, one sheet per search term.
function writeBatchWorkbook(termResults, excelFile) {
  const workbook = XLSX.utils.book_new();
  const usedLower = new Set();

  for (const { query, results } of termResults) {
    const sheet = XLSX.utils.json_to_sheet(rowsForResults(results));
    const name = sheetNameFor(query, usedLower);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }

  XLSX.writeFile(workbook, excelFile);
}

module.exports = { writeBatchWorkbook };
