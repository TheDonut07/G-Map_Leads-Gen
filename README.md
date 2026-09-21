# G-Map Leads Gen

Personal-use Google Maps lead scraper built with Playwright. Give it one or many search terms (e.g. business type + location), and it visits each result, pulling contact/lead data — including attempting to find an email by opening the business website in a new tab.

Runs headed (visible browser window) so you can watch it work and catch issues (captchas, layout changes) live.

**Highlights**

- **Bulk search terms** — queue up to 50 search terms, each with its own result count; they run top to bottom.
- **One workbook per task** — all terms land in a single Excel file (one sheet per term) plus one combined JSON.
- **Task naming** — name the task and it becomes the output filename (or let it default to `SearchTerms<N>_<date>`).
- **Stop & Save / Continue** — stop mid-run without losing data, then pick up exactly where you left off.
- **GUI or CLI** — a Tkinter desktop app, or drive `scraper.js` directly from the terminal.

## Installation

### Option A — Ready-to-use package (Windows, recommended)

For anyone who just wants to run the tool. Download `GMapLeadsGen.zip` from the [Releases page](https://github.com/TheDonut07/G-Map_Leads-Gen/releases) (see [Sharing it](#sharing-it-with-someone-else) for how it's produced).

1. Install [Node.js](https://nodejs.org/) (LTS version) if you don't have it.
2. Download and unzip `GMapLeadsGen.zip` from Releases somewhere permanent (e.g. `C:\GMapLeadsGen`). Keep all the files together in one folder.
3. Double-click `setup.bat`. It checks for Node.js, runs `npm install`, and downloads Playwright's Chromium browser (needs internet; can take a few minutes the first time). You only need to do this once.
4. Double-click `GMapLeadsGen.exe` to launch the app.

Results are written to a `results/` folder next to the exe.

### Option B — Run from source

Requirements:

- [Node.js](https://nodejs.org/) (LTS)
- Python 3.9+ (only needed for the GUI)

```
git clone <this repo>
cd G-Map_Leads-Gen

# Scraper dependencies (playwright, xlsx) + Chromium
npm install
npx playwright install chromium

# GUI dependency (Pillow, for the logo/background)
pip install -r requirements.txt
```

You can now use either the [CLI](#cli-usage) or the [GUI](#gui-usage) (`python gui.py`).

## GUI usage

```
python gui.py
```

(or double-click `GMapLeadsGen.exe` if you're using the packaged version.)

The GUI is only a front-end: it writes your search terms to a small batch file and runs `node scraper.js --batch ...`, streaming the scraper's output into the log. All scraping logic lives in `scraper.js` and `lib/`.

### Running a search

1. **Enter search terms.** Each row is a search term plus the number of results you want for it. The results field accepts whole numbers only. The grey text in an empty term field is just a hint — it disappears when you start typing.
2. **Add more terms.** Click **+ Add search term** to add a row (up to **50**). Use the red **-** button on a row to remove it. On wide/maximized windows the rows flow into multiple columns so the space is used; the row list scrolls independently of the log.
3. **Name the task (optional).** The **Task name** field at the bottom of the window becomes the filename for the JSON and Excel output. Leave it blank and it defaults to the number of search terms plus today's date, e.g. `SearchTerms14_21September2026` (the grey placeholder updates live as you add/remove rows). Spaces become `_` and commas become `-`; characters that aren't valid in filenames are dropped.
4. **Click Run.** Terms are processed as a queue, top to bottom, in a single browser session. The status line shows progress (`Running... (2/5 terms)`) and the timer shows elapsed time.
5. **Get your results.** When it finishes, **Open results folder** and **Open Excel result** light up. Everything is saved as one JSON file and one Excel workbook with **one sheet per search term** (sheet names are the search term, trimmed to Excel's 31-character limit, with `(2)`, `(3)`... added if two terms would collide).

### Stop & Save

Only need 5 of the 11 results you asked for? Click **Stop & Save** during a run. The scraper finishes the listing it's currently on, then saves everything collected so far to the normal JSON and Excel files — nothing is lost. The status line will read "Stopped by user — partial results saved."

Stopping takes effect between listings, so if it's still loading a search's result feed it may take a few seconds to respond.

### Continue

After a Stop & Save, the **Run** button becomes **Continue**. Clicking it resumes the same task:

- Terms that were already fully collected are not re-scraped.
- A partially collected term only fetches the *remaining* listings (e.g. 5 of 11 done → it scrapes the next 6, skipping the 5 already saved).
- Terms that never started run normally.
- Results are merged back into the **same** task-name files, and the log keeps its history.
- The Task name field is locked while in Continue mode so the output file can't change mid-task.

You can Stop & Save and Continue repeatedly. Once a run completes all the way through, the button goes back to **Run** for the next task.

Things to know:

- Continue matches previous progress to your rows by the search-term **text**. If you change a term's text, it is treated as a new term. If you remove a row before continuing, that term's previously saved results are dropped from the merged output.
- To resume a partial term, Continue skips the first *N* results Google Maps shows for that search. This assumes Maps returns results in the same order as the earlier run, which is usually but not always true.

## CLI usage

The scraper can be used directly without the GUI.

### Single search term

```
node scraper.js "<search keyword>" <number of results>
```

Example:

```
node scraper.js "Appliance repair service in Sacramento, CA, USA" 10
```

- `<search keyword>` — the Google Maps search query (business type + location works best)
- `<number of results>` — how many listings to scrape (default: 10 if omitted)

Output is printed live to the console. The run is saved to `results/<sanitized-search-keyword>.json`, with an Excel copy at `results/excel/<sanitized-search-keyword>.xlsx`. The filename comes from the keyword — spaces become `_`, commas become `-`:

```
"Appliance repair service in Sacramento, CA, USA"
→ results/Appliance_repair_service_in_Sacramento-CA-USA.json
→ results/excel/Appliance_repair_service_in_Sacramento-CA-USA.xlsx
```

Running the same search again overwrites both files.

### Batch (multiple search terms)

```
node scraper.js --batch <batch.json> [--stop-flag <flag-file>]
```

`batch.json` can be a plain array of terms:

```json
[
  { "query": "Appliance repair service in Sacramento, CA, USA", "count": 10 },
  { "query": "Plumber in Sacramento, CA, USA", "count": 5 }
]
```

or an object that also names the task (the name becomes the output filename):

```json
{
  "taskName": "Sacramento_home_services",
  "terms": [
    { "query": "Appliance repair service in Sacramento, CA, USA", "count": 10 },
    { "query": "Plumber in Sacramento, CA, USA", "count": 5 }
  ]
}
```

Terms run in order in one browser session and produce one JSON file and one Excel workbook (a sheet per term). With no `taskName`, a single-term batch is named after its keyword and a multi-term batch is named `batch_<timestamp>_<N>terms`.

**Stopping early.** If you pass `--stop-flag <path>`, the scraper checks for that file between listings. Create the file (e.g. `echo. > stop.flag`) and the run stops after the current listing and saves what it has, printing `Stopped early by user.` in the summary line. This is how the GUI's Stop & Save works.

**Resuming.** Each term entry may also carry `skip` (how many listings a previous run already collected) and `priorResults` (those collected records). `count` is then the number of *additional* listings to fetch; `count: 0` carries `priorResults` through untouched without scraping. The GUI's Continue builds exactly this.

## Output

Files are written under `results/`:

| File | Contents |
|---|---|
| `results/<name>.json` | Full run data (see below) |
| `results/excel/<name>.xlsx` | Trimmed Excel copy — one sheet per search term |

`<name>` is the task name (GUI/batch) or the sanitized search keyword (single-term CLI).

Excel columns: Name, Category, Rating, Reviews, Phone, Address, Website, Email, Maps URL.

### Data collected

Per listing (inside each term's `results` array):

| Field | Description |
|---|---|
| `name` | Business name |
| `category` | Business category as shown on Google Maps |
| `rating` | Star rating (e.g. `4.9`) |
| `reviewCount` | Number of reviews |
| `address` | Full address |
| `phone` | Phone number |
| `website` | Business website URL (from Google Maps listing) |
| `emails` | Email address(es) found by scanning the website's homepage, falling back to a Contact/About page if none found on the homepage |
| `mapsUrl` | Direct Google Maps URL for the listing |

Run metadata (top-level fields of the JSON file):

| Field | Description |
|---|---|
| `taskName` | The task name used for the filename |
| `terms` | Array of `{ query, resultCount, results }`, one entry per search term |
| `termCount` | Number of search terms in the file |
| `totalRecords` | Total listings across all terms |
| `stoppedByUser` | `true` if the run was ended with Stop & Save |
| `dateIST` | Date the run started, in IST (`YYYY-MM-DD`) |
| `startedAtIST` | Timestamp the run started, in IST |
| `endedAtIST` | Timestamp the run finished, in IST |
| `durationMinutes` | Total time the run took, in minutes |

## Project layout

```
scraper.js      Entry point: CLI parsing, term queue, stop handling, writes output
lib/scrape.js   Playwright scraping (Maps listings, website email lookup)
lib/excel.js    Builds the multi-sheet Excel workbook
lib/util.js     Filename sanitizing and IST timestamp helpers
gui.py          Tkinter front-end (drives scraper.js)
assets/         logo.png (icon) and background.png (GUI background)
build.bat       Builds GMapLeadsGen.exe and GMapLeadsGen.zip
setup.bat       One-time setup for the packaged version
```

## Building GMapLeadsGen.exe

The GUI is distributed as a standalone Windows executable built with [PyInstaller](https://pyinstaller.org/) (`pip install pyinstaller` if you don't have it).

Whenever you change `gui.py` or the files in `assets/`, rebuild by running:

```
build.bat
```

This runs PyInstaller (bundling `assets/` into the exe and using `assets/logo.png` as its icon), copies the fresh exe to the project root, cleans up `build/`, `dist/` and the `.spec` file, and packages everything needed to share into `GMapLeadsGen.zip`.

Note: the exe only bundles the GUI. It still runs `node scraper.js` at runtime, so Node.js, `scraper.js`, `lib/` and the npm dependencies (`playwright`, `xlsx`) must be present next to it — which is what the zip and `setup.bat` provide.

### Branding (assets/)

- `assets/logo.png` — window/taskbar icon and the exe's own icon.
- `assets/background.png` — stretched to fill the window as a background, rescaling live as the window is resized.

Swap either file for your own image (same filenames) and rebuild.

### Sharing it with someone else

`GMapLeadsGen.zip` (produced by `build.bat`) contains everything needed to hand off the tool: `GMapLeadsGen.exe`, `scraper.js`, the `lib/` folder, `package.json`, `package-lock.json`, and `setup.bat`. The zip is published on the [Releases page](https://github.com/TheDonut07/G-Map_Leads-Gen/releases) — send people there, or send them the zip directly, and point them at [Option A](#option-a--ready-to-use-package-windows-recommended) above.

## Notes

- Email extraction is best-effort — not every business exposes an email on their site, so `emails` may be an empty array.
- Google Maps' page structure isn't versioned, so scraper selectors may break if Google changes their layout.
- Pulling large volumes of results or running many searches back-to-back increases the chance of hitting a captcha. Scroll/navigation delays are randomized to reduce this risk.
- Reusing a task name (or running the same single search again) overwrites the previous output files with that name.
- For personal use only — review Google's Terms of Service before scraping at scale.

![G-Map Leads Gen background](assets/background.png)
