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

Output is printed live to the console as each listing is processed, and the full run is also saved to `results/<sanitized-search-keyword>.json`.

The filename is derived from the search keyword — spaces become `_`, commas become `-`. For example:

```
"Appliance repair service in Sacramento, CA, USA"
→ results/Appliance_repair_service_in_Sacramento-CA-USA.json
```

Running the same search again overwrites that file.

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
