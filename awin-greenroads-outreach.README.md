# AWIN GREEN ROADS — Weekly Publisher Outreach (n8n)

Automated weekly Monday workflow that pulls AWIN publisher performance for the GREEN ROADS commission group, classifies publishers (low clicks, low performance, new), sends targeted Gmail outreach, and logs everything in Google Sheets.

- **Workflow file:** `awin-greenroads-outreach.json`
- **Schedule:** every Monday at 09:00 UTC (cron `0 9 * * 1`)
- **Advertiser:** 81733 (GREEN ROADS)
- **AWIN base URL:** `https://api.awin.com`

---

## 1. Node-by-node walkthrough

| # | Node | Purpose |
|---|------|---------|
| 1 | **Every Monday 9 AM** (Schedule Trigger) | Fires the workflow every Monday at 09:00 UTC. |
| 2 | **Calculate Date Range** (Code) | Computes previous Sun→Sat window, `sevenDaysAgo`, ISO `weekKey`, advertiserId. |
| 3 | **AWIN: Publisher Performance** (HTTP) | `GET /advertisers/81733/reports/publisher` for the date range. Retries 3×, continues on error. |
| 4 | **AWIN: Publishers List** (HTTP) | `GET /advertisers/81733/publishers?relationship=joined` with paginated `Link: rel="next"` follow. |
| 5 | **Merge AWIN Responses** (Merge v3.2) | Combines both API responses (multiplex). |
| 6 | **Normalize & Filter GREEN ROADS** (Code) | Flattens both responses, filters to GREEN ROADS commission groups, joins publisher metadata (name, email, joinDate). Adds publishers who joined in last 7 days even if no perf row. |
| 7 | **Sheets: Already Emailed This Week** (Sheets read) | Reads `Outreach Logs` for the current `week_key` to drive duplicate prevention. |
| 8 | **Categorize + Dedupe** (Code) | Per publisher: applies category rules (`new_publisher` → `low_clicks` → `low_performance`), drops anyone already emailed for that category this week. |
| 9 | **Per-Publisher Loop** (Split In Batches, batchSize 1) | Iterates one publisher at a time so a single failure doesn't kill the run. Output 0 = done, output 1 = loop body. |
| 10 | **Has Email?** (IF) | True branch goes straight to email build. False branch hits the fallback Sheet. |
| 11 | **Sheets: Fallback Contacts** (Sheets read) | Reads the `Publishers` tab as a fallback contact database. |
| 12 | **Merge Contact** (Code) | Looks up the matching `publisher_id` row from the fallback list, attaches its email. |
| 13 | **Build Email** (Code) | Picks subject + body template by `category` (Welcome vs. Performance Improvement). |
| 14 | **Email Resolved?** (IF) | If still no email, log as `skipped_no_email`. Otherwise proceed to Gmail. |
| 15 | **Gmail: Send** (Gmail) | Sends the message. Retries 3× with 5s backoff, continues on error. |
| 16 | **Log: Outreach Sent** (Sheets append) | Appends a `sent` row to `Outreach Logs` and loops back. |
| 17 | **Log: New Publishers Tab** (Sheets appendOrUpdate) | Upserts the publisher into `New Publishers` (matched by `publisher_id`). |
| 18 | **Log: No Email** (Sheets append) | Appends a `skipped_no_email` row to `Outreach Logs` and loops back. |

### Flow diagram

```
Schedule ─► Date Range ─┬─► AWIN Performance ─┐
                        └─► AWIN Publishers ──┴─► Merge ─► Normalize ─► Read "Already Emailed"
                                                                                ▼
                                                                    Categorize + Dedupe
                                                                                ▼
                                                                    Per-Publisher Loop ─┐
                                                                                ▼       │
                                                                       Has Email? ──┐   │
                                                                          │T        │F  │
                                                                          │         ▼   │
                                                                          │   Sheets fallback
                                                                          │         ▼   │
                                                                          │   Merge contact
                                                                          ▼         ▼   │
                                                                       Build Email ◄┘   │
                                                                                ▼       │
                                                                       Email Resolved?  │
                                                                          │T        │F  │
                                                                          ▼         ▼   │
                                                                       Gmail Send  Log: No Email ─►┐
                                                                       │      │              ▲    │
                                                                       ▼      ▼              │    │
                                                                Log: Sent  Log: New Pub Tab  │    │
                                                                       │                     │    │
                                                                       └────► loop back ─────┴────┘
```

---

## 2. Required environment variables

Set these in your n8n environment (e.g. `docker-compose.yml`, `.env`, or n8n Settings → Variables):

| Variable | Purpose | Example |
|----------|---------|---------|
| `GSHEET_ID` | Google Sheet document ID hosting all 3 tabs | `1AbCdEf...XYZ` |

