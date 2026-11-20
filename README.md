# KARAOKEWEBAPP

KARAOKEWEBAPP is a multi-tenant marketplace for independent karaoke and event
equipment rental businesses. It is not a karaoke music or playback service.

The shared Ionic Angular standalone frontend serves web and Android. A FastAPI
backend handles authentication, tenant-scoped rental orders and inventory,
business and platform administration, payment-proof review, and audit records.
PostgreSQL is the application database.

## Requirements and policies

Confirmed workflows and decisions are recorded in
[docs/requirements.md](docs/requirements.md). Rental duration/billing policy,
refund eligibility, media storage, hosting domain, and customer notifications
are intentionally not invented. Catalog prices are visible but non-billable
until an administrator configures a pricing basis. Checkout stays unavailable
for any item with incomplete pricing.

## Local development (PowerShell)

Prerequisites: Node.js/npm, Python 3.11+, Docker Desktop, and (for Android)
Android Studio with its supported JDK and Android SDK.

1. Copy `.env.example` to `.env`. Set the same strong local password in
   `POSTGRES_PASSWORD` and the `DATABASE_URL` password, and replace
   `SECRET_KEY` with a randomly generated value of at least 32 characters. Do
   not commit `.env`.

   ```powershell
   Copy-Item .env.example .env
   ```

   Generate a key with:

   ```powershell
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

2. Create the virtual environment and install backend dependencies once:

   ```powershell
   python -m venv backend\.venv
   & 'backend\.venv\Scripts\python.exe' -m pip install -r backend\requirements-dev.txt
   docker compose up -d database
   ```

3. Apply migrations and create the first platform administrator:

   ```powershell
   & 'backend\.venv\Scripts\python.exe' -m alembic -c backend\alembic.ini upgrade head
   $env:PYTHONPATH = 'backend'
   & 'backend\.venv\Scripts\python.exe' -m app.cli create-admin --email admin@example.com --name "Rental Administrator"
   ```

   The tenant migration creates five manageable demo businesses in PostgreSQL
   (EchoVibe Karaoke Rentals, MicDrop Karaoke Hub, SoundWave Rentals,
   PartyPulse Karaoke, and EncoreBeat Rentals). Existing single-business
   catalog and rental records are assigned to an unlisted `Legacy Karaoke`
   tenant, and existing administrator accounts become platform administrators.
   Demo tenants start with categories and quality labels; add each business's
   products, assets, and packages from its dashboard. New businesses can apply
   through **List your business** and remain pending until approved.

   To seed the original sample catalog into Legacy Karaoke, optionally run:

   ```powershell
   $env:PYTHONPATH = 'backend'
   & 'backend\.venv\Scripts\python.exe' -m app.cli seed-catalog
   ```

   Catalog seed prices are not billable until a business administrator configures
   a billing basis. Stock starts at zero; add individually tagged physical assets.

4. Run the API and frontend in separate terminals:

   ```powershell
   & 'backend\.venv\Scripts\python.exe' -m uvicorn app.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
   ```

   ```powershell
   npm start
   ```

   Web: `http://localhost:4200`. API docs: `http://localhost:8000/docs`.
   Restart the API after changing `.env`.

## Tests and builds

```powershell
& 'backend\.venv\Scripts\python.exe' -m pytest backend\tests -q
npm run build
npm run test:unit
npm run lint
npm run test:e2e
```

The Angular production web build uses `/api`; deploy the API behind the same
origin or change `src/environments/environment.prod.ts` to the HTTPS API URL.
`build:android` currently points the Android emulator at `10.0.2.2:8000`.
Before any Android release, replace that development URL in
`src/environments/environment.android.ts` with the deployed HTTPS API origin.
Never ship the emulator address in a release.

## Android

The current workspace originally had no Android platform, Android Studio, or
Android SDK, and the installed Java runtime is Java 8. Capacitor Android builds
require JDK 21 and the Android SDK; install Android Studio with JDK 21 selected
before building.

After Android Studio and its toolchain are installed:

```powershell
npm run build:android
npx cap sync android
npx cap open android
```

For later frontend changes, rebuild and run `npx cap sync android` to copy the
shared web assets and update native plugins. A release APK/AAB is produced
through Android Studio/Gradle after configuring the production API URL, signing,
and release metadata. Android device builds have not been verified in this
environment.

## Operations and security

- Run migrations with Alembic; do not use `create_all()` in production.
- Public account creation always creates a customer. Provision admins using the
  CLI; public business registration creates a pending business owner and grants
  no management access before platform approval.
- Passwords use Argon2 hashes. Bearer tokens are short-lived and stored only in
  browser session storage. Use HTTPS outside local development and protect
  `SECRET_KEY` and database credentials as deployment secrets.
- Tenant APIs derive business access from the authenticated account and scope
  business-owned queries by `business_id`. Platform administrator access is a
  separate role. The API does not use ambient cookie authentication; clients
  send bearer tokens in the `Authorization` header, and credentialed CORS is
  disabled to reduce CSRF exposure. Configure exact trusted CORS origins.
- Login and registration have per-process IP rate limits. Use a shared rate
  limit store at multi-worker deployment scale.
- Product and package prices are integer minor units in PostgreSQL. Reservation
  and modification services serialize changes by locking affected product
  rows; PostgreSQL is required for this concurrency guarantee.
- Manual payment status changes only after administrator verification. No
  online payment provider, automatic refund, deposit, payment deadline, or
  cancellation fee is implemented.
- Back up PostgreSQL, including uploaded product, package, storefront, and
  payment-proof images, and
  configure production CORS origins, database access, monitoring, and retention
  before public deployment.

## Deployment

See [docs/deployment.md](docs/deployment.md) for the GitHub Actions workflow,
Render Blueprint, Neon connection setup, and deployment checklist.
