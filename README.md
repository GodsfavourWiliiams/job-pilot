# JobPilot

A local Next.js and TypeScript app that finds remote roles matching a CV and saved preferences, checks location and career level, prepares a tailored email and CV from an uploaded PDF, and keeps form applications in a pending queue.

## Run locally

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The server binds to your computer only. `npm run build` checks the production build. `npm test` runs matching and draft tests.

The initial local profile is loaded from `data/state.json`. That folder is excluded from git because it contains private CV and application data. In **Profile & CV**, anyone can replace the profile and upload a PDF. The extracted text and professional title can be corrected by hand. A new CV suggests its title from the header and refreshes open application drafts and match scores; sent and completed applications remain historical records. On macOS the app uses PDFKit for extraction; on Linux it uses `pdftotext` from Poppler.

## What it does

- Fetches thirteen source families: Himalayas, Remotive, Jobicy, Remote OK, a configured Greenhouse company catalog, Arbeitnow, We Work Remotely RSS, The Muse, RemoteJobs.org, Google web search, LinkedIn public jobs, Bluesky hiring posts, and X hiring posts. Social posts enter the queue only when their linked application page exposes structured remote job data. X requires `X_BEARER_TOKEN`; without it, Source status explains that X was not searched. These sources do not guarantee coverage of hundreds of sites or that every page can be fetched.
- Uses desired roles and CV evidence for frontend, React, Next.js, and JavaScript searches. Career levels default to inference from the CV. Preferences can override them. A job without a stated level remains eligible for review; internships are excluded by the current CV-derived preference.
- Saves preferences and queue state on the server in `data/state.json`. There is no browser-storage dependency. Profile includes an IANA time zone; source time zone restrictions appear as review notes rather than hiding a listing. Country eligibility still filters clearly restricted locations.
- Runs automatic checks every 10, 20, 30, or 60 minutes according to Preferences while the local server is running. Every feed also has its own cooldown, so a ten-minute check does not fetch a daily feed every ten minutes. Transient source failures retry after at most ten minutes; access blocks such as HTTP 403 or a consent page back off for at least six hours. Opening the dashboard also restores the scheduler after a dev reload. You may trigger a check with **Find jobs**, but the same cooldowns apply.
- Shows each source's last attempt, fetched count, matched count, filter reasons, and error in **Source activity**. Google also reports searches, destination pages inspected, and structured postings found. Users may disable individual sources there; sources are enabled by default. The queue and history show the last run and next scheduled check, and Source activity keeps recent per-run logs.
- Drafts email and a role-specific CV using only facts in the uploaded CV. Application forms stay in a manual queue. Remote listings with unspecified applicant geography remain in review and cannot auto-send. Email can auto-send only for explicit application addresses when Gmail is connected, review is off, the daily cap allows it, and the listing has a clear level, verified location eligibility, and no incompatible time zone restriction.

The source endpoints, company board catalog, role expansions, source cooldowns, and default preferences are in [`config/search.json`](config/search.json). See [implementation details](docs/IMPLEMENTATION.md) and the [backend expansion plan](docs/BACKEND_PLAN.md).

The [Google Stitch design prompt](docs/STITCH_PROMPT.md) covers onboarding and every application page as desktop, tablet, and mobile designs.

LinkedIn searches public job pages for the configured locations and CV-derived specialties, then checks each job page for remote `JobPosting` metadata. Bluesky uses its public post-search API and follows links from hiring posts. X uses the recent-post API; add an X developer app bearer token to `.env.local` and restart to enable live X searches. Each adapter reports searches, pages inspected, and failures in **Source activity**.

### Run in the background on macOS

After configuring the app and checking the build, run:

```bash
npm run build
npm run background:install
```

This installs a per-user macOS LaunchAgent that starts JobPilot at login and restarts it if it exits. The browser may be closed; automatic scans still run if **Automatic search** is on and a CV is loaded. Gmail must be connected for sending, and **Review emails before sending** must be off for automatic email submission. Form applications remain pending. Use `npm run background:uninstall` to stop and remove the service. Logs are written to `data/background.out.log` and `data/background.err.log`. Keep port 3000 free, and rebuild after code changes. A sleeping or powered-off Mac cannot run scans; a hosted worker is required for round-the-clock operation.

## Gmail sending

Email review is **on** by default. You can turn it off in Preferences to send newly found email applications automatically after a scan. Form applications always stay in the queue. A daily email cap is also configurable.

To connect Gmail:

1. In Google Cloud, enable the Gmail API and create a Web application OAuth client.
2. Add `http://127.0.0.1:3000/api/gmail/callback` as an authorized redirect URI.
3. Copy `.env.example` to `.env.local`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a 32-byte hex `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`). Restart the app.
4. Enter the same Gmail address in Profile, then choose **Connect Gmail** in Preferences.

The app asks Google for `gmail.send` plus basic email identity. A local encryption key has been prepared in `.env.local`, but you must supply the Google OAuth client ID and secret from your own Google Cloud project and restart the server before the Connect button can work. Refresh tokens are encrypted in `data/gmail-token.enc`. The app does not read your inbox or store your Gmail password. [Google's OAuth server flow](https://developers.google.com/identity/protocols/oauth2/web-server) supplies offline access; the [Gmail send endpoint](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send) sends a MIME email with the tailored PDF attached.

## Scope of this first version

This is a single-user local app. The profile and preferences are editable, but sharing it as a hosted product would require user accounts, a database, isolated token storage, a background worker, and deployment security. Browser notifications appear while the dashboard is open; the pending queue remains available whenever you reopen it. Job descriptions and location rules can be imperfect, so review each original listing before applying. The CV and email generator is deterministic; it chooses relevant facts from the uploaded text instead of calling an AI service. Push notifications to a phone are not implemented.