The AWIN API key is hard-coded into the HTTP nodes per the requirements (`Authorization: Bearer 990ee5cf-f69e-4950-ae3b-7e0e7f943417`). Move it to an env var (`AWIN_API_KEY`) and reference it as `Bearer {{ $env.AWIN_API_KEY }}` if you prefer not to commit it.

### Credentials to create in n8n UI

1. **Google Sheets OAuth2 API** — used by 4 sheet nodes. Replace `REPLACE_GSHEETS_CRED_ID` with the real credential id (n8n shows it in the URL).
2. **Gmail OAuth2 API** — used by `Gmail: Send`. Replace `REPLACE_GMAIL_CRED_ID` with the real credential id.

---

## 3. Google Sheets structure

Create one spreadsheet (call it e.g. *AWIN GREEN ROADS Outreach DB*) with these 3 tabs:

### Tab: `Publishers` (fallback contact database)

| Column | Type | Notes |
|--------|------|-------|
| publisher_id | string | **Primary key** — matches AWIN `publisherId`. |
| publisher_name | string | |
| email | string | Used when AWIN returns no email. |
| clicks | number | Optional / informational. |
| revenue | number | Optional / informational. |
| transactions | number | Optional / informational. |
| join_date | date | Optional / informational. |

### Tab: `Outreach Logs`

| Column | Type |
|--------|------|
| date | string (YYYY-MM-DD) |
| week_key | string (YYYY-Www) — used for duplicate prevention |
| publisher_id | string |
| publisher_name | string |
| email | string |
| clicks | number |
| transactions | number |
| revenue | number |
| commission | number |
| category | string (`new_publisher` / `low_clicks` / `low_performance`) |
| email_type | string (mirror of category) |
| status | string (`sent` / `skipped_no_email` / `error`) |
| email_sent | boolean |
| error | string |

### Tab: `New Publishers`

| Column | Type |
|--------|------|
| publisher_id | string (match key) |
| publisher_name | string |
| email | string |
| join_date | string (YYYY-MM-DD) |
| first_seen | string (YYYY-MM-DD) |
| welcome_email_sent | boolean |

---

## 4. Gmail setup

1. n8n → **Credentials** → **New** → *Gmail OAuth2 API*.
2. Either use n8n's built-in OAuth client (cloud / desktop) or create your own in Google Cloud Console:
   - APIs & Services → Enable **Gmail API**.
   - OAuth consent screen → External, add your sender as a test user (or publish).
   - Credentials → Create OAuth client ID → Web application.
   - Authorized redirect URI: `https://<your-n8n>/rest/oauth2-credential/callback`.
   - Paste Client ID / Secret into n8n.
3. Click **Connect my account** in the credential and grant `https://www.googleapis.com/auth/gmail.send`.
4. Copy the credential ID and replace `REPLACE_GMAIL_CRED_ID` in the JSON.

---

## 5. AWIN API request examples

### Performance report
```http
GET https://api.awin.com/advertisers/81733/reports/publisher?startDate=2026-05-03&endDate=2026-05-09&timezone=UTC&dateType=transaction
Authorization: Bearer 990ee5cf-f69e-4950-ae3b-7e0e7f943417
Content-Type: application/json
```

Sample response (shape may vary slightly):
```json
[
  {
    "publisherId": 123456,
    "publisherName": "Coupon Site X",
    "commissionGroupName": "GREEN ROADS Default",
    "clicks": 87,
    "transactionsCount": 0,
    "totalSaleAmount":      { "amount": 0,    "currency": "USD" },
    "totalCommissionAmount":{ "amount": 0,    "currency": "USD" }
  }
]
```

### Publishers list (joined relationship, paginated)
```http
GET https://api.awin.com/advertisers/81733/publishers?relationship=joined
Authorization: Bearer 990ee5cf-f69e-4950-ae3b-7e0e7f943417
```

n8n's HTTP Request node follows the `Link: <...>; rel="next"` header automatically (configured in `options.pagination`). Adjust `maxRequests` if your account has > 50 pages.

---

## 6. Error handling

Every node that talks to a remote service uses **`onError: continueRegularOutput`** so a single failure cannot kill the workflow. The HTTP and Gmail nodes also retry 3× with backoff. The `Per-Publisher Loop` ensures a single bad publisher doesn't stop the rest.

| Node | Strategy |
|------|----------|
| AWIN HTTP requests | `retryOnFail` 3× / 3s backoff, `onError: continueRegularOutput`, `alwaysOutputData: true` |
| Sheets reads | `onError: continueRegularOutput`, `alwaysOutputData: true` (so an empty/missing tab still emits an empty array) |
| Gmail Send | `retryOnFail` 3× / 5s backoff, `onError: continueRegularOutput`. On failure the loop continues; failure rows can be detected by an empty `email` in the success branch. |
| Sheets log writes | `onError: continueRegularOutput` so a logging failure can't block subsequent iterations |

