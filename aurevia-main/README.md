# Aurevia Invest

Aurevia Invest is a Next.js 14 application using TypeScript, PostgreSQL, Prisma, NextAuth, Socket.IO, Zustand, Tailwind CSS, Recharts and Lightweight Charts. Trading and market prices used by the trading engine remain internal simulations; the `/markets` dashboard separately displays live-provider quotes and history. This repository does not connect to a live broker, exchange, bank, or payment network.

## What is implemented

### User application
- Landing page, registration and credential login
- JWT sessions with USER/ADMIN role enforcement
- KYC profile submission, private identity-document uploads, and administrator review states
- Profile and account settings
- 2FA security flag
- Live dashboard with cash equity and open positions
- Realtime market ticker
- Trading terminal with Market, Limit and Stop orders
- Simulated order book and realtime candles/price chart
- Open-order cancellation
- One-click position close
- Unrealized P&L display
- Wallet balance from the ledger
- Deposit and withdrawal requests
- Funding history

### Administration
- Role-protected admin area
- User list and freeze/unfreeze
- Role changes
- KYC profile and private document approval/rejection
- Per-user deposit and withdrawal enablement controls
- Deposit/withdrawal approval queue
- Deposit approval posts the exact approved amount to the user's ledger atomically
- Force-close open positions
- Instrument enable/disable and configuration API
- System settings
- Deleted Items recycle bin for waitlist entries, client stories, and broadcasts, with search, filtering, audited restore, and audited permanent deletion
- Audit log
- Realtime operational statistics

Financial, identity-review, and audit records are intentionally not recyclable: account-erasure requests follow the privacy-preserving closure workflow, and immutable financial/audit history remains subject to its retention rules.

### Financial engine
- PostgreSQL persistence
- Prisma transactions
- Double-entry ledger
- Ledger balance derived from entries
- Serializable transactions for financial mutations
- Atomic funding approval
- Atomic trade reservation
- Margin release and realized P&L settlement
- Trading fees
- Insufficient-funds protection
- No direct mutable customer cash balance

### Market engine
- Internal simulated instruments
- Random-walk price engine
- One-minute candles
- Automatic Limit/Stop order processing
- Socket.io market:update events
- Socket.io trade:update events
- REST market, candle and order-book endpoints

### Live market dashboard

The `/markets` page uses the server-only `FINNHUB_API_KEY` when configured and falls back to Yahoo Finance's unofficial chart endpoint if Finnhub is unavailable or lacks an instrument. Quotes refresh every five seconds for the selected asset; watchlist quotes refresh every 30 seconds, and server-side in-process caching reduces duplicate provider requests. Historical OHLCV data supports the displayed ranges and is cached for up to one minute. Provider timestamps and source are shown, and the last successful quote is explicitly marked stale when reused; provider errors are never replaced with invented prices. Yahoo Finance is not an official API and can delay, limit, or discontinue access. Watchlists are stored on the device in separate public/account scopes. The ticker and chart are informational and are not connected to trade execution.

## Important scope boundary

DEMO trading, balances, positions, funding, and P/L remain virtual and separate from REAL. Aurevia's REAL wallet is an internal USD ledger, not a bank account or custody wallet. REAL BTC deposit requests accept a reported BTC amount, a Bitcoin transaction ID, and a privately stored screenshot; the application does not provide a BTC receiving address, monitor the chain, verify confirmations, or convert BTC to USD. An administrator must manually review the submitted details and evidence, record a verification decision, then separately enter the USD amount to credit. The reported BTC amount and the admin-entered USD ledger credit are stored and displayed separately; a screenshot is not blockchain confirmation. Approved credits affect only the user's Aurevia REAL internal ledger and are audited and notified. REAL withdrawal eligibility is capped by manually verified BTC credits after prior and pending withdrawals; internal simulated credits and simulated investment returns are not withdrawable. Admin approval leaves a REAL withdrawal reserved and incomplete because no external payout provider is configured. When explicitly enabled, authorized REAL-side trade orders are submitted to one shared Alpaca Paper account; paper cash, equity, buying power, fills, and P/L never become Aurevia user balances, ledger entries, executions, or positions. Paper orders are auditable as `PAPER / SIMULATED`, and the Aurevia REAL ledger remains authoritative for internal wallet collateral. Live brokerage, payment processing, BTC custody, deposits to an Aurevia-controlled address, external withdrawals, and money movement are not enabled. Any Bitcoin display address configured in settings is for DEMO display only and is not a REAL receiving address. Identity eligibility remains subject to administrator review and existing per-user funding controls.

