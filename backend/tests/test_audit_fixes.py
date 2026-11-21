from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, normalize_database_url
from app.core.database import get_db
from app.core.security import ALGORITHM
from app.models import (
    Business,
    BusinessAuditLog,
    BusinessCategory,
    InventoryAsset,
    Product,
    ProductCategory,
    QualityTier,
    RentalStatus,
    UserRole,
)
from tests.test_rental_workflows import (
    END,
    START,
    auth_header,
    client_token_for_user,
    create_account,
    create_admin,
    create_platform_admin,
    create_tenant_admin,
    order_payload,
    seed_product,
    token_for,
)


def _open_db(client):
    override = client.app.dependency_overrides[get_db]
    generator = override()
    return generator, next(generator)


def _create_second_business(client):
    generator, db = _open_db(client)
    try:
        other = Business(
            name="Second Studio Karaoke",
            slug="second-studio-karaoke",
            status="active",
            description="Tenant B",
        )
        db.add(other)
        db.flush()
        tier = QualityTier(business_id=other.id, name="Standard")
        cat = BusinessCategory(business_id=other.id, name="karaoke")
        db.add_all([tier, cat])
        db.flush()
        product = Product(
            business_id=other.id,
            name="Studio Unit B",
            category="karaoke",
            quality_tier_id=tier.id,
            price_cents=80_000,
            pricing_basis="per_rental",
            is_active=True,
        )
        db.add(product)
        db.flush()
        asset = InventoryAsset(business_id=other.id, product_id=product.id, asset_tag="B-001")
        db.add(asset)
        db.commit()
        return other.id, product.id, asset.id, tier.id, cat.id
    finally:
        generator.close()


def test_cors_origins_parses_both_comma_and_json_and_rejects_wildcard():
    secret = "a" * 40
    comma_settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/db",
        secret_key=secret,
        cors_origins="http://localhost:4200, http://localhost:8100/",
    )
    assert comma_settings.cors_origins == ["http://localhost:4200", "http://localhost:8100"]
    assert comma_settings.database_url == "postgresql+psycopg://user:pass@localhost:5432/db"
    assert normalize_database_url("postgres://u:p@h/d") == "postgresql+psycopg://u:p@h/d"

    json_settings = Settings(
        database_url="sqlite://",
        secret_key=secret,
        cors_origins='["https://karaoke-marketplace.onrender.com", "https://localhost"]',
    )
    assert json_settings.cors_origins == ["https://karaoke-marketplace.onrender.com", "https://localhost"]

    try:
        Settings(database_url="sqlite://", secret_key=secret, cors_origins="*")
        assert False, "Wildcard CORS origin must be rejected"
    except ValueError:
        pass