Failures are still visible in the *Executions* view; enable the n8n built-in error trigger (separate workflow) if you want Slack/email alerting on top.

---

## 7. Pagination handling

`AWIN: Publishers List` uses n8n's HTTP Request pagination:
```
options.pagination = {
  paginationMode: "responseContainsNextURL",
  nextURL: extracted from `Link: <...>; rel=\"next\"` header,
  limitPagesFetched: true,
  maxRequests: 50
}
```
The performance report endpoint typically returns a single page so no pagination is configured there — increase if your dataset grows.

---

## 8. Date range automation

`Calculate Date Range` (UTC):
- On Monday `dow = 1`, so `daysSincePrevSunday = 8`.
- `start = today − 8 days` (previous Sunday).
- `end = start + 6 days` (previous Saturday).
- `sevenDaysAgo = today − 7 days` (used for "new publisher" detection).
- `weekKey` is the ISO week of the run, used to dedupe outreach in `Outreach Logs`.

Example for 2026-05-11 (Mon): `start = 2026-05-03`, `end = 2026-05-09`.

If you'd rather run in a local timezone, set the workflow `settings.timezone` (already `UTC`) and replace the `Date.UTC(...)` calls with local equivalents.

---

## 9. Duplicate prevention

The `Sheets: Already Emailed This Week` step pulls every `Outreach Logs` row and the `Categorize + Dedupe` Code node builds a set of `publisher_id|category` pairs already logged for the current `week_key`. Any candidate already in the set is dropped before reaching the loop.

> The current Sheets read pulls the whole sheet then filters in memory because the n8n `filtersUI` doesn't support compound match keys reliably across versions. For very large logs, prune older rows quarterly or split per year.

---

## 10. Deployment — Docker

Minimal `docker-compose.yml`:

```yaml
services:
  n8n:
    image: n8nio/n8n:latest
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - GENERIC_TIMEZONE=UTC
      - TZ=UTC
      - N8N_HOST=${N8N_HOST:-localhost}
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=${WEBHOOK_URL:-https://localhost:5678/}
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
      # Custom env consumed by the workflow
      - GSHEET_ID=${GSHEET_ID}
      # Optional — move the API key out of the JSON
      - AWIN_API_KEY=${AWIN_API_KEY}
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
```

`.env` (sibling file):

```
N8N_HOST=n8n.example.com
WEBHOOK_URL=https://n8n.example.com/
N8N_ENCRYPTION_KEY=change-me-to-a-long-random-string
GSHEET_ID=1AbCdEf...XYZ
AWIN_API_KEY=990ee5cf-f69e-4950-ae3b-7e0e7f943417
```

### Bring it up
```powershell
docker compose up -d
```

### Import the workflow
1. Open `https://<your-host>/`.
2. **Workflows** → **Import from file** → choose `awin-greenroads-outreach.json`.
3. Open the workflow, click each node with `REPLACE_*` credentials, and bind the real Google Sheets / Gmail credentials.
4. (Optional) Replace the literal Bearer header in the two AWIN HTTP nodes with `Bearer {{ $env.AWIN_API_KEY }}`.
5. Toggle **Active** in the top-right.

### Test manually before the first Monday
- Click **Execute Workflow** to run end-to-end immediately.
- Inspect each node's output panel to confirm AWIN responses parse correctly.
- Check that 1 row appears in `Outreach Logs` for each publisher you expect.

### Scheduling note
The trigger is `0 9 * * 1` UTC. To run at 09:00 in another timezone, either change the cron expression accordingly or set a different `settings.timezone` on the workflow.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Categorize + Dedupe` returns 0 items | Performance report shape changed | Open `AWIN: Publisher Performance` execution data and adjust the field accessors in `Normalize & Filter GREEN ROADS` |
| All publishers tagged as `new_publisher` | `join_date` missing on most rows | Confirm AWIN returns `joinedDate` / `dateJoined`; populate fallback in `Publishers` tab |
| Duplicate emails sent the same Monday | `Outreach Logs` lookup empty (read failed) | Check the `Sheets: Already Emailed This Week` execution; verify `GSHEET_ID` and credential |
| Loop processes only the first publisher | SplitInBatches output indices reversed | In `Per-Publisher Loop` v3, output 0 = done, output 1 = loop. The connections file already has this correct |
| Sheets "range not in valid A1 notation" warning | Cosmetic only — the read still works because `dataLocationOnSheet.rangeDefinition = detectAutomatically` is set |

---

## 12. Optional — OpenAI personalization

Drop an **OpenAI** node between **Build Email** and **Email Resolved?**, prompt with the publisher's stats + base template, and overwrite `email_body`. Keep the deterministic templates as fallback if the OpenAI call fails (`onError: continueRegularOutput`).