Two-factor authentication is currently disabled. The legacy database flag is not treated as protection, the profile API reports it as unavailable, and attempts to enable it are rejected until enrollment, login challenges, recovery, and reauthentication are implemented.

Sign-in and registration use the application's own email/username and password credentials; no social login, external identity provider, email OTP, or SMS OTP is required. A phone number is optional contact information and is not verified during registration. New accounts can sign in immediately, while identity/account eligibility remains pending administrator review. Admin approval requires a submitted profile and an approved identity document, clears any legacy external-registration-verification hold without claiming the contact was externally verified, and is recorded in the audit log.

## Requirements

- Node.js >=20.19 and <21, >=22.13 and <23, or 24+
- Docker Desktop or PostgreSQL 15+
- npm

## Isolated browser tests

Run `npm run test:e2e:isolated` with Docker available. The command starts a disposable PostgreSQL 16 container bound only to a dynamically selected loopback port, applies Prisma migrations only to that container, and removes it after the run. The container has no persistent volume; neither `DATABASE_URL` nor `DIRECT_URL` from `.env` is used for tests. `npm run test:e2e` requires explicit `AUREVIA_E2E_DATABASE_URL` and `AUREVIA_E2E_DIRECT_URL` values that point to the same local PostgreSQL database ending in `_e2e`; it refuses Supabase, Neon, and other remote hosts before fixture setup.

The isolated database bootstraps only the minimal Supabase Storage tables, private bucket metadata, and database roles required by the Storage-policy migration. The Playwright application process has Supabase URL/key configuration cleared, so file workflows fail closed and cannot access the shared Storage service. `npm run test:e2e` by itself continues to reject non-local or mismatched database URLs.

## Environment

Copy `.env.example` to `.env`.

`.env.example` lists variable names only. Configure the values in the ignored `.env` file or your deployment's secret manager. `DATABASE_URL` is the application connection (use the Supabase pooler URL when appropriate); Prisma uses `DIRECT_URL` for migrations and introspection. Both must point to the intended Supabase Postgres database. The application does not use a browser Supabase client; database access stays on the server through Prisma.

Only `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SUPABASE_URL` are public configuration. All other values, especially database URLs, `NEXTAUTH_SECRET`, administrator credentials, SMTP credentials, verification API keys, and `SUPABASE_SERVICE_ROLE_KEY`, are server-only. Never put a Supabase service-role/secret key in a `NEXT_PUBLIC_` variable. The Data API roles `anon` and `authenticated` have no table or sequence privileges on the application's `public` schema, and row-level security is enabled for its tables; the application uses its server-side Prisma connection.

`ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are server-only administrator credentials. On the dedicated admin login form, the first sign-in using the exact configured username or email and password provisions the configured ADMIN account. The password must be at least 12 characters. A matching existing non-admin account is promoted only after the configured password is verified. If the configured email is unused but an administrator already exists, that existing admin record adopts the configured email and username after the configured password is verified; a second admin is not created. The seed remains available for explicit provisioning. Restart the server after changing these values.

Registration completes without an email/SMS ownership challenge. Legacy `REGISTRATION_VERIFICATION_ENABLED` and `PHONE_VERIFICATION_REQUIRED` environment values are ignored. This does not bypass KYC or other eligibility checks for REAL-account funding and trading actions. `NEXT_PUBLIC_APP_URL`, `PORT`, and `MARKET_TICK_MS` are optional and have runtime defaults.

For production, set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the canonical HTTPS domain configured for that deployment. Production startup rejects a missing `NEXTAUTH_SECRET` or `NEXTAUTH_URL`; it never trusts an arbitrary Host header to establish the auth origin. Official support contact defaults to `aureviainvest@gmail.com` and can be overridden with `SUPPORT_EMAIL`; `COMPLAINTS_EMAIL` may be set separately. Configure these destinations separately from `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. When SMTP is missing, password recovery is unavailable and support/funding actions report that no email was sent; in-app tickets and notifications remain recorded.

### Vercel deployment

This repository is configured as a Next.js application in `vercel.json`. Vercel runs the App Router routes as serverless functions; it does not run `server.ts`, persistent Socket.IO connections, or the local in-process market timer. Browser market views therefore refresh over HTTP, and the protected `/api/cron/market-tick` route advances the simulated DEMO market once per minute. Use a Vercel plan that supports a one-minute Cron schedule. This market is simulated; the job does not connect to a broker or funding provider.

- Framework preset: Next.js
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: leave the Vercel default
- No custom start command

Configure production and preview environment variables in the Vercel project settings. Required server values are `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, and `CRON_SECRET`. Configure Supabase private-file variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) when those workflows are enabled. Add `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` before provisioning the administrator. Set the canonical HTTPS app origin explicitly in `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`; use a separate staging database and secrets for Preview deployments. Keep all credentials server-only except the explicitly public Supabase URL and anon key.

Use Supabase's pooled connection string for `DATABASE_URL` where appropriate and its direct PostgreSQL connection for `DIRECT_URL`. Apply reviewed Prisma migrations to the target database before promoting the deployment; the Vercel build does not run migrations or seed an administrator. Do not point Preview deployments at production customer data. Configure the four private Storage buckets and restrictive policies documented above before enabling uploads.

Generate a high-entropy `CRON_SECRET` and store it in Vercel project settings. Vercel Cron sends it as a Bearer token to the market-tick route; calls without that exact secret are rejected. Cron jobs run for production deployments. Local development and the Render Node service continue to use the custom server's ticker; Render remains the option when persistent Socket.IO/WebSocket delivery is required.

### Render deployment

Use a Render **Node web service** connected to the existing GitHub repository. Set its Root Directory to `aurevia-main` (the app and `package.json` are in that repository subdirectory). Render's persistent web service supports this custom Next.js/Socket.IO HTTP server and WebSocket upgrades; do not deploy it as a static site or serverless function. Keep the service on an always-on plan (the Blueprint uses `starter`); signing out only ends the user's session and does not stop the server or market ticker. Use one instance while the in-process Socket.IO market engine is enabled; horizontal scaling requires a shared Socket.IO adapter and coordinated market worker, which are not currently configured.

- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- If Render reports a build command of `yarn`, update the service's Build Command in **Settings → Build & Deploy** to the command above. Installing dependencies alone does not generate the `.next` production build required by the start command.
- Docker is not required for Render's native Node runtime. The checked-in multi-stage `Dockerfile` is an alternative if the Render service is explicitly configured as a Docker service.

Configure these variables in Render's environment settings (secrets stay in Render, never in source). A local `.env` file is not automatically uploaded to Render:

- Required: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Required for administrator sign-in: `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Use the exact configured username or email and password at `/admin/login`; first sign-in provisions the admin or adopts the existing admin record when the configured email is unused. SMTP/support variables and `MARKET_TICK_MS` are optional. Legacy registration-verification environment settings are ignored; registration does not require email or SMS ownership challenges. Identity status is administrator-reviewed; it does not indicate external identity verification.
- Alpaca Paper account status and REAL-side paper orders: configure `ALPACA_PROVIDER=alpaca`, `ALPACA_TRADING_BASE_URL=https://paper-api.alpaca.markets/v2`, `ALPACA_API_KEY`, and `ALPACA_SECRET_KEY` (or the legacy `ALPACA_API_SECRET`) as server-side secrets. Set `ALPACA_PAPER_ORDERS_ENABLED=true` only when paper-order submission is intended; it defaults to false. Keep `REAL_EXECUTION_ENABLED=false`. No live endpoint is accepted.

