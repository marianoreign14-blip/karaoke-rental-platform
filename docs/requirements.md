# KARAOKEWEBAPP requirements and architecture

## Confirmed marketplace scope

KARAOKEWEBAPP is a centralized marketplace for independent karaoke rental
businesses. It is not a karaoke music, streaming, or playback service. The
existing Ionic Angular standalone application is the shared web and Android
client. FastAPI provides the API and PostgreSQL stores application data.

Customer marketplace workflows:

- Browse and search active businesses, open branded storefronts, and browse
  business-specific products and rental packages.
- View product images, quality labels, editable catalog prices, and stock
  availability for a selected rental window.
- Filter and sort product catalogs by category, quality, availability, and price.
- Register, sign in, manage a profile, submit orders, and review order history.
- Submit payment details and optional image proof for business review.
- Request order changes or cancellation. These requests do not change the order
  or release stock until an administrator decides them.
- View payment status, balance, history, and proof. Customer-submitted payment
  information is not verified automatically.

Business administrator and staff workflows:

- Manage tenant-owned storefront branding, categories, quality labels,
  products, prices, packages, inventory assets, and physical equipment condition.
- Review, confirm, or reject orders and customer change/cancellation requests.
- Record offline payments or verify/reject customer-submitted payment details
  and proof.
- Review inventory, rental, and revenue summaries.
- Business administrators can manage staff accounts; staff and business owners
  are restricted to their business.

Platform administrator workflows:

- Review and approve/reject business registrations; activate, suspend, and list
  businesses; manage subscriptions and platform settings.
- View platform statistics and create business administrator accounts.

Roles are customer, platform administrator, business administrator, business
staff, and pending business owner. Public account registration creates
customers. Business registration creates a pending tenant and owner; business
management access is withheld until approval. Existing records migrate into the
unlisted `Legacy Karaoke` tenant. The five initial demo businesses are
database records created by migration, not hardcoded application choices.

The initial demo tenants and palette defaults are:

| Business | Brand palette |
| --- | --- |
| EchoVibe Karaoke Rentals | Black, gold, cream |
| MicDrop Karaoke Hub | Purple, black, neon pink |
| SoundWave Rentals | Navy blue, sky blue, white |
| PartyPulse Karaoke | Orange, yellow, charcoal |
| EncoreBeat Rentals | Burgundy, black, silver |

These are editable tenant records; additional businesses can register without
changing application logic.

## Explicit business rules

- Inventory is tentatively allocated to an order at submission. An administrator
  must confirm it. Rejection releases the allocation; no automatic expiration
  is configured.
- Rental start and end are customer-supplied timestamps. The only validation is
  that both are present and the end follows the start. There is no assumed
  hourly, daily, or fixed rental term, pickup/return deadline, late fee, or
  automatic cancellation cutoff.
- The sample prices in this document's source requirements are editable catalog
  prices only. They are not charges until an administrator configures a billing
  basis and (for duration-based rates) a billing interval and rounding rule.
  Products and packages with incomplete pricing cannot be checked out. New
  products default to per-rental billing.
- Packages have administrator-defined contents and an independently configured
  package price rule. Package contents consume inventory; they are not added a
  second time to the package price.
- Payment is offline/manual. Supported methods are Cash, GCash, and Bank
  Transfer. Only an administrator-verified payment affects the paid balance.
  Deposit, deadline, gateway, and refund policies are not configured.
- Change and cancellation requests are retained in order history. Only an
  authorized administrator decision changes order lines/status or releases
  inventory. No cancellation fee or refund behavior is assumed.
- Quality classifications (initial labels: Basic, Standard, Premium) are
  editable per-business catalog metadata, independent of each item's physical condition.
  Condition is managed per physical asset; reservation/current rental status is
  derived from its allocations and time window.
