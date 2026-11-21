from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
from pathlib import Path
import secrets

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, select

from app.core.database import Base, get_db
from app.core.security import hash_password
from app.models import PasswordResetToken, User, UserRole
from tests.test_audit_fixes import _create_second_business, _open_db
from tests.test_rental_workflows import (
    END,
    START,
    auth_header,
    client_token_for_user,
    create_account,
    create_admin,
    create_platform_admin,
    order_payload,
    seed_product,
    token_for,
)


def test_end_to_end_four_role_rental_lifecycle(client):
    # 1. Seed platform admin
    create_platform_admin(client)
    platform_headers = auth_header(token_for(client, "platform@example.com", "secure-platform-password"))

    # 2. Business owner registers a new business
    reg = client.post(
        "/api/auth/business-register",
        json={
            "business_name": "Starlight Sound Rentals",
            "owner_name": "Marco Santos",
            "email": "marco@starlight.example.com",
            "contact_number": "09171234567",
            "address": "123 Music Ave, Manila",
            "password": "owner-password-12345",
        },
    )
    assert reg.status_code == 201, reg.text
    business_id = reg.json()["business_id"]

    # 3. Pending business owner checks application status
    owner_pending_headers = auth_header(token_for(client, "marco@starlight.example.com", "owner-password-12345"))
    app_status = client.get("/api/users/me/business-application", headers=owner_pending_headers)
    assert app_status.status_code == 200, app_status.text
    assert app_status.json()["name"] == "Starlight Sound Rentals"
    assert app_status.json()["status"] == "pending"

    # 4. Platform admin receives notification, marks it read, and approves the business
    platform_notifs = client.get("/api/notifications", headers=platform_headers)
    assert platform_notifs.status_code == 200
    assert platform_notifs.json()["unread_count"] >= 1
    first_notif_id = platform_notifs.json()["items"][0]["id"]
    mark_read = client.patch(f"/api/notifications/{first_notif_id}/read", headers=platform_headers)
    assert mark_read.status_code == 200
    assert mark_read.json()["is_read"] is True

    approve = client.patch(
        f"/api/platform/businesses/{business_id}/status",
        json={"status": "active", "note": "Verified business documents"},
        headers=platform_headers,
    )
    assert approve.status_code == 200, approve.text
    assert approve.json()["status"] == "active"

    # 5. Business owner signs in after approval, receives approval notification, sets up catalog & staff
    owner_headers = auth_header(token_for(client, "marco@starlight.example.com", "owner-password-12345"))
    owner_notifs = client.get("/api/notifications", headers=owner_headers)
    assert owner_notifs.status_code == 200
    assert any(item["kind"] == "business_status_changed" for item in owner_notifs.json()["items"])

    tiers = client.get("/api/admin/quality-tiers", headers=owner_headers)
    assert tiers.status_code == 200 and len(tiers.json()) > 0
    tier_id = tiers.json()[0]["id"]

    prod = client.post(
        "/api/admin/products",
        json={
            "name": "Pro Party Karaoke System",
            "description": "Dual wireless mics and 32-inch screen",
            "category": "karaoke",
            "quality_tier_id": tier_id,
            "price_cents": 250_000,
            "pricing_basis": "per_rental",
            "is_active": True,
            "initial_stock": 2,
        },
        headers=owner_headers,
    )
    assert prod.status_code == 201, prod.text
    product_id = prod.json()["id"]

    pkg = client.post(
        "/api/admin/packages",
        json={
            "name": "Fiesta Bundle",
            "description": "Everything for a house party",
            "price_cents": 230_000,
            "pricing_basis": "per_rental",
            "is_active": True,
            "components": [{"product_id": product_id, "quantity": 1}],
        },
        headers=owner_headers,
    )
    assert pkg.status_code == 201, pkg.text
    package_id = pkg.json()["id"]

    staff_create = client.post(
        "/api/admin/staff",
        json={
            "email": "staff@starlight.example.com",
            "display_name": "Ana Cruz",
            "phone": "09170001111",
            "password": "staff-password-12345",
        },
        headers=owner_headers,
    )
    assert staff_create.status_code == 201, staff_create.text

    # 6. Business staff logs in, updates own profile & password, and respects RBAC boundaries
    staff_headers = auth_header(token_for(client, "staff@starlight.example.com", "staff-password-12345"))
    assert client.get("/api/admin/business", headers=staff_headers).status_code == 200
    assert client.put("/api/users/me", json={"display_name": "Ana M. Cruz", "phone": "09179998888"}, headers=staff_headers).status_code == 200
    pw_change = client.put(
        "/api/users/me/password",
        json={"current_password": "staff-password-12345", "new_password": "staff-new-password-99"},
        headers=staff_headers,
    )
    assert pw_change.status_code == 200, pw_change.text
    staff_headers = auth_header(token_for(client, "staff@starlight.example.com", "staff-new-password-99"))
    # Staff cannot delete packages or create other staff
    assert client.delete(f"/api/admin/packages/{package_id}", headers=staff_headers).status_code == 403
    assert client.post(
        "/api/admin/staff",
        json={"email": "x@starlight.example.com", "display_name": "X", "password": "another-password-1234"},
        headers=staff_headers,
    ).status_code == 403

    # 7. Customer registers, inspects public product & package detail with availability, creates order
    cust_reg = client.post(
        "/api/auth/register",
        json={
            "email": "claire@example.com",
            "password": "customer-password-123",
            "display_name": "Claire Reyes",
            "phone": "09185554444",
        },
    )
    assert cust_reg.status_code == 201, cust_reg.text
    cust_headers = auth_header(cust_reg.json()["access_token"])

    prod_detail = client.get(f"/api/catalog/products/{product_id}", params={"starts_at": START, "ends_at": END})
    assert prod_detail.status_code == 200, prod_detail.text
    assert prod_detail.json()["available_count"] == 2
    assert prod_detail.json()["business"]["name"] == "Starlight Sound Rentals"

    pkg_detail = client.get(f"/api/catalog/packages/{package_id}", params={"starts_at": START, "ends_at": END})
    assert pkg_detail.status_code == 200, pkg_detail.text
    assert pkg_detail.json()["available_count"] == 2
    assert len(pkg_detail.json()["components"]) == 1

    order_res = client.post(
        "/api/orders",
        json={
            "business_id": business_id,
            "starts_at": START,
            "ends_at": END,
            "lines": [{"kind": "package", "item_id": package_id, "quantity": 1}],
        },
        headers=cust_headers,
    )
    assert order_res.status_code == 201, order_res.text
    order_id = order_res.json()["id"]

    # 8. Business staff sees notification, inspects order detail with allocated asset tags & booking calendar
    staff_notifs = client.get("/api/notifications", headers=staff_headers)
    assert staff_notifs.status_code == 200
    assert any(item["kind"] == "order_submitted" for item in staff_notifs.json()["items"])

    admin_detail = client.get(f"/api/admin/orders/{order_id}", headers=staff_headers)
    assert admin_detail.status_code == 200, admin_detail.text
    assert admin_detail.json()["customer_email"] == "claire@example.com"
    assert admin_detail.json()["customer_phone"] == "09185554444"
    assert len(admin_detail.json()["allocations"]) == 1
    assert admin_detail.json()["allocations"][0]["asset_tag"]

    cal = client.get("/api/admin/calendar", params={"starts_at": START, "ends_at": END}, headers=staff_headers)
    assert cal.status_code == 200, cal.text
    assert len(cal.json()) == 1
    assert cal.json()[0]["order_id"] == order_id
    assert len(cal.json()[0]["allocated_assets"]) == 1

    # 9. Staff confirms order -> Customer views detail -> submits payment + proof
    confirm = client.patch(
        f"/api/admin/orders/{order_id}/status",
        json={"status": "confirmed", "note": "Confirmed for pickup"},
        headers=staff_headers,
    )
    assert confirm.status_code == 200

    cust_order = client.get(f"/api/orders/{order_id}", headers=cust_headers)
    assert cust_order.status_code == 200
    assert cust_order.json()["status"] == "confirmed"

    pay = client.post(
        f"/api/orders/{order_id}/payments",
        json={
            "amount_cents": 230_000,
            "method": "gcash",
            "paid_at": START,
            "reference_number": "GC-987654",
            "notes": "Full payment",
        },
        headers=cust_headers,
    )
    assert pay.status_code == 201, pay.text
    payment_id = pay.json()["id"]

    proof_upload = client.put(
        f"/api/orders/{order_id}/payments/{payment_id}/proof",
        content=b"\x89PNG\r\n\x1a\nfake-proof-bytes",
        headers={**cust_headers, "Content-Type": "image/png"},
    )
    assert proof_upload.status_code == 200

    # 10. Staff filters payment ledger, verifies payment, and completes order
    ledger = client.get(
        "/api/admin/payments",
        params={"status": "submitted", "method": "gcash", "kind": "payment"},
        headers=staff_headers,
    )
    assert ledger.status_code == 200
    assert len(ledger.json()) == 1
    assert ledger.json()[0]["proof_available"] is True

    verify_pay = client.post(
        f"/api/admin/orders/{order_id}/payments/{payment_id}/decision",
        json={"approved": True, "note": "Verified on GCash"},
        headers=staff_headers,
    )
    assert verify_pay.status_code == 200

    complete = client.patch(
        f"/api/admin/orders/{order_id}/status",
        json={"status": "completed", "note": "Returned in good condition"},
        headers=staff_headers,
    )
    assert complete.status_code == 200

    # 11. Customer notifications & read-all
    cust_notifs = client.get("/api/notifications", headers=cust_headers)
    assert cust_notifs.status_code == 200
    assert cust_notifs.json()["unread_count"] >= 3  # confirmed + verified + completed
    read_all = client.post("/api/notifications/read-all", headers=cust_headers)
    assert read_all.status_code == 200
    assert client.get("/api/notifications", headers=cust_headers).json()["unread_count"] == 0

    # 12. Platform admin monitoring & moderation
    p_users = client.get("/api/platform/users", params={"role": "customer"}, headers=platform_headers)
    assert p_users.status_code == 200
    claire_row = next(u for u in p_users.json() if u["email"] == "claire@example.com")
    assert claire_row["order_count"] == 1

    # Self-deactivation blocked
    platform_me = client.get("/api/users/me", headers=platform_headers).json()
    assert (
        client.patch(
            f"/api/platform/users/{platform_me['id']}/active",
            json={"is_active": False},
            headers=platform_headers,
        ).status_code
        == 409
    )

    # Toggle customer active off and back on
    assert (
        client.patch(
            f"/api/platform/users/{claire_row['id']}/active",
            json={"is_active": False},
            headers=platform_headers,
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/platform/users/{claire_row['id']}/active",
            json={"is_active": True},
            headers=platform_headers,
        ).status_code
        == 200
    )

    p_products = client.get("/api/platform/products", params={"business_id": business_id}, headers=platform_headers)
    assert p_products.status_code == 200
    assert any(p["id"] == product_id for p in p_products.json())
    assert (
        client.patch(
            f"/api/platform/products/{product_id}/active",
            json={"is_active": False},
            headers=platform_headers,
        ).status_code
        == 200
    )
    # Deactivated product is now hidden from public detail
    assert client.get(f"/api/catalog/products/{product_id}").status_code == 404

    p_orders = client.get("/api/platform/orders", params={"business_id": business_id, "status": "completed"}, headers=platform_headers)
    assert p_orders.status_code == 200
    assert len(p_orders.json()) == 1

    p_payments = client.get("/api/platform/payments", params={"business_id": business_id, "status": "verified"}, headers=platform_headers)
    assert p_payments.status_code == 200
    assert len(p_payments.json()) == 1

    p_report = client.get("/api/platform/reports/summary", headers=platform_headers)
    assert p_report.status_code == 200
    report_data = p_report.json()
    assert report_data["orders"] == 1
    assert report_data["verified_collections_cents"] == 230_000
    biz_row = next(b for b in report_data["businesses"] if b["business_id"] == business_id)
    assert biz_row["verified_collections_cents"] == 230_000