Set both `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the same canonical HTTPS origin assigned to the Render service (or its verified custom domain). The database URLs must be the existing Supabase PostgreSQL connections; use Supabase's pooler for application traffic where appropriate and its direct connection for Prisma schema management. Render injects these environment variables during the build. Keep production migrations out of the build command: first reconcile the target database's migration history with the checked-in migrations, review the migration plan for compatibility with the running release, and obtain explicit approval before applying migrations using `DIRECT_URL`. Confirm migration status and take appropriate database backups before any approved production migration; do not use `db:push` or reset commands in production.

The development command uses `.next-dev` so it does not collide with production builds in `.next`; `server.ts` loads the repository `.env` and honors the configured database URLs. The Docker build context excludes `.env*`; supply runtime configuration only through the hosting environment. The application has no production localhost URL dependency: its localhost URL fallback is for local development, and production startup requires `NEXTAUTH_URL`.

### Simulated account workflows and external provider readiness

DEMO trade orders continue through Aurevia's simulated execution service. REAL trade orders use the Alpaca Paper endpoint only when `ALPACA_PAPER_ORDERS_ENABLED=true`; provider status is checked in the admin panel, and orders are kept separate from Aurevia's REAL ledger, executions, and positions. Paper BUY collateral is limited to the user's Aurevia REAL USD ledger balance, less pending withdrawals, existing paper-buy holdings cost basis, and open paper-buy reservations. Paper fills and profits do not credit or otherwise alter that ledger. Idempotency keys and provider reconciliation prevent automatic resubmission of ambiguous requests. This is paper-only shared-account activity, not live trading or customer custody. REAL BTC deposits require a user-submitted amount, transaction ID, and private image, followed by separate admin manual verification and approval of an explicit USD credit. The application does not verify Bitcoin confirmations or provide a receiving address, and must not claim that evidence alone proves payment. A REAL withdrawal request is allowed only against verified BTC-funded USD credits; internal simulated credits and investment estimates are excluded. Admin approval leaves it reserved, and the REAL settlement endpoint refuses to complete it until an external payout process exists. DEMO withdrawals may still settle as virtual ledger activity. Investment allocations are internal simulations; settlement returns only reserved principal, while configured target returns remain estimates and are not credited as earnings. DEMO remains isolated. No external investment settlement, payment processing, custody, or money movement is enabled.

The current provider interfaces describe broker order submission/cancellation/status, balances/positions, reconciliation, quotes/bars, funding confirmations, identity/sanctions checks, and webhook signature verification. The admin-only `/api/admin/providers/status` endpoint performs a read-only `GET /v2/account` check and reports configuration, connectivity, and authentication failures without returning credentials. Alpaca paper account details are visible only to admins and are not Aurevia balances or ledger funds. REAL-side paper orders persist provider account/order references and raw provider status for review and reconciliation; no ledger entries, internal executions, or positions are created from paper fills. DEMO orders remain entirely internal. The paper-order adapter is hard-limited to Alpaca's paper endpoint; `REAL_EXECUTION_ENABLED` remains false and does not enable live execution. Payment processing, external investment settlement, and external money movement remain disabled.

Server-only broker configuration includes `ALPACA_PROVIDER`, `ALPACA_TRADING_BASE_URL`, `ALPACA_API_KEY`, `ALPACA_SECRET_KEY` (or legacy `ALPACA_API_SECRET`), and the explicit `ALPACA_PAPER_ORDERS_ENABLED` toggle. `REAL_EXECUTION_ENABLED` must remain false. Payment-provider names are `PAYMENT_PROVIDER`, `PAYMENT_API_URL`, `PAYMENT_API_KEY`, and `PAYMENT_WEBHOOK_SECRET`; external payment processing remains disabled. Select jurisdictions and obtain legal/compliance approval before evaluating broker, payment, market-data, and identity/AML providers. Administrators can grant simulated credits to configured REAL ledgers. A REAL BTC request is only a report of an asserted transfer: an administrator must independently inspect it and choose a USD credit amount; no blockchain verification or exchange-rate conversion is automated. The product does not provide a REAL BTC destination, so configure and operationally verify any actual receiving wallet and confirmation process outside this feature before soliciting transfers. Admin allocations update only the internal ledger; no payment, transfer, bank/card activity, or custody occurs. REAL withdrawal approval leaves funds reserved and incomplete; no external payout provider is configured, and the settlement endpoint refuses to mark REAL withdrawals complete. REAL investment requests can be reserved, reviewed, activated, completed, and settled only as simulated ledger activity; settlement returns reserved principal and does not credit configured target estimates as earnings. These actions do not create an external investment or return. Manual KYC status is explicitly an administrator review and is not external identity/AML or regulatory verification.

Private file workflows require server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The key must never be placed in a `NEXT_PUBLIC_*` variable or imported into client components. Configure these existing private buckets (the application does not create buckets): `kyc-documents` (10 MB), `profile-avatars` (5 MB), `wallet-receipts` (10 MB), and `support-attachments` (10 MB). Their restrictive `storage.objects` RLS policies are `aurevia_kyc_documents_block_client_access`, `aurevia_profile_avatars_block_client_access`, `aurevia_wallet_receipts_block_client_access`, and `aurevia_support_attachments_block_client_access`; each blocks all operations by `anon` and `authenticated` for its bucket. Trusted server routes use the service role only after session, record-ownership, or administrator checks. New object keys use `<userId>/<generated-UUID>.<extension>`. Upload routes verify signatures, MIME type, extension, size, and owning database record; file replacement is non-upserting and owner-scoped. File access uses signed URLs for at most five minutes. Users can retrieve their own KYC documents through the owner-filtered document route; administrator KYC review requires `requireAdmin`. KYC accepts JPEG, PNG, WebP, and PDF up to 8 MB; administrators can review uploaded files from `/admin`. No external identity, AML, sanctions, or malware-scanning provider is connected.

### Provider status and safe fallbacks

| Capability | Provider/configuration | Current behavior without provider |
| --- | --- | --- |
| Database | Supabase Postgres; `DATABASE_URL`, `DIRECT_URL` | Server operations fail explicitly; no in-memory financial fallback |
| Market information | Finnhub when `FINNHUB_API_KEY` is configured; Yahoo Finance chart endpoint as an unofficial fallback | Live market screens show provider source and freshness; provider failures show unavailable/stale data; internal prices are separately labelled simulated |
| Broker/execution | Shared Alpaca PAPER execution for REAL orders only when explicitly enabled; live execution disabled | DEMO remains internal simulation; paper fills never alter Aurevia REAL ledger or positions |
| Deposits and withdrawals | Funding-provider contract only; no bank, card, blockchain, or custody adapter | REAL BTC credits require separate manual verification and approval; withdrawals are capped to verified BTC-funded balance and remain incomplete without a payout provider |
| Investments | No investment execution/settlement provider | Allocations reserve internal funds; settlement returns reserved principal only and never converts an estimated target return into earnings |
| Identity/KYC | No identity verification provider configured | Documents/details can be submitted for human review only; approval is an administrator decision |
| Email/OTP | SMTP settings and verification delivery URL/key pairs | No email/SMS is claimed sent; verification-dependent actions report unavailable |
| Private files | Supabase Storage URL, private bucket, service-role key | Upload and signed access fail closed; no public-file fallback |
| Deployment | No deployment provider configuration is checked into this repository | Production secret injection, domains, TLS, backups, monitoring, and release controls must be configured in the hosting environment |
| SMS/OTP | `VERIFICATION_SMS_API_URL`, `VERIFICATION_SMS_API_KEY` | SMS verification cannot be completed; when required, registration fails closed |

Password recovery tokens are random, single-use, expire after 30 minutes, and are stored only as SHA-256 hashes. Resetting a password revokes the active account session. Successful and failed credential attempts are written to the existing admin-only audit log with a validated IP when available, bounded user-agent text, and a hashed identifier for unknown accounts; no password or raw token is stored.

For a real deployment, use a unique high-entropy `NEXTAUTH_SECRET`, a strong administrator password, and managed secret storage.

## Local setup

```bash
npm install
cp .env.example .env
# For the local Postgres container, set DATABASE_URL and DIRECT_URL to its connection URL.
docker compose up -d postgres
npx prisma generate
npm run db:migrate
npm run db:seed
npm run typecheck
npm test
npm run build
npm run dev
```

Open `http://localhost:3000`.