- Sample catalog values are initialized in the backend, not frontend arrays.
  New products default to the active Standard classification, per-rental
  billing, and customer-catalog visibility. Initial stock creates individually
  tagged available inventory assets; stock reductions preserve assets reserved
  for active rentals.
  Administrators can upload optional product and package images in JPEG, PNG,
  or WebP format (up to 5 MB); image data is stored in PostgreSQL.
- Business profile and storefront branding (logo, banner, colors, description,
  and contact details) are tenant-specific. New business applications require
  platform review before their owner can manage business data.
- Customer payment proof is optional JPEG, PNG, or WebP (up to 5 MB), stored in
  PostgreSQL and viewable only by the submitting customer and that business's
  authorized staff. Payment still requires administrator verification.

## Relational model

- `businesses`: tenant status, storefront branding, contact details, and
  subscription metadata. Initial demo tenants are seeded in the migration.
- `users`: customer/platform/business identity, password hash, profile, and
  optional `business_id`.
- `business_customers`: per-business customer relationship and active status.
- `business_categories` and `quality_tiers`: business-managed catalog labels.
- `products`: tenant-owned equipment entries, tier, editable price, image
  URL or uploaded image data, and optional administrator-configured pricing rule.
- `inventory_assets`: individually identified physical assets, condition, and
  product assignment.
- `rental_packages` and `package_components`: tenant-owned package price rule,
  optional uploaded image data, and the product quantities consumed by each package.
- `rental_orders` and `order_lines`: customer, requested time window, workflow
  status, and immutable price snapshots at order submission.
- `inventory_allocations`: asset-level reservations tied to order lines and
  time windows.
- `order_requests` and `order_history`: customer change/cancellation requests,
  administrator decisions, and preserved before/after snapshots.
- `payments`: tenant-owned submitted or administrator-recorded offline
  payment/refund entries, proof image, verification details, references, and
  responsible administrator.
- `business_audit_logs` and `platform_settings`: administrative activity and
  platform configuration.

PostgreSQL is selected for relational integrity, transaction support, and
serialization of concurrent inventory reservations. Order placement and
modification lock affected product rows before checking and allocating assets.
PostgreSQL is the required runtime database; tests may use an isolated test
database, but SQLite is not a supported concurrent production substitute.

## API outline

- `/api/auth`: customer and pending-business registration and token sign-in.
- `/api/users/me`: profile retrieval and update.
- `/api/marketplace/businesses`: public directory and business storefronts.
- `/api/catalog/products`, `/api/catalog/packages`, `/api/catalog/availability`:
  tenant-filtered customer catalog and time-window availability.
- `/api/orders`: submit and view orders; `/api/orders/{id}/requests` submits
  change/cancellation requests; `/api/orders/{id}/payments` submits payment
  details and proof.
- `/api/admin/*`: business-scoped product, category, quality, inventory,
  package, order, request, payment, staff, storefront, and report administration.
- `/api/platform/*`: platform-scoped business approval, listing, subscription,
  settings, and platform summary.

OpenAPI documentation is served by FastAPI at `/docs`. All order prices and
allocation data are validated and persisted server-side.

## Authorization and CSRF

Business endpoints derive the tenant from the authenticated user's `business_id`
and scope data queries to it; customer orders are verified against their tenant.
Platform administrator endpoints use a separate role. Authentication uses
short-lived bearer tokens in browser session storage, not automatically
attached cookies. The API therefore requires clients to explicitly send the
`Authorization` header, disables credentialed CORS, and allows only configured
origins and methods. Use HTTPS and keep the trusted-origin list narrow in
deployment. This avoids ambient-cookie CSRF; it does not replace XSS prevention
or server-side role and tenant checks.

## Still to confirm

- Rental duration convention, pickup/return scheduling, and pricing rules.
- Refund and cancellation eligibility, if it should be narrower than
  administrator review.
- Production hosting/domain, data backup, and customer notification channels.
- Detailed reporting definitions (for example, revenue recognition date).

Unconfirmed policy must be configured by a business administrator or remain
unavailable to checkout; it must not be silently defaulted.