def test_password_change_and_reset_flow_and_token_security(client):
    create_account(client, email="alex@example.com", password="initial-password-123")
    headers = auth_header(token_for(client, "alex@example.com", "initial-password-123"))

    # Wrong current password rejected
    bad_pw = client.put(
        "/api/users/me/password",
        json={"current_password": "wrong-password-1234", "new_password": "brand-new-password-1"},
        headers=headers,
    )
    assert bad_pw.status_code == 400

    # Same password rejected
    same_pw = client.put(
        "/api/users/me/password",
        json={"current_password": "initial-password-123", "new_password": "initial-password-123"},
        headers=headers,
    )
    assert same_pw.status_code == 422

    # Valid change works and IMMEDIATELY revokes pre-change JWT while returning a fresh rotated token
    ok_pw = client.put(
        "/api/users/me/password",
        json={"current_password": "initial-password-123", "new_password": "updated-password-456"},
        headers=headers,
    )
    assert ok_pw.status_code == 200
    assert "access_token" in ok_pw.json()
    assert client.get("/api/users/me", headers=headers).status_code == 401
    rotated_headers = auth_header(ok_pw.json()["access_token"])
    assert client.get("/api/users/me", headers=rotated_headers).status_code == 200
    assert client.post("/api/auth/login", json={"email": "alex@example.com", "password": "initial-password-123"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "alex@example.com", "password": "updated-password-456"}).status_code == 200

    # Forgot password without SMTP never leaks tokens or account existence
    forgot_existing = client.post("/api/auth/forgot-password", json={"email": "alex@example.com"})
    forgot_missing = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert forgot_existing.status_code == 200
    assert forgot_missing.status_code == 200
    assert forgot_existing.json() == forgot_missing.json()
    assert forgot_existing.json()["email_delivery_configured"] is False

    # Seed two tokens (one valid, one sibling) + one expired token
    raw_valid = secrets.token_urlsafe(32)
    raw_sibling = secrets.token_urlsafe(32)
    raw_expired = secrets.token_urlsafe(32)
    generator, db = _open_db(client)
    try:
        user = db.scalar(select(User).where(User.email == "alex@example.com"))
        now = datetime.now(timezone.utc)
        db.add_all(
            [
                PasswordResetToken(
                    user_id=user.id,
                    token_hash=hashlib.sha256(raw_valid.encode("utf-8")).hexdigest(),
                    expires_at=now + timedelta(minutes=30),
                ),
                PasswordResetToken(
                    user_id=user.id,
                    token_hash=hashlib.sha256(raw_sibling.encode("utf-8")).hexdigest(),
                    expires_at=now + timedelta(minutes=30),
                ),
                PasswordResetToken(
                    user_id=user.id,
                    token_hash=hashlib.sha256(raw_expired.encode("utf-8")).hexdigest(),
                    expires_at=now - timedelta(minutes=1),
                ),
            ]
        )
        db.commit()
    finally:
        generator.close()

    # Expired token fails
    assert (
        client.post(
            "/api/auth/reset-password",
            json={"token": raw_expired, "new_password": "reset-password-78901"},
        ).status_code
        == 400
    )

    # Valid token resets password once and revokes pre-reset JWT
    reset_ok = client.post(
        "/api/auth/reset-password",
        json={"token": raw_valid, "new_password": "reset-password-78901"},
    )
    assert reset_ok.status_code == 200, reset_ok.text
    assert client.get("/api/users/me", headers=rotated_headers).status_code == 401
    assert client.post("/api/auth/login", json={"email": "alex@example.com", "password": "reset-password-78901"}).status_code == 200

    # Replay & sibling tokens fail
    assert (
        client.post(
            "/api/auth/reset-password",
            json={"token": raw_valid, "new_password": "another-password-111"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/auth/reset-password",
            json={"token": raw_sibling, "new_password": "another-password-222"},
        ).status_code
        == 400
    )


def test_notification_isolation_delete_guards_and_enum_validation(client):
    product_id = seed_product(client, pricing_basis="per_rental", stock=2)
    create_admin(client)
    create_platform_admin(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    platform_headers = auth_header(token_for(client, "platform@example.com", "secure-platform-password"))

    cust_a = create_account(client, email="a@example.com", password="customer-password-123")
    cust_b = create_account(client, email="b@example.com", password="customer-password-123")
    headers_a = auth_header(token_for(client, "a@example.com", "customer-password-123"))
    headers_b = auth_header(token_for(client, "b@example.com", "customer-password-123"))
    assert cust_a and cust_b

    # Unused package & unused asset can be deleted
    unused_pkg = client.post(
        "/api/admin/packages",
        json={"name": "Unused Bundle", "components": [{"product_id": product_id, "quantity": 1}]},
        headers=admin_headers,
    )
    assert unused_pkg.status_code == 201
    assert client.delete(f"/api/admin/packages/{unused_pkg.json()['id']}", headers=admin_headers).status_code == 200

    unused_asset = client.post(
        "/api/admin/inventory",
        json={"product_id": product_id, "asset_tag": "TEMP-DEL-1", "condition": "available"},
        headers=admin_headers,
    )
    assert unused_asset.status_code == 201
    assert client.delete(f"/api/admin/inventory/{unused_asset.json()['id']}", headers=admin_headers).status_code == 200

    # Package & asset referenced by an order cannot be deleted (409)
    used_pkg = client.post(
        "/api/admin/packages",
        json={
            "name": "Booked Bundle",
            "price_cents": 120_000,
            "pricing_basis": "per_rental",
            "is_active": True,
            "components": [{"product_id": product_id, "quantity": 1}],
        },
        headers=admin_headers,
    )
    assert used_pkg.status_code == 201
    used_pkg_id = used_pkg.json()["id"]

    order = client.post(
        "/api/orders",
        json={
            "business_id": 1,
            "starts_at": START,
            "ends_at": END,
            "lines": [{"kind": "package", "item_id": used_pkg_id, "quantity": 1}],
        },
        headers=headers_a,
    )
    assert order.status_code == 201, order.text
    order_id = order.json()["id"]

    assert client.delete(f"/api/admin/packages/{used_pkg_id}", headers=admin_headers).status_code == 409

    detail = client.get(f"/api/admin/orders/{order_id}", headers=admin_headers)
    allocated_asset_id = detail.json()["allocations"][0]["asset_id"]
    assert client.delete(f"/api/admin/inventory/{allocated_asset_id}", headers=admin_headers).status_code == 409

    # Confirm order so customer A gets a notification; customer B cannot read/mark it
    client.patch(f"/api/admin/orders/{order_id}/status", json={"status": "confirmed"}, headers=admin_headers)
    notifs_a = client.get("/api/notifications", headers=headers_a).json()["items"]
    assert len(notifs_a) >= 1
    assert client.patch(f"/api/notifications/{notifs_a[0]['id']}/read", headers=headers_b).status_code == 404

    # Cross-tenant isolation on delete asset & order detail
    other_biz_id, _, other_asset_id, _, _ = _create_second_business(client)
    assert other_biz_id != 1
    assert client.delete(f"/api/admin/inventory/{other_asset_id}", headers=admin_headers).status_code == 404

    # Invalid enum query parameters return 422 cleanly (not 500)
    assert client.get("/api/platform/users", params={"role": "invalid_role"}, headers=platform_headers).status_code == 422
    assert client.get("/api/platform/orders", params={"status": "bogus"}, headers=platform_headers).status_code == 422
    assert client.get("/api/admin/payments", params={"method": "bitcoin"}, headers=admin_headers).status_code == 422


def test_alembic_b4d7f9e2c1a5_upgrade_and_downgrade_isolated(tmp_path):
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "b4d7f9e2c1a5_notifications_and_password_resets.py"
    )
    spec = importlib.util.spec_from_file_location("mig_b4d7", migration_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)

    db_file = tmp_path / "migration_test.sqlite"
    engine = create_engine(f"sqlite:///{db_file}")
    # Create only the pre-existing tables referenced by FKs (users, businesses)
    Base.metadata.tables["businesses"].create(engine)
    Base.metadata.tables["users"].create(engine)

    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            module.op = Operations(ctx)
            module.upgrade()

    tables_after_up = set(inspect(engine).get_table_names())
    assert "notifications" in tables_after_up
    assert "password_reset_tokens" in tables_after_up

    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            module.op = Operations(ctx)
            module.downgrade()

    tables_after_down = set(inspect(engine).get_table_names())
    assert "notifications" not in tables_after_down
    assert "password_reset_tokens" not in tables_after_down

    engine.dispose()


def test_deep_qa_security_business_logic_and_timezone_regressions(client):
    product_id = seed_product(client, pricing_basis="per_rental", stock=2)
    create_admin(client)
    create_platform_admin(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    platform_headers = auth_header(token_for(client, "platform@example.com", "secure-platform-password"))

    other_biz_id, other_prod_id, other_asset_id, _, _ = _create_second_business(client)
    assert other_biz_id != 1

    # 1. Production autoflush=False regression: PUT /api/admin/packages/{id} persists metadata AND components
    created_pkg = client.post(
        "/api/admin/packages",
        json={
            "name": "Initial Bundle",
            "description": "Before update",
            "price_cents": 100_000,
            "pricing_basis": "per_rental",
            "is_active": True,
            "components": [{"product_id": product_id, "quantity": 1}],
        },
        headers=admin_headers,
    )
    assert created_pkg.status_code == 201, created_pkg.text
    pkg_id = created_pkg.json()["id"]

    updated_pkg = client.put(
        f"/api/admin/packages/{pkg_id}",
        json={
            "name": "Renamed Duration Bundle",
            "description": "Updated with duration billing",
            "price_cents": 50_000,
            "pricing_basis": "duration",
            "billing_interval_minutes": 60,
            "rounding_rule": "ceil",
            "is_active": True,
            "components": [{"product_id": product_id, "quantity": 1}],
        },
        headers=admin_headers,
    )
    assert updated_pkg.status_code == 200, updated_pkg.text
    assert updated_pkg.json()["name"] == "Renamed Duration Bundle"
    assert updated_pkg.json()["price_cents"] == 50_000
    assert updated_pkg.json()["pricing_basis"] == "duration"
    assert updated_pkg.json()["billing_interval_minutes"] == 60
    assert updated_pkg.json()["rounding_rule"] == "ceil"

    # 2. Duration pricing (ceil) with Philippine (+08:00) timestamps: 2h 30m -> ceil(2.5) = 3 intervals -> 150,000 cents
    pht_start = "2026-12-15T09:00:00+08:00"
    pht_end = "2026-12-15T11:30:00+08:00"
    quote = client.post(
        "/api/orders/quote",
        json={
            "business_id": 1,
            "starts_at": pht_start,
            "ends_at": pht_end,
            "lines": [{"kind": "package", "item_id": pkg_id, "quantity": 1}],
        },
    )
    assert quote.status_code == 200, quote.text
    assert quote.json()["total_cents"] == 150_000

    # 3. Double-booking prevention when combining package + standalone product sharing same stock (stock=2)
    cust1 = create_account(client, email="pht-c1@example.com", password="customer-password-123")
    cust2 = create_account(client, email="pht-c2@example.com", password="customer-password-123")
    c1_headers = auth_header(cust1["access_token"])
    c2_headers = auth_header(cust2["access_token"])

    # Combining 1x package (uses 1 unit) + 2x standalone product (uses 2 units) = 3 units > stock 2 -> 409
    overbook = client.post(
        "/api/orders",
        json={
            "business_id": 1,
            "starts_at": pht_start,
            "ends_at": pht_end,
            "lines": [
                {"kind": "package", "item_id": pkg_id, "quantity": 1},
                {"kind": "product", "item_id": product_id, "quantity": 2},
            ],
        },
        headers=c1_headers,
    )
    assert overbook.status_code == 409

    # Valid order taking all 2 units succeeds and serializes UTC-aware timestamps (+00:00 / Z)
    valid_order = client.post(
        "/api/orders",
        json={
            "business_id": 1,
            "starts_at": pht_start,
            "ends_at": pht_end,
            "lines": [
                {"kind": "package", "item_id": pkg_id, "quantity": 1},
                {"kind": "product", "item_id": product_id, "quantity": 1},
            ],
        },
        headers=c1_headers,
    )
    assert valid_order.status_code == 201, valid_order.text
    order_json = valid_order.json()
    order_id = order_json["id"]
    assert order_json["starts_at"].endswith(("Z", "+00:00"))
    assert order_json["ends_at"].endswith(("Z", "+00:00"))
    assert "01:00:00" in order_json["starts_at"]  # 09:00 +08:00 == 01:00 UTC

    # Overlapping booking by customer 2 for the same window is blocked (409)
    overlap = client.post(
        "/api/orders",
        json={
            "business_id": 1,
            "starts_at": "2026-12-15T10:00:00+08:00",
            "ends_at": "2026-12-15T12:00:00+08:00",
            "lines": [{"kind": "product", "item_id": product_id, "quantity": 1}],
        },
        headers=c2_headers,
    )
    assert overlap.status_code == 409

    # Non-overlapping adjacent booking starting right at previous ends_at (11:30 PHT) succeeds (201)
    adjacent = client.post(
        "/api/orders",
        json={
            "business_id": 1,
            "starts_at": "2026-12-15T11:30:00+08:00",
            "ends_at": "2026-12-15T14:00:00+08:00",
            "lines": [{"kind": "product", "item_id": product_id, "quantity": 1}],
        },
        headers=c2_headers,
    )
    assert adjacent.status_code == 201, adjacent.text

    # 4. Cross-customer & cross-role authorization checks
    assert client.get(f"/api/orders/{order_id}", headers=c2_headers).status_code == 404
    assert client.get(f"/api/orders/{order_id}/receipt", headers=c2_headers).status_code == 404
    assert (
        client.post(
            f"/api/orders/{order_id}/requests",
            json={"kind": "cancellation", "reason": "Unauthorized cancel"},
            headers=c2_headers,
        ).status_code
        == 404
    )
    assert client.get("/api/admin/orders", headers=c1_headers).status_code == 403
    assert client.get("/api/platform/users", headers=c1_headers).status_code == 403
    assert client.get("/api/platform/users", headers=admin_headers).status_code == 403
    assert client.get("/api/platform/orders", headers=admin_headers).status_code == 403
    assert client.patch(f"/api/admin/inventory/{other_asset_id}", json={"condition": "damaged"}, headers=admin_headers).status_code == 404
    assert client.delete(f"/api/admin/products/{other_prod_id}", headers=admin_headers).status_code == 404

    # 5. Duplicate business name update returns 409 instead of 500
    dup_name = client.put(
        "/api/admin/business",
        json={
            "name": "Second Studio Karaoke",
            "description": "Trying duplicate name",
            "brand_primary": "#252729",
            "brand_secondary": "#fffdf8",
            "brand_accent": "#a63d40",
        },
        headers=admin_headers,
    )
    assert dup_name.status_code == 409

    # 6. Suspending business blocks customer from submitting new payments/requests on its orders (409), while read still works (200)
    suspend = client.patch(
        "/api/platform/businesses/1/status",
        json={"status": "suspended", "note": "Audit suspension"},
        headers=platform_headers,
    )
    assert suspend.status_code == 200
    assert client.get(f"/api/orders/{order_id}", headers=c1_headers).status_code == 200
    assert (
        client.post(
            f"/api/orders/{order_id}/payments",
            json={"amount_cents": 10_000, "method": "cash", "paid_at": pht_start},
            headers=c1_headers,
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/orders/{order_id}/requests",
            json={"kind": "cancellation", "reason": "Cancel while suspended"},
            headers=c1_headers,
        ).status_code
        == 409
    )

    # 7. Explicit JSON null & whitespace on optional string fields must never crash with 500
    reg_null_phone = client.post(
        "/api/auth/register",
        json={
            "email": "null-fields@example.com",
            "password": "customer-password-123",
            "display_name": "Null Fields User",
            "phone": None,
        },
    )
    assert reg_null_phone.status_code == 201, reg_null_phone.text
    nf_headers = auth_header(reg_null_phone.json()["access_token"])
    assert (
        client.put(
            "/api/users/me",
            json={"display_name": "Null Fields User", "phone": "   "},
            headers=nf_headers,
        ).json()["phone"]
        is None
    )
    # Reactivate business 1 so we can verify null note / null payment notes & reference
    assert (
        client.patch(
            "/api/platform/businesses/1/status",
            json={"status": "active", "note": None},
            headers=platform_headers,
        ).status_code
        == 200
    )
    pay_nulls = client.post(
        f"/api/orders/{order_id}/payments",
        json={
            "amount_cents": 10_000,
            "method": "cash",
            "paid_at": pht_start,
            "reference_number": None,
            "notes": None,
        },
        headers=c1_headers,
    )
    assert pay_nulls.status_code == 201, pay_nulls.text
    assert (
        client.patch(
            f"/api/admin/orders/{order_id}/status",
            json={"status": "confirmed", "note": None},
            headers=admin_headers,
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/admin/orders/{order_id}/payments/{pay_nulls.json()['id']}/decision",
            json={"approved": True, "note": None},
            headers=admin_headers,
        ).status_code
        == 200
    )


def test_shared_checkout_routes_multi_business_orders_and_enforces_scope(client):
    first_product_id = seed_product(client, pricing_basis="per_rental", stock=1)
    create_admin(client)
    first_admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    second_business_id, second_product_id, _, _, _ = _create_second_business(client)

    generator, db = _open_db(client)
    try:
        first_business_id = db.scalar(select(User.business_id).where(User.email == "admin@example.com"))
        second_owner = User(
            email="second-owner@example.com",
            password_hash=hash_password("secure-admin-password"),
            display_name="Second Owner",
            role=UserRole.BUSINESS_ADMIN,
            business_id=second_business_id,
        )
        db.add(second_owner)
        db.commit()
    finally:
        generator.close()

    second_admin_headers = auth_header(token_for(client, "second-owner@example.com", "secure-admin-password"))
    create_platform_admin(client)
    platform_headers = auth_header(token_for(client, "platform@example.com", "secure-platform-password"))
    staff = client.post(
        "/api/admin/staff",
        json={
            "email": "first-staff@example.com",
            "display_name": "First Staff",
            "password": "secure-staff-password",
        },
        headers=first_admin_headers,
    )
    assert staff.status_code == 201, staff.text
    staff_headers = auth_header(token_for(client, "first-staff@example.com", "secure-staff-password"))

    customer = create_account(client, "shared-checkout@example.com", "secure-customer-password")
    customer_headers = auth_header(customer["access_token"])
    checkout_payload = {
        "submission_key": "shared-checkout-attempt-0001",
        "starts_at": START,
        "ends_at": END,
        "business_orders": [
            {"business_id": first_business_id, "lines": [{"kind": "product", "item_id": first_product_id, "quantity": 1}]},
            {"business_id": second_business_id, "lines": [{"kind": "product", "item_id": second_product_id, "quantity": 1}]},
        ],
        "payment_method": "gcash",
        "event_details": "Birthday party at the community hall",
        "customer_notes": "Please coordinate delivery with the customer.",
    }

    submitted = client.post("/api/orders/checkout", json=checkout_payload, headers=customer_headers)
    assert submitted.status_code == 201, submitted.text
    checkout = submitted.json()
    assert checkout["checkout_reference"].startswith("KR-")
    assert len(checkout["orders"]) == 2
    assert {order["business_id"] for order in checkout["orders"]} == {first_business_id, second_business_id}
    assert {order["checkout_reference"] for order in checkout["orders"]} == {checkout["checkout_reference"]}
    assert {order["status"] for order in checkout["orders"]} == {"pending_admin"}
    assert {order["requested_payment_method"] for order in checkout["orders"]} == {"gcash"}
    assert {order["event_details"] for order in checkout["orders"]} == {"Birthday party at the community hall"}
    assert {order["customer_notes"] for order in checkout["orders"]} == {
        "Please coordinate delivery with the customer."
    }

    retried = client.post("/api/orders/checkout", json=checkout_payload, headers=customer_headers)
    assert retried.status_code == 201, retried.text
    assert [order["id"] for order in retried.json()["orders"]] == [order["id"] for order in checkout["orders"]]
    changed_payload = {**checkout_payload, "customer_notes": "Changed after submit"}
    assert client.post("/api/orders/checkout", json=changed_payload, headers=customer_headers).status_code == 409
    assert len(client.get("/api/orders", headers=customer_headers).json()) == 2

    first_order_id = next(order["id"] for order in checkout["orders"] if order["business_id"] == first_business_id)
    second_order_id = next(order["id"] for order in checkout["orders"] if order["business_id"] == second_business_id)
    first_orders = client.get("/api/admin/orders", headers=first_admin_headers).json()
    second_orders = client.get("/api/admin/orders", headers=second_admin_headers).json()
    staff_orders = client.get("/api/admin/orders", headers=staff_headers).json()
    assert [order["id"] for order in first_orders] == [first_order_id]
    assert [order["id"] for order in staff_orders] == [first_order_id]
    assert [order["id"] for order in second_orders] == [second_order_id]
    assert client.get(f"/api/admin/orders/{first_order_id}", headers=second_admin_headers).status_code == 404
    assert client.get(f"/api/admin/orders/{second_order_id}", headers=staff_headers).status_code == 404

    customer_notifications = client.get("/api/notifications", headers=customer_headers).json()["items"]
    assert any(item["kind"] == "order_submitted" for item in customer_notifications)
    for business_headers in (first_admin_headers, second_admin_headers):
        team_notifications = client.get("/api/notifications", headers=business_headers).json()["items"]
        assert any(item["kind"] == "order_submitted" for item in team_notifications)

    platform_orders = client.get(
        "/api/platform/orders",
        params={
            "reference_search": checkout["checkout_reference"],
            "payment_method": "gcash",
            "payment_status": "unpaid",
            "created_from": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
        },
        headers=platform_headers,
    )
    assert platform_orders.status_code == 200, platform_orders.text
    assert {order["id"] for order in platform_orders.json()} == {first_order_id, second_order_id}
    summary = client.get(
        "/api/platform/orders/summary",
        params={"customer_search": "shared-checkout@example.com"},
        headers=platform_headers,
    )
    assert summary.status_code == 200, summary.text
    assert summary.json()["total"] == 2
    platform_detail = client.get(f"/api/platform/orders/{first_order_id}", headers=platform_headers)
    assert platform_detail.status_code == 200
    assert platform_detail.json()["customer_email"] == "shared-checkout@example.com"
    assert any(entry["action"] == "order_submitted" for entry in platform_detail.json()["audit_log"])

    # Staff can process their assigned business' request and cannot change the other business' order.
    review = client.patch(
        f"/api/admin/orders/{first_order_id}/status",
        json={"status": "under_review", "note": "Please confirm the event address."},
        headers=staff_headers,
    )
    assert review.status_code == 200, review.text
    assert review.json()["status"] == "under_review"
    change_notice = client.get("/api/notifications", headers=customer_headers).json()["items"]
    assert any(item["kind"] == "order_changes_requested" for item in change_notice)
    assert client.patch(
        f"/api/admin/orders/{second_order_id}/status",
        json={"status": "confirmed", "note": "Unauthorized"},
        headers=staff_headers,
    ).status_code == 404
    assert client.patch(
        f"/api/admin/orders/{first_order_id}/status",
        json={"status": "confirmed", "note": "Request accepted"},
        headers=staff_headers,
    ).status_code == 200
    assert client.patch(
        f"/api/admin/orders/{first_order_id}/status",
        json={"status": "ongoing"},
        headers=staff_headers,
    ).status_code == 200
    completed = client.patch(
        f"/api/admin/orders/{first_order_id}/status",
        json={"status": "completed"},
        headers=staff_headers,
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    assert len(completed.json()["history"]) >= 5


def test_multi_business_checkout_rolls_back_if_any_business_is_unavailable(client):
    product_id = seed_product(client, pricing_basis="per_rental", stock=1)
    create_admin(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    customer = create_account(client, "rollback-checkout@example.com", "secure-customer-password")

    failed = client.post(
        "/api/orders/checkout",
        json={
            "submission_key": "rollback-checkout-attempt-01",
            "starts_at": START,
            "ends_at": END,
            "business_orders": [
                {"business_id": 1, "lines": [{"kind": "product", "item_id": product_id, "quantity": 1}]},
                {"business_id": 99999, "lines": [{"kind": "product", "item_id": product_id, "quantity": 1}]},
            ],
            "payment_method": "cash",
        },
        headers=auth_header(customer["access_token"]),
    )
    assert failed.status_code == 404
    assert client.get("/api/orders", headers=auth_header(customer["access_token"])).json() == []
    assert client.get("/api/admin/orders", headers=admin_headers).json() == []