The application server owns the HTTP server and Socket.io endpoint, so use `npm run dev` rather than `next dev` when realtime functionality is required.

## Administrator provisioning

```text
Username: configured with ADMIN_USERNAME
Email: configured with ADMIN_EMAIL
Password: configured with ADMIN_PASSWORD
```

Set `ADMIN_USERNAME`, `ADMIN_EMAIL`, and a unique, strong `ADMIN_PASSWORD` in the deployment secret manager or an ignored local `.env` file. No administrator password is included in the repository. On a fresh database, use those exact credentials at `/admin/login`; first sign-in provisions the ADMIN account. If an admin already exists and the configured email is unused, first sign-in updates that existing admin record to the configured identity rather than creating a second one. Alternatively, run `npm run db:seed` to provision explicitly.

## Docker

```bash
docker compose up --build
```

The included compose file starts PostgreSQL and the app. It requires the database, NextAuth, and administrator values from `.env`; it contains no default credentials.

## Test workflow

### 1. Health

Open:

```text
GET /api/health
```

Expected response includes `ok: true` and `database: "ok"`.

### 2. Admin login

Open `/login` and use the configured administrator credentials. `/admin` must be accessible only to an ADMIN JWT.

### 3. User registration

Create a normal account from `/register`, sign in, and confirm `/dashboard`, `/trade`, `/wallet`, `/kyc` and `/settings` are protected routes.

