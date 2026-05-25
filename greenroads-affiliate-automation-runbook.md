# Greenroads AWIN Publisher Contact Scraper

## Current Workflow

The first production step is now one focused n8n workflow:

**Greenroads - AWIN Publisher Contact Scraper**

- n8n workflow ID: `PPmHfJ996Ki2VEAk`
- Status: inactive
- Validation: passed
- Purpose: pull active Greenroads publishers from AWIN, find each publisher's website/contact pages, extract contact emails and social links, and save the results to Google Sheets.
- Green Roads AWIN advertiser ID from the AWIN UI: `81733`
- Target publishers: the workflow now uses the Green Roads publisher IDs visible in the provided AWIN Performance Report screenshots.

I left the previous five inactive workflows untouched because deleting workflows is permanent.

## Data Flow

1. **Manual Start**
   - Runs the scraper on demand while testing.

2. **AWIN - Get Active Publishers**
   - Calls AWIN's advertiser publisher endpoint:
     `/advertisers/{advertiserId}/publishers`
   - AWIN's documented response includes publisher ID, name, primary region, sales regions, and primary promotion type.

3. **Scrape Publisher Contacts**
   - Uses the embedded Green Roads target publisher list from the screenshots.
   - Cross-checks against AWIN publisher records when AWIN returns matching publisher IDs.
   - Optionally scrapes an authenticated AWIN publisher profile page if these variables are set:
     - `AWIN_PLATFORM_COOKIE`
     - `AWIN_PUBLISHER_PROFILE_URL_TEMPLATE`
   - If no direct website is available from AWIN, searches for the publisher's official website through Apify.
   - Crawls likely contact/about/partnership/media pages through Apify.
   - Extracts:
     - preferred email
     - all discovered emails
     - contact page
     - social links
     - website domain
     - scrape status

4. **Sheets - Save Publisher Contacts**
   - Appends results to `awin_publisher_contacts`.

## Google Sheet Tab

Create a tab named:

`awin_publisher_contacts`

Headers:

`publisher_id, publisher_name, primary_region, sales_regions, primary_type, website_url, domain, email, all_emails, contact_page, social_links, awin_profile_url, scrape_status, scrape_error, scraped_pages, scraped_at`

## Required n8n Variables

- `AWIN_ADVERTISER_ID`
  - Optional for this workflow because the AWIN node now falls back to Green Roads advertiser ID `81733`.
  - Still recommended to set it explicitly.
- `AWIN_API_TOKEN`
- `APIFY_TOKEN`
- `GOOGLE_SHEET_ID`

## Optional n8n Variables

- `AWIN_CONTACT_LIMIT`
  - Default: `10`
  - Use a low value for first tests.

- `APIFY_SEARCH_ACTOR`
  - Default: `apify~google-search-scraper`

- `APIFY_CONTACT_ACTOR`
  - Default: `apify~website-content-crawler`

- `APIFY_REQUEST_DELAY_MS`
  - Default: `8000`
  - Wait time before Apify/API retry-sensitive requests.

- `APIFY_PUBLISHER_DELAY_MS`
  - Default: `12000`
  - Wait time between publishers.

- `APIFY_MAX_RETRIES`
  - Default: `4`
  - Retries 429, 408, network errors, and 5xx responses with exponential backoff.

- `APIFY_MAX_CRAWL_PAGES`
  - Default: `4`
  - Keeps each publisher crawl small to avoid actor and website rate limits.

- `AWIN_PLATFORM_COOKIE`
  - Optional authenticated AWIN browser cookie if you want to scrape logged-in AWIN profile pages.

- `AWIN_PUBLISHER_PROFILE_URL_TEMPLATE`
  - Optional AWIN profile URL template.
  - Must contain `{publisherId}`.
  - Example format: `https://.../{publisherId}/...`

## Credentials

Attach a Google API credential to:

- `Sheets - Save Publisher Contacts`

The AWIN and Apify calls currently use n8n variables, not stored credentials.

## Testing

1. Create the `awin_publisher_contacts` tab and headers.
2. Set `AWIN_CONTACT_LIMIT=3` for the first test.
3. Add the required n8n variables.
4. Attach Google API credentials to the Sheets node.
5. Run the workflow manually.
6. Review rows for contact quality.
7. Raise `AWIN_CONTACT_LIMIT` gradually after successful tests.

## Rate Limit Protection

The workflow is intentionally conservative:

- AWIN is called once per workflow execution.
- Publishers are processed sequentially, not in parallel.
- The default publisher limit is `10` per run.
- Apify calls wait by default before retry-sensitive requests.
- The workflow waits by default between publishers.
- 429, 408, network, and 5xx errors retry with exponential backoff.
- If retries are exhausted, the row is still written with `scrape_status=RATE_LIMITED` or an error note instead of repeatedly hammering the API.

Recommended safe settings while testing:

- `AWIN_CONTACT_LIMIT=3`
- `APIFY_REQUEST_DELAY_MS=10000`
- `APIFY_PUBLISHER_DELAY_MS=15000`
- `APIFY_MAX_RETRIES=4`
- `APIFY_MAX_CRAWL_PAGES=3`

After a clean test, increase only `AWIN_CONTACT_LIMIT` slowly. If Apify or target sites start returning 429s, increase the delay variables instead of raising the limit.

## Target Publisher List

The workflow currently includes 126 publisher IDs/names visible in the screenshots. The AWIN UI footer shows `Rows: 139`, so 13 rows may not be represented if they were not visible in the screenshots.

For a complete 139-row scrape, export the AWIN Publisher Performance table as CSV/XLSX or provide screenshots of the missing rows. Then update the embedded target list in the `Scrape Publisher Contacts` Code node.

The workflow processes the embedded list in order and stops at `AWIN_CONTACT_LIMIT` per run. For example:

- `AWIN_CONTACT_LIMIT=10` scrapes the first 10 target publishers.
- Increase the limit gradually or move already-scraped rows out of the target list for the next run.

## Notes

AWIN's documented advertiser publisher endpoint provides relationship metadata, not guaranteed contact emails. Contact extraction therefore depends on public publisher websites, public contact pages, or an optional authenticated AWIN profile scrape if you provide a valid platform cookie and URL template.

The OAuth token shown in the AWIN API Credentials page should be stored only in the n8n variable `AWIN_API_TOKEN` or in a secure credential. Do not paste it into workflow node fields. If the screenshot was shared anywhere outside your private machine, revoke that token in AWIN and generate a new one.

The commission group selection screenshots are useful for later performance or commission-segment workflows, but they are not needed for the current publisher contact scraper. This workflow uses the AWIN publisher relationship endpoint first, then enriches contact information from publisher websites.
