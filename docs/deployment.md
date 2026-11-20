# Deploying to GitHub, Render, and Neon

The repository includes a Render Blueprint (`render.yaml`) and a GitHub Actions
workflow (`.github/workflows/ci.yml`). The Blueprint creates a FastAPI web
service and an Angular static site; the static site forwards `/api` requests to
the API service, so the frontend can keep its relative production API URL.

## 1. Push the repository to GitHub

Create a GitHub repository and push this project to its `main` branch. Do not
commit `.env`, connection strings, or other credentials. GitHub Actions runs
the backend tests, frontend unit tests, lint, and production build on pushes and
pull requests.

Render's Blueprint uses `autoDeployTrigger: checksPass`, so deploys from GitHub
wait for CI checks to pass.

## 2. Create a Neon project

Create a PostgreSQL project in Neon and copy both connection strings:

- Set the pooled connection string as Render's `DATABASE_URL` for application
  traffic. The hostname contains `-pooler`.
- Set the direct, unpooled connection string as Render's
  `ALEMBIC_DATABASE_URL` for Alembic migrations.

The app uses Psycopg 3. Prefix each Neon connection URL with
`postgresql+psycopg://` (instead of `postgresql://`) before adding it to
Render. Keep the URL's existing credentials, hostname, database name, and query
parameters. Do not add a Neon URL to this repository.

## 3. Create the Render Blueprint

In Render, choose **New > Blueprint**, connect the GitHub repository, and
deploy the Blueprint from `render.yaml`. Provide the requested secret values:

- `DATABASE_URL`: Neon pooled URL with the `postgresql+psycopg://` driver
  prefix.
- `ALEMBIC_DATABASE_URL`: Neon direct URL with the same driver prefix.
- `SECRET_KEY`: a unique cryptographically random value of at least 32
  characters. Generate one with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.

The Blueprint runs `alembic upgrade head` before starting the API, using the
direct migration URL. On a new Neon database, this creates the schema and the
five initial demonstration businesses.

The API service uses a paid Render compute plan because Render only supports
pre-deploy commands on paid web services. Review Render's current pricing before
deploying. Neon and Render charges depend on account plans and usage.
The API is configured for Singapore to match the selected Neon region.

## 4. Verify the deployment

After both services deploy:

1. Open `https://karaoke-marketplace.onrender.com`.
2. Verify `https://karaoke-marketplace-api.onrender.com/api/health` returns
   `{"status":"ok"}`.
3. Confirm the marketplace loads and that business registration and sign-in
   requests reach the API.
4. Open the API service's Shell in Render and run
   `PYTHONPATH=backend python -m app.cli create-admin --email admin@example.com --name "Platform Administrator"`.
   The command securely prompts for the password twice. Use your intended
   administrator email and name; do not put administrator credentials in the
   Blueprint or source control.

The Blueprint's frontend proxy and API CORS setting assume the default Render
service hostnames shown above. If Render assigns different hostnames (for
example, due to a name collision) or you add a custom frontend domain, update
the frontend API rewrite destinations and the API's `CORS_ORIGINS` value to
match.

## Operations

- `/api/live` is the lightweight Render liveness probe; `/api/health` performs
  a database query for an explicit connectivity check. Keeping the recurring
  liveness probe database-free allows Neon to suspend an idle Free compute.
- Neon Free is limited to 100 CU-hours and 1 GB per project. It is intended for
  testing, not reliable production. A continuously active 0.25-CU compute uses
  the monthly allowance in about 400 hours; real usage depends on traffic.
- Migrations are automated before each API deployment. Test schema changes on
  a non-production Neon branch before applying them to production.
- Product, package, storefront, and payment-proof images are stored in the
  PostgreSQL database; the service does not depend on local persistent files.
- The project has no Git remote configured yet. Creating the GitHub repository,
  connecting accounts, supplying secrets, and deploying the Blueprint remain
  account-owner steps.