### 4. Identity review

Submit the profile and identity documents for private administrator review. Tier 3 is granted only after an authorized administrator approves the request. This is an internal review, not external identity, bank, broker, government, or regulatory verification; simulated account access is separate from identity status.

### 5. Simulated funding

From `/wallet`, submit a funding request for the selected account mode. DEMO deposits and withdrawals are simulated; an authorized administrator can post a virtual credit or complete a virtual debit. REAL BTC deposits remain pending until an administrator manually verifies the evidence and separately approves an explicit USD ledger credit. REAL withdrawal requests are limited to the remaining verified BTC-funded balance; admin approval reserves the request but does not complete it. No external payout provider is configured, so REAL withdrawals remain incomplete and no money is paid. Rejection or cancellation releases a reservation. No payment method, bank, card, custody wallet, or payout provider is connected.

DEMO accounts start with a one-time $5,000 virtual USD balance. REAL-mode accounts start at zero and can trade only against funds credited to their own REAL ledger, such as an administrator-approved simulated deposit. No DEMO balance is transferred into REAL. DEMO and REAL-interface balances, orders, positions, transactions, and P&L remain isolated. Administrators may issue audited simulated credits to either account mode. The `/admin/markets` page can generate bounded, audited price changes for supported simulation instruments; it does not publish live quotes. Users can select a persistent display currency across wallet, dashboard, portfolio, activity, and USD transaction history; conversions are informational only and never change underlying ledger balances.

