# G-Map Leads Gen

## What this is

A personal-use lead-generation tool that scrapes Google Maps search results (e.g. "Appliance repair service in Sacramento, CA, USA") and collects business contact data: name, category, rating, review count, address, phone, website, and email (extracted by visiting the business's own website).

## How it works

1. Launches a Playwright-controlled Chromium browser (headed, so the run is visible) against `google.com/maps/search/<query>`.
2. Scrolls the results feed to load listings up to the requested count.
3. Visits each listing's detail page and extracts the business fields directly from the Maps DOM.
4. If a website URL is present, opens it in a separate tab and scans the homepage (falling back to a Contact/About page) for email addresses.
5. Writes results to a JSON file, along with run metadata (search query, timestamps, duration).

## Tech stack

- Node.js
- Playwright (Chromium)

## Entry point

`scraper.js`, run as `node scraper.js "<search keyword>" <number of results>`.

## Intended use

Personal project — pulling small-to-medium batches of local business leads for a given search term, not high-volume/continuous scraping.
