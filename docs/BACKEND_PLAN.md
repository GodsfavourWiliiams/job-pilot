# Backend expansion plan

## Current state and target

The running app uses four public remote JSON feeds, Greenhouse boards for Canonical, GitLab, Remote, and Moniepoint, Arbeitnow and The Muse JSON, We Work Remotely RSS, and a Google HTML search adapter that inspects result pages for remote `JobPosting` data. This is still limited coverage. The target is a server-side discovery pipeline that can ingest many boards and company career pages without making users choose sources. Sources are shared infrastructure; each user supplies preferences and a CV, and receives their own matches and application queue.

```
Board APIs / RSS / permitted career pages / ATS boards
                     ↓
           source-specific adapters
                     ↓
      normalized jobs + provenance + cache
                     ↓
       per-user eligibility and CV matching
                     ↓
         review queue / email / form task
```

## Career levels and user preferences

The old title and structured-seniority exclusion lists have been replaced by configurable `levelTerms` in [`config/search.json`](../config/search.json). They classify listings as intern, entry, junior, mid, senior, or unspecified. The saved preference is empty by default, meaning infer likely levels from the current CV role. For the current uploaded CV, this yields mid, senior, and unspecified; internships are excluded. The user can override those levels in Preferences. A listing with no explicit level or years of experience remains eligible for review. Unspecified level or employment blocks automatic email, not discovery. Time zone restrictions appear as review notes instead of removing listings.

This inference is deliberately simple and should be validated against real listings. The multiuser version will move preferences into a database record keyed to the signed-in user. Source-specific seniority mapping and richer evidence can improve ranking without silently declaring unknown roles ineligible.

## Source coverage

| Tier | Planned sources | Ingestion method | State |
| --- | --- | --- | --- |
| Public remote boards | Himalayas, Remotive, Jobicy, Remote OK | Documented JSON feeds | Implemented |
| More boards | Arbeitnow, The Muse, and We Work Remotely | JSON and RSS adapters | Implemented |
| Company ATS boards | Greenhouse pilot with four boards; expand catalog and add Lever | Public board JSON endpoints for a maintained company catalog | Greenhouse pilot implemented |
| Company career pages | Google result links across employer and ATS sites | Bounded HTML fetch and `JobPosting` JSON-LD extraction | Implemented pilot; needs live validation and more parsers |
| Broader boards | Indeed, LinkedIn, Glassdoor, and similar services | Google indexed links currently attempted; direct adapters may be added if reliable | Limited |

Greenhouse exposes public job-board GET endpoints, and Lever exposes a public postings API per company. Neither gives a universal list of all companies; a catalog of company board identifiers is required. The catalog needs provenance, periodic validation, and deduplication. The Google adapter broadens discovery without maintaining every company domain, but its HTML layout and destination access can change. It reports failed searches and page inspections; a proxy would not by itself guarantee results. Google's Custom Search JSON API is closed to new customers as of the current documentation, so it is not the no-key solution for this local build. [Greenhouse documentation](https://docs.greenhouse.io/job-board) · [Lever documentation](https://github.com/lever/postings-api) · [We Work Remotely RSS](https://weworkremotely.com/remote-job-rss-feed) · [Google Custom Search API](https://developers.google.com/custom-search/v1/overview)

For broad coverage, we need two separate mechanisms: (1) a catalog of many company ATS boards and vetted HTML career pages; (2) an authorized aggregator/search provider if we want coverage resembling a general job search engine. Adding four or ten individual feeds alone will not achieve hundreds of sources. We will measure coverage by distinct companies, fresh remote jobs eligible in Nigeria, and duplicate rate, not just the number of connectors.

## Server data model and onboarding

Move private state out of one local JSON file into a server database before making the app multiuser. Proposed tables:

- `users`: account identity and authentication.
- `profiles`: name, contact details, country, timezone, professional title, and active CV reference.
- `resumes`: uploaded file metadata, encrypted object path, extracted text, version, and extraction status.
- `preferences`: desired roles, accepted levels, employment types, location eligibility, minimum score, review toggle, and email cap.
- `sources`: adapter kind (`api`, `rss`, `ats`, `html`), endpoint/board ID, attribution URL, terms/robots review, enabled flag, fetch interval, and parser version.
- `source_runs`: fetch timestamp, HTTP status, error, result count, cache headers, and next retry time.
- `jobs`: canonical URL, source ID, employer, title, level evidence, employment, location evidence, dates, description, and application method.
- `job_matches`: user/job pair, score, reasons, eligibility confidence, and time evaluated.
- `applications`: draft version, status, send/submit timestamp, Gmail message ID, and errors.
- `oauth_tokens`: per-user encrypted Gmail refresh token and account identity.

The onboarding wizard asks only questions needed for matching and sending:

1. Upload a CV. Show extracted text and inferred skills/title for correction.
2. Enter or confirm desired roles, e.g. `Frontend Developer` and `anything frontend`. Show the searches this creates.
3. Choose location/country and timezone; ask whether worldwide, Africa/EMEA, and country-specific remote work are acceptable. Do not assume a remote listing hires from Nigeria.
4. Choose levels (entry/junior/mid), employment (full-time/part-time/contract), and any exclusions.
5. Choose review-before-email, daily cap, and notification preference.
6. Connect Gmail using OAuth if email sending is wanted. The account is optional for job discovery.

The server stores each answer as a profile/preference record. `config/search.json` remains for operator defaults and source settings, while user choices come from the database. The effective search is computed from `operator defaults + user choices + CV evidence`; no personal name, country, or career goal is hardcoded into adapters. This is the concrete replacement for the current single-user `data/state.json`.

## Ingestion worker and scraping rules

Run the discovery worker separately from the Next.js request server. It schedules each source at its own permitted interval, requests conditional updates with ETag/Last-Modified where available, normalizes fields, records errors, and upserts by source ID and canonical URL. Per-user matching then reads cached jobs; one hundred users should not cause one hundred fetches to each board.

For HTML sources, the Google pilot currently fetches a bounded set of search results and destination pages, rejects private URLs, and extracts structured `JobPosting` JSON-LD. A future dedicated worker should record allowed hosts, source-specific parsing rules, retries, cache headers, and exact field evidence. When location or employment cannot be verified, the job is marked for manual review. Blocked and changed pages should be reported as source diagnostics.

For learning, implement one vetted HTML company-page adapter end to end with a saved HTML fixture and a parser test. Review the request, parsed fields, normalization, database row, and resulting match together before adding more sites. A source-status page should show last run, jobs found, errors, and why jobs were filtered; this makes the backend inspectable rather than opaque.

## Delivery sequence

1. **Source registry and observability:** registered adapters, source runs, and a status panel are implemented for nine source families, including fetched/matched counts, filter reasons, errors, and cooldowns.
2. **Server database and onboarding:** per-user data model, CV upload/review, role/level/location preferences, and Gmail connection.
3. **Coverage:** expand the company ATS catalog, add Lever and Ashby boards, and add site-specific parsers where structured data is missing. Validate the Google connector against live responses and tune queries based on measured accepted matches.
4. **Safety and quality:** dedupe across sources, verify open status, distinguish unknown eligibility, and enforce source rate limits and attribution.
5. **Learning walkthrough:** one adapter at a time, with fixture tests and a source-run trace you can inspect in the dashboard.

The current app has nine source adapters, persisted run status, a dashboard status panel, and a live Google-to-HTML [`JobPosting` extractor](../lib/scrape-jsonld.ts) with fixture tests. The database, onboarding wizard, large ATS catalog, and live end-to-end verification of the Google connector are not yet complete.