### 6. Trading

After initializing a DEMO account or approving a simulated deposit request:

1. Open `/trade`.
2. Select an instrument.
3. Place a Market order.
4. Confirm an execution and position appear.
5. Watch the price update through Socket.io.
6. Confirm unrealized P&L changes.
7. Close the position.
8. Confirm margin plus realized P&L is returned to the user ledger.

For Limit and Stop orders, place an order outside the current trigger price, then wait for the market simulator to reach its trigger. The server processes eligible open orders on market ticks.

### 7. Ledger invariant

Every posted monetary transaction contains exactly one debit and one credit for the same amount. The test suite also covers positive monetary quantities.

### 8. Admin controls

From `/admin`, test:

- Freeze/unfreeze a user
- Approve/reject KYC
- Change USER/ADMIN role
- Approve/reject funding
- Reject historical DEMO funding requests; release only stale DEMO withdrawal reservations
- Force-close positions
- Enable/disable instruments
- Generate audited SIMULATED price ticks from `/admin/markets`

Client stories are private drafts until an administrator links and verifies the client, records a completed REAL withdrawal with its settlement reference, records publication consent, and approves the story. The repository does not include the supplied story photos or a configured image-storage provider, so seeded drafts have no image reference. No story, financial amount, or verification badge is published by seeding.
- Change system settings
- Inspect audit logs

### 9. API checks

Useful endpoints:

```text
GET  /api/health
GET  /api/market
GET  /api/candles?instrumentId=<id>&limit=100
GET  /api/orderbook?instrumentId=<id>
GET  /api/orders
POST /api/orders
DELETE /api/orders
GET  /api/positions
POST /api/positions
GET  /api/wallet
POST /api/wallet
GET  /api/kyc
POST /api/kyc
```

## Production hardening checklist

Before any real-money use, add and independently verify:

- Managed PostgreSQL with backups and point-in-time recovery
- Distributed rate limiting rather than process-memory rate limiting
- TOTP/WebAuthn 2FA with recovery codes
- Email/phone verification
- Independent KYC verification provider and document malware scanning
- AML and sanctions screening
- Real payment/custody integrations
- External market-data and execution integrations
- Reconciliation jobs
- Idempotency keys for every financial POST operation
- CSRF/origin controls appropriate to the deployment topology
- Structured security logging and alerting
- Secrets manager
- WAF/DDoS controls
- Database connection pooling
- Penetration testing
- Dependency/SBOM scanning
- Disaster recovery testing
- Regulatory review for every operating jurisdiction

## Project structure

```text
app/
  api/                 REST API routes
  admin/               admin control center
  dashboard/           portfolio dashboard
  trade/               trading terminal
  wallet/              funding interface
  kyc/                 KYC interface
  settings/            account settings
  login/               authentication UI
  register/            onboarding UI
components/            reusable React components
lib/                    authentication, ledger, market and order engines
prisma/                 schema and seed
server.ts               Next.js + Socket.io application server
tests/                  automated tests
Dockerfile              application image
docker-compose.yml      PostgreSQL + application orchestration
```

## Final implemented application surface

The current source includes:

- Dedicated `/admin/login` administrator entry point with role enforcement.
- Realtime Socket.io market ticks and execution broadcasts.
- Synthetic depth/order-book endpoint at `/api/orderbook`.
- Historical candle endpoint at `/api/candles`.
- User ledger transaction endpoint at `/api/ledger`.
- Full order retrieval and cancellation API.
- Market, limit and stop order triggering.
- Serializable order execution and leverage-aware margin reservation.
- Trading-fee ledger postings.
- Open-position unrealized P&L on the dashboard and trading terminal.
- Pending-withdrawal balance reservation checks.
- Admin instrument creation, enable/disable, price and leverage editing.
- Admin self-protection against freezing or demoting the currently logged-in administrator.
- Global loading, error and not-found UI states.
- Health endpoint suitable for container/load-balancer checks.