def test_unlisted_business_package_image_is_blocked_publicly_and_etag_works(client):
    product_id = seed_product(client, pricing_basis="per_rental", stock=1)
    create_admin(client)
    create_platform_admin(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    platform_headers = auth_header(token_for(client, "platform@example.com", "secure-platform-password"))

    pkg = client.post(
        "/api/admin/packages",
        json={"name": "Party Bundle", "components": [{"product_id": product_id, "quantity": 1}]},
        headers=admin_headers,
    )
    assert pkg.status_code == 201, pkg.text
    pkg_id = pkg.json()["id"]
    img_bytes = b"\x89PNG\r\n\x1a\nhello-image"
    upload = client.put(
        f"/api/admin/packages/{pkg_id}/image",
        content=img_bytes,
        headers={**admin_headers, "Content-Type": "image/png"},
    )
    assert upload.status_code == 200

    first_get = client.get(f"/api/catalog/packages/{pkg_id}/image")
    assert first_get.status_code == 200
    assert "etag" in first_get.headers
    assert first_get.headers["cache-control"] == "public, no-cache"

    not_modified = client.get(
        f"/api/catalog/packages/{pkg_id}/image",
        headers={"If-None-Match": first_get.headers["etag"]},
    )
    assert not_modified.status_code == 304

    # Unlist business -> public package image must return 404, admin endpoint must still work
    hide = client.patch("/api/platform/businesses/1/listing", json={"is_active": False}, headers=platform_headers)
    assert hide.status_code == 200
    assert client.get(f"/api/catalog/packages/{pkg_id}/image").status_code == 404
    admin_get = client.get(f"/api/admin/packages/{pkg_id}/image", headers=admin_headers)
    assert admin_get.status_code == 200
    assert admin_get.content == img_bytes


def test_package_update_replaces_components_without_unique_constraint_conflict(client):
    product_id = seed_product(client, pricing_basis="per_rental", stock=3)
    create_admin(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))

    created = client.post(
        "/api/admin/packages",
        json={
            "name": "Starter Pack",
            "price_cents": 45_000,
            "pricing_basis": "per_rental",
            "components": [{"product_id": product_id, "quantity": 1}],
        },
        headers=admin_headers,
    )
    assert created.status_code == 201, created.text
    package_id = created.json()["id"]

    # Editing same package keeping the same product previously crashed with 409 uq_package_product
    updated = client.put(
        f"/api/admin/packages/{package_id}",
        json={
            "name": "Starter Pack Updated",
            "price_cents": 85_000,
            "pricing_basis": "per_rental",
            "components": [{"product_id": product_id, "quantity": 2}],
        },
        headers=admin_headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Starter Pack Updated"
    assert updated.json()["components"][0]["quantity"] == 2

    # Duplicate product_id in same package must return 422
    dup = client.put(
        f"/api/admin/packages/{package_id}",
        json={
            "name": "Bad Pack",
            "components": [
                {"product_id": product_id, "quantity": 1},
                {"product_id": product_id, "quantity": 1},
            ],
        },
        headers=admin_headers,
    )
    assert dup.status_code == 422


def test_business_staff_rbac_restricts_owner_only_endpoints(client):
    product_id = seed_product(client, pricing_basis="per_rental", stock=1)
    create_admin(client)
    create_tenant_admin(client, "staff@example.com", 1, role=UserRole.BUSINESS_STAFF)
    staff_headers = auth_header(token_for(client, "staff@example.com", "secure-business-password"))
    owner_headers = auth_header(client_token_for_user(client, "admin@example.com"))

    cats = client.get("/api/admin/categories", headers=owner_headers).json()
    cat_id = cats[0]["id"]

    # Staff MUST be blocked from owner-only endpoints
    assert client.get("/api/admin/staff", headers=staff_headers).status_code == 403
    assert client.put(
        f"/api/admin/categories/{cat_id}",
        json={"name": "Renamed By Staff", "is_active": True},
        headers=staff_headers,
    ).status_code == 403
    assert client.delete(f"/api/admin/products/{product_id}", headers=staff_headers).status_code == 403
    assert client.get("/api/admin/audit-logs", headers=staff_headers).status_code == 403

    # Staff CAN access operational endpoints
    assert client.get("/api/admin/orders", headers=staff_headers).status_code == 200
    assert client.get("/api/admin/inventory", headers=staff_headers).status_code == 200
    assert client.get("/api/admin/reports/summary", headers=staff_headers).status_code == 200


def test_category_rename_cascades_to_products_and_is_tenant_isolated(client):
    product_id = seed_product(client, pricing_basis="per_rental", stock=1)
    create_admin(client)
    other_biz_id, other_product_id, _, _, _ = _create_second_business(client)
    create_tenant_admin(client, "other@example.com", other_biz_id)

    owner_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    other_headers = auth_header(token_for(client, "other@example.com", "secure-business-password"))

    karaoke_cat = next(
        cat for cat in client.get("/api/admin/categories", headers=owner_headers).json() if cat["name"] == "karaoke"
    )
    renamed = client.put(
        f"/api/admin/categories/{karaoke_cat['id']}",
        json={"name": "Karaoke Systems", "is_active": True},
        headers=owner_headers,
    )
    assert renamed.status_code == 200, renamed.text

    # Business 1 product updated and filterable by new name (case-insensitively)
    b1_products = client.get("/api/catalog/products?business_id=1&category=karaoke%20systems").json()
    assert [p["id"] for p in b1_products] == [product_id]
    assert b1_products[0]["category"] == "Karaoke Systems"

    # Business 2 product remains untouched ("karaoke")
    b2_products = client.get("/api/admin/products", headers=other_headers).json()
    assert b2_products[0]["id"] == other_product_id
    assert b2_products[0]["category"] == "karaoke"


def test_product_delete_succeeds_when_unused_and_blocks_when_referenced(client):
    used_product_id = seed_product(client, pricing_basis="per_rental", stock=1)
    create_admin(client)
    other_biz_id, other_product_id, _, _, _ = _create_second_business(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    customer = create_account(client, "buyer-del@example.com")
    customer_headers = auth_header(customer["access_token"])

    # Create an order referencing used_product_id
    order = client.post("/api/orders", json=order_payload(used_product_id), headers=customer_headers)
    assert order.status_code == 201

    # Cannot delete product referenced by an order
    blocked = client.delete(f"/api/admin/products/{used_product_id}", headers=admin_headers)
    assert blocked.status_code == 409

    # Cannot delete another business's product
    cross = client.delete(f"/api/admin/products/{other_product_id}", headers=admin_headers)
    assert cross.status_code == 404

    # Create an unused product and delete it cleanly
    tier_id = client.get("/api/admin/quality-tiers", headers=admin_headers).json()[0]["id"]
    unused = client.post(
        "/api/admin/products",
        json={
            "name": "Temp Mic",
            "category": "karaoke",
            "quality_tier_id": tier_id,
            "price_cents": 10_000,
            "pricing_basis": "per_rental",
            "initial_stock": 2,
        },
        headers=admin_headers,
    )
    assert unused.status_code == 201
    unused_id = unused.json()["id"]

    deleted = client.delete(f"/api/admin/products/{unused_id}", headers=admin_headers)
    assert deleted.status_code == 200
    assert deleted.json() == {"id": unused_id, "deleted": True}
    assert all(p["id"] != unused_id for p in client.get("/api/admin/products", headers=admin_headers).json())


def test_order_modification_validation_approval_and_rejection_cleanup(client):
    product_id = seed_product(client, pricing_basis="per_rental", price_cents=50_000, stock=2)
    create_admin(client)
    _, other_product_id, _, _, _ = _create_second_business(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    customer = create_account(client, "mod-customer@example.com")
    customer_headers = auth_header(customer["access_token"])

    created = client.post("/api/orders", json=order_payload(product_id), headers=customer_headers)
    assert created.status_code == 201
    order_id = created.json()["id"]
    assert len(created.json()["lines"]) == 1

    # Cross-tenant modification request must be rejected immediately at request creation
    bad_mod = client.post(
        f"/api/orders/{order_id}/requests",
        json={
            "kind": "modification",
            "reason": "Swap to another business product",
            "starts_at": START,
            "ends_at": END,
            "lines": [{"kind": "product", "item_id": other_product_id, "quantity": 1}],
        },
        headers=customer_headers,
    )
    assert bad_mod.status_code == 404

    # Valid modification increasing quantity to 2
    good_mod = client.post(
        f"/api/orders/{order_id}/requests",
        json={
            "kind": "modification",
            "reason": "Need 2 units",
            "starts_at": START,
            "ends_at": END,
            "lines": [{"kind": "product", "item_id": product_id, "quantity": 2}],
        },
        headers=customer_headers,
    )
    assert good_mod.status_code == 201, good_mod.text
    req_id = good_mod.json()["id"]

    queue = client.get("/api/admin/requests", headers=admin_headers).json()
    assert len(queue) == 1
    assert queue[0]["customer_name"] == "Rental Customer"

    approved = client.post(
        f"/api/admin/orders/{order_id}/requests/{req_id}/decision",
        json={"approved": True, "note": "Updated quantity"},
        headers=admin_headers,
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["total_cents"] == 100_000
    assert approved.json()["lines"][0]["quantity"] == 2
    assert any(event["action"] == "modification_approved" for event in approved.json()["history"])

    # Submit a cancellation request, then reject the order directly -> pending request must auto-close
    cancel_req = client.post(
        f"/api/orders/{order_id}/requests",
        json={"kind": "cancellation", "reason": "Never mind"},
        headers=customer_headers,
    )
    assert cancel_req.status_code == 201
    rejected = client.patch(
        f"/api/admin/orders/{order_id}/status",
        json={"status": "rejected", "note": "Schedule conflict"},
        headers=admin_headers,
    )
    assert rejected.status_code == 200
    assert client.get("/api/admin/requests", headers=admin_headers).json() == []


def test_manual_payment_refund_after_cancellation_and_audit_entity_id(client):
    product_id = seed_product(client, pricing_basis="per_rental", price_cents=50_000, stock=1)
    create_admin(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    customer = create_account(client, "refund-customer@example.com")
    customer_headers = auth_header(customer["access_token"])

    order = client.post("/api/orders", json=order_payload(product_id), headers=customer_headers).json()
    order_id = order["id"]

    # Record manual payment
    pay = client.post(
        f"/api/admin/orders/{order_id}/payments",
        json={
            "kind": "payment",
            "amount_cents": 30_000,
            "method": "cash",
            "paid_at": datetime.now(timezone.utc).isoformat(),
            "reference_number": "CASH-1",
        },
        headers=admin_headers,
    )
    assert pay.status_code == 201, pay.text
    payment_id = pay.json()["id"]
    assert pay.json()["submitted_at"] is not None

    # Audit log must have populated entity_id (previously None!)
    audit_logs = client.get("/api/admin/audit-logs", headers=admin_headers).json()
    manual_log = next(entry for entry in audit_logs if entry["action"] == "manual_payment_recorded")
    assert manual_log["entity_id"] == payment_id

    # Order history must include manual payment event
    refreshed = client.get(f"/api/orders/{order_id}", headers=customer_headers).json()
    assert any(event["action"] == "manual_payment_recorded" for event in refreshed["history"])

    # Reject order -> admin must still be allowed to record a refund up to paid_cents
    assert client.patch(
        f"/api/admin/orders/{order_id}/status",
        json={"status": "rejected"},
        headers=admin_headers,
    ).status_code == 200

    over_refund = client.post(
        f"/api/admin/orders/{order_id}/payments",
        json={
            "kind": "refund",
            "amount_cents": 35_000,
            "method": "cash",
            "paid_at": datetime.now(timezone.utc).isoformat(),
        },
        headers=admin_headers,
    )
    assert over_refund.status_code == 409

    refund = client.post(
        f"/api/admin/orders/{order_id}/payments",
        json={
            "kind": "refund",
            "amount_cents": 30_000,
            "method": "cash",
            "paid_at": datetime.now(timezone.utc).isoformat(),
        },
        headers=admin_headers,
    )
    assert refund.status_code == 201, refund.text
    after_refund = client.get(f"/api/orders/{order_id}", headers=customer_headers).json()
    assert after_refund["payment_status"] == "refunded"
    assert after_refund["paid_cents"] == 0


def test_suspended_business_cannot_view_payment_proof_and_reports_filter_by_date(client):
    product_id = seed_product(client, pricing_basis="per_rental", price_cents=50_000, stock=1)
    create_admin(client)
    create_platform_admin(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    platform_headers = auth_header(token_for(client, "platform@example.com", "secure-platform-password"))
    customer = create_account(client, "proof-susp@example.com")
    customer_headers = auth_header(customer["access_token"])

    order_id = client.post("/api/orders", json=order_payload(product_id), headers=customer_headers).json()["id"]
    payment_id = client.post(
        f"/api/orders/{order_id}/payments",
        json={
            "amount_cents": 25_000,
            "method": "gcash",
            "paid_at": datetime.now(timezone.utc).isoformat(),
        },
        headers=customer_headers,
    ).json()["id"]
    assert client.put(
        f"/api/orders/{order_id}/payments/{payment_id}/proof",
        content=b"\x89PNG\r\n\x1a\nproof",
        headers={**customer_headers, "Content-Type": "image/png"},
    ).status_code == 200
    assert client.post(
        f"/api/admin/orders/{order_id}/payments/{payment_id}/decision",
        json={"approved": True},
        headers=admin_headers,
    ).status_code == 200

    # Date-filtered report summary
    past_start = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    past_end = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    empty_report = client.get(
        "/api/admin/reports/summary",
        params={"starts_at": past_start, "ends_at": past_end},
        headers=admin_headers,
    )
    assert empty_report.status_code == 200
    assert empty_report.json()["orders"] == 0
    assert empty_report.json()["verified_collections_cents"] == 0

    current_report = client.get("/api/admin/reports/summary", headers=admin_headers).json()
    assert current_report["orders"] == 1
    assert current_report["verified_collections_cents"] == 25_000
    assert current_report["orders_by_status"]["pending_admin"] == 1

    # Confirm order and verify admin/inventory works without offset-naive/aware datetime crash
    assert client.patch(
        f"/api/admin/orders/{order_id}/status",
        json={"status": "confirmed"},
        headers=admin_headers,
    ).status_code == 200
    inv = client.get("/api/admin/inventory", headers=admin_headers)
    assert inv.status_code == 200
    assert inv.json()[0]["rental_status"] == "reserved"

    # Suspend business -> payment proof must return 403 for suspended business admin
    assert client.patch(
        "/api/platform/businesses/1/status",
        json={"status": "suspended"},
        headers=platform_headers,
    ).status_code == 200
    assert client.get(
        f"/api/orders/{order_id}/payments/{payment_id}/proof",
        headers=admin_headers,
    ).status_code == 403


def test_expired_jwt_and_whitespace_inputs_and_inactive_package_components(client):
    product_id = seed_product(client, pricing_basis="per_rental", stock=1)
    create_admin(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))

    # Expired token must return 401
    expired_token = jwt.encode(
        {"sub": "1", "exp": datetime.now(timezone.utc) - timedelta(minutes=5)},
        "test-secret-key-only-not-for-use-in-deployment-32-characters",
        algorithm=ALGORITHM,
    )
    assert client.get("/api/users/me", headers=auth_header(expired_token)).status_code == 401

    # Whitespace-only registration & business registration must return 422
    assert client.post(
        "/api/auth/register",
        json={"email": "blank@example.com", "password": "valid-password-123", "display_name": "   "},
    ).status_code == 422
    assert client.post(
        "/api/auth/business-register",
        json={
            "business_name": "   ",
            "owner_name": "Owner",
            "email": "blankbiz@example.com",
            "contact_number": "09171234567",
            "address": "123 Street",
            "password": "valid-password-123",
        },
    ).status_code == 422

    # Package with deactivated component must be excluded from public catalog
    pkg = client.post(
        "/api/admin/packages",
        json={
            "name": "Active Bundle",
            "price_cents": 50_000,
            "pricing_basis": "per_rental",
            "components": [{"product_id": product_id, "quantity": 1}],
        },
        headers=admin_headers,
    )
    assert pkg.status_code == 201
    assert len(client.get("/api/catalog/packages").json()) == 1

    prod = client.get("/api/admin/products", headers=admin_headers).json()[0]
    deactivated = client.put(
        f"/api/admin/products/{product_id}",
        json={
            "name": prod["name"],
            "description": prod["description"],
            "category": prod["category"],
            "quality_tier_id": prod["quality_tier_id"],
            "price_cents": prod["price_cents"],
            "pricing_basis": "per_rental",
            "is_active": False,
        },
        headers=admin_headers,
    )
    assert deactivated.status_code == 200
    assert client.get("/api/catalog/packages").json() == []


def test_cross_tenant_isolation_for_orders_inventory_customers_and_audit_logs(client):
    product_a = seed_product(client, pricing_basis="per_rental", stock=1)
    create_admin(client)
    biz_b_id, product_b, asset_b_id, tier_b_id, cat_b_id = _create_second_business(client)
    create_tenant_admin(client, "admin-b@example.com", biz_b_id)

    headers_a = auth_header(client_token_for_user(client, "admin@example.com"))
    headers_b = auth_header(token_for(client, "admin-b@example.com", "secure-business-password"))

    customer = create_account(client, "iso-customer@example.com")
    customer_headers = auth_header(customer["access_token"])

    # Customer places order with Business B
    order_b = client.post(
        "/api/orders",
        json={
            "business_id": biz_b_id,
            "starts_at": START,
            "ends_at": END,
            "lines": [{"kind": "product", "item_id": product_b, "quantity": 1}],
        },
        headers=customer_headers,
    )
    assert order_b.status_code == 201, order_b.text
    order_b_id = order_b.json()["id"]

    # Business A admin cannot see or mutate Business B's order, inventory, category, tier, customer, or audit logs
    assert client.get("/api/admin/orders", headers=headers_a).json() == []
    assert client.patch(
        f"/api/admin/orders/{order_b_id}/status",
        json={"status": "confirmed"},
        headers=headers_a,
    ).status_code == 404
    assert client.patch(
        f"/api/admin/inventory/{asset_b_id}",
        json={"condition": "damaged"},
        headers=headers_a,
    ).status_code == 404
    assert client.put(
        f"/api/admin/quality-tiers/{tier_b_id}",
        json={"name": "Hijacked", "is_active": True},
        headers=headers_a,
    ).status_code == 404
    assert client.put(
        f"/api/admin/categories/{cat_b_id}",
        json={"name": "Hijacked", "is_active": True},
        headers=headers_a,
    ).status_code == 404
    assert client.patch(
        f"/api/admin/customers/{customer['user']['id']}/active",
        json={"is_active": False},
        headers=headers_a,
    ).status_code == 404
    assert all(
        entry["business_id"] == 1
        for entry in client.get("/api/admin/audit-logs", headers=headers_a).json()
    )
    assert len(client.get("/api/admin/orders", headers=headers_b).json()) == 1
