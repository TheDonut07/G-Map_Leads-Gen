# G-Map Leads Gen

Personal-use Google Maps scraper built with Playwright. Searches a keyword (e.g. business type + location), visits each result, and pulls contact/lead data — including attempting to find an email by opening the business website in a new tab.

Runs headed (visible browser window) so you can watch it work and catch issues (captchas, layout changes) live.

## Requirements

- Node.js
- Playwright (installed via `npm install`, with Chromium fetched via `npx playwright install chromium`)

## Usage

```
node scraper.js "<search keyword>" <number of results>
```

Example:

```
node scraper.js "Appliance repair service in Sacramento, CA, USA" 10
```

- `<search keyword>` — the Google Maps search query (business type + location works best)
- `<number of results>` — how many listings to scrape (default: 10 if omitted)

Output is printed live to the console as each listing is processed, and the full run is also saved to `results/<sanitized-search-keyword>.json`, with a trimmed-down Excel copy saved to `results/excel/<sanitized-search-keyword>.xlsx`.

The filename is derived from the search keyword — spaces become `_`, commas become `-`. For example:

```
"Appliance repair service in Sacramento, CA, USA"
→ results/Appliance_repair_service_in_Sacramento-CA-USA.json
→ results/excel/Appliance_repair_service_in_Sacramento-CA-USA.xlsx
```

Running the same search again overwrites both files.

## GUI (gui.py)

A Tkinter front-end that shells out to `node scraper.js` and streams its output live. It shows a running elapsed timer while a scrape is in progress, reports total time taken once it finishes, and has buttons to open the results folder or the generated Excel file.

```
python gui.py
```

Requires Node.js and the npm dependencies installed as above; `gui.py` just drives `scraper.js`, it doesn't reimplement the scraping.

### Building GMapLeadsGen.exe

The GUI is also distributed as a standalone Windows executable, built with [PyInstaller](https://pyinstaller.org/) (`pip install pyinstaller` if you don't have it).

Whenever you change `gui.py`, rebuild the exe by running:

```
build.bat
```

This runs PyInstaller, copies the fresh `dist\GMapLeadsGen.exe` over the one at the project root, and cleans up the leftover `build/`, `dist/`, and `.spec` files.

Note: `GMapLeadsGen.exe` only bundles the GUI — it still shells out to `node scraper.js` at runtime, so Node.js and this project's npm dependencies (`playwright`, `xlsx`) must be present next to it.

## Data collected

Per listing (inside the `results` array):

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

Run metadata (top-level fields, added at the end of the JSON file):

| Field | Description |
|---|---|
| `query` | The search keyword used |
| `resultCount` | Number of listings scraped |
| `dateIST` | Date the run started, in IST (`YYYY-MM-DD`) |
| `startedAtIST` | Timestamp the run started, in IST |
| `endedAtIST` | Timestamp the run finished, in IST |
| `durationMinutes` | Total time the run took, in minutes |

## Notes

- Email extraction is best-effort — not every business exposes an email on their site, so `emails` may be an empty array.
- Google Maps' page structure isn't versioned, so scraper selectors may break if Google changes their layout.
- Pulling large volumes of results or running many searches back-to-back increases the chance of hitting a captcha. Scroll/navigation delays are randomized to reduce this risk.
- For personal use only — review Google's Terms of Service before scraping at scale.