## Verification evidence

A final verification run completed successfully: `npm run typecheck`; `npm test` (33 files, 166 tests); `npm run build`; `npm run test:e2e:isolated` (369 Playwright tests against disposable loopback PostgreSQL, with all 29 local migrations); `npm run lint`; `npx prisma validate`; and `npm audit --audit-level=high` (zero vulnerabilities). Vitest 4 addresses advisories in the prior test runner; Tailwind CSS 4 requires Safari 16.4+, Chrome 111+, or Firefox 128+; and the Next lint-plugin dependency tree uses ESLint's compatibility shim and a scoped patched `glob` override. Receipt image/PDF export uses a renderer that supports Tailwind's modern CSS color functions. The isolated E2E harness removed its temporary database container. No production migration or deployment was performed.

This verification does not clear production for release. The last read-only migration-status check found `20261019103000_alpaca_paper_order_account` and `20261019120000_btc_funding_and_paper_buying_power` unapplied in the configured database, while its history recorded `20261013110000_payment_method_network`, which is absent from this checkout and Git history. Reconcile that history with the database owner and review existing BTC transaction references for duplicates before considering the partial unique index; do not mark migrations applied or run SQL until the intended migration contents and production data are verified and an authorized migration plan is approved. Alpaca Paper account retrieval has not been verified with rotated credentials; paper-order submission remains disabled and live execution remains disabled.

For local development only, point `DATABASE_URL` and `DIRECT_URL` at a disposable local database before running database setup commands. Never run migrations or database reset/push commands against production without an explicitly reviewed migration plan and authorization.

```bash
npm ci
npx prisma generate
npm run db:migrate
npm run db:seed
npm run typecheck
npm test
npm run build
npm run dev
```

This remains a simulated/internal trading and accounting platform. It is not, by itself, a licensed real-money brokerage, payment processor, custodian, KYC provider, or external execution venue.

## Aurevia stability and UX upgrade (2026-09)

This revision incorporates the recurring issues identified during the Aurevia deployment journey:

- Explicit client-side registration/login actions prevent the browser's native form GET from racing React hydration.
- Registration and login now expose network/API failures instead of silently stalling.
- Authentication keeps the existing NextAuth JWT session model; logout returns to `/login` without invalidating a valid session on ordinary refresh.
- A single startup shell provides an 8-second first-entry animation and a 3-second transition for subsequent route changes. It uses session storage to avoid an endless loading loop.
- The loading UI is finite and deterministic; there is no perpetual page reload or blinking redirect loop.
- Mobile navigation is full-width, touch-friendly, and avoids desktop side gutters/zoom-style layouts.
- The Aurevia metallic gold emblem supplied in the project assets is included at `public/aurevia-logo.png` and used in startup, navigation, login, registration, and the landing page.
- The interface uses a forest-green/black/gold visual system and broker-style trading cards, market views, order ticket, positions, notifications, KYC and account controls.
- The Stanbic IBTC E-Trade page was used only as a UX/functionality reference: mobile/web trading, live market data, account control, order workflows, portfolio visibility and trade notifications. Proprietary logos, copy, artwork and source code are not copied.

### Regression checklist

1. First visit: startup overlay completes once in 8 seconds.
2. Internal navigation: transition completes in 3 seconds.
3. Browser refresh: session is not deliberately cleared.
4. Logout: returns to login and does not trigger an infinite startup/redirect loop.
5. Registration: no native `/register?` submission; request goes to `/api/register` only after the user presses Continue.
6. Login: failed authentication shows an error and does not silently hang.
7. Mobile: navigation opens as an overlay and content remains within the viewport.
8. Branding: supplied Aurevia logo is loaded from the app's public assets.
