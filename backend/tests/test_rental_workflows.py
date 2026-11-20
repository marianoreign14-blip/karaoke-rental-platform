from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import hash_password
from app.models import (
    AssetCondition,
    Business,
    BusinessCategory,
    InventoryAsset,
    Product,
    ProductCategory,
    QualityTier,
    RentalStatus,
    User,
    UserRole,
)

START = "2026-12-10T09:00:00+08:00"
END = "2026-12-10T17:00:00+08:00"
START_OVERLAP = "2026-12-10T12:00:00+08:00"
END_OVERLAP = "2026-12-10T19:00:00+08:00"


def seed_product(client, *, pricing_basis=None, price_cents=50_000, stock=1):
    override = client.app.dependency_overrides[get_db]
    generator = override()
    db: Session = next(generator)
    try:
        business = ensure_business(db)
        tier = db.scalar(
            select(QualityTier).where(
                QualityTier.business_id == business.id,
                QualityTier.name == "Basic",
            )
        )
        if tier is None:
            tier = QualityTier(business_id=business.id, name="Basic")
            db.add(tier)
        db.flush()
        product = Product(
            business_id=business.id,
            name="Basic Karaoke",
            category=ProductCategory.KARAOKE.value,
            quality_tier_id=tier.id,
            price_cents=price_cents,
            pricing_basis=pricing_basis,
            billing_interval_minutes=60 if pricing_basis == "duration" else None,
            rounding_rule="ceil" if pricing_basis == "duration" else None,
            is_active=True,
        )
        db.add(product)
        db.flush()
        for index in range(stock):
            db.add(
                InventoryAsset(
                    business_id=business.id,
                    product_id=product.id,
                    asset_tag=f"K-{index + 1}",
                    condition=AssetCondition.AVAILABLE,
                )
            )
        db.commit()
        return product.id
    finally:
        generator.close()


def create_account(client, email, password="secure-customer-password"):
    response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "display_name": "Rental Customer",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_admin(client):
    override = client.app.dependency_overrides[get_db]
    generator = override()
    db: Session = next(generator)
    try:
        business = ensure_business(db)
        admin = User(
            email="admin@example.com",
            password_hash=hash_password("secure-admin-password"),
            display_name="Rental Admin",
            role=UserRole.BUSINESS_ADMIN,
            business_id=business.id,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        return admin.id
    finally:
        generator.close()


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def order_payload(product_id, starts_at=START, ends_at=END):
    return {
        "business_id": 1,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "lines": [{"kind": "product", "item_id": product_id, "quantity": 1}],
    }


def ensure_business(db: Session) -> Business:
    business = db.scalar(select(Business).where(Business.slug == "test-rental-business"))
    if business is None:
        business = Business(
            name="Test Rental Business",
            slug="test-rental-business",
            status="active",
            description="Test tenant",
        )
        db.add(business)
        db.flush()
    existing_tiers = set(
        db.scalars(select(QualityTier.name).where(QualityTier.business_id == business.id))
    )
    for name in ("Basic", "Standard", "Premium"):
        if name not in existing_tiers:
            db.add(QualityTier(business_id=business.id, name=name))
    existing_categories = {
        name.lower()
        for name in db.scalars(select(BusinessCategory.name).where(BusinessCategory.business_id == business.id))
    }
    for name in ("karaoke", "table", "chair"):
        if name.lower() not in existing_categories:
            db.add(BusinessCategory(business_id=business.id, name=name))
    db.flush()
    return business


def test_catalog_prices_are_visible_but_checkout_requires_configured_basis(client):
    product_id = seed_product(client, pricing_basis=None)
    response = client.get("/api/catalog/products")

    assert response.status_code == 200
    assert response.json()[0]["price_cents"] == 50_000
    assert response.json()[0]["pricing_configured"] is False
    quote = client.post("/api/orders/quote", json=order_payload(product_id))
    assert quote.status_code == 409
    assert "pricing must be configured" in quote.json()["detail"].lower()


def test_order_holds_inventory_and_admin_approval_releases_it_on_cancellation(client):
    product_id = seed_product(client, pricing_basis="per_rental", stock=1)
    customer = create_account(client, "customer@example.com")
    admin_id = create_admin(client)
    customer_headers = auth_header(customer["access_token"])

    first = client.post("/api/orders", json=order_payload(product_id), headers=customer_headers)
    assert first.status_code == 201, first.text
    order_id = first.json()["id"]
    assert first.json()["status"] == RentalStatus.PENDING_ADMIN.value

    overlapping = client.post(
        "/api/orders",
        json=order_payload(product_id, START_OVERLAP, END_OVERLAP),
        headers=customer_headers,
    )
    assert overlapping.status_code == 409

    cancellation = client.post(
        f"/api/orders/{order_id}/requests",
        json={"kind": "cancellation", "reason": "Event has been postponed"},
        headers=customer_headers,
    )
    assert cancellation.status_code == 201
    still_held = client.post(
        "/api/orders",
        json=order_payload(product_id, START_OVERLAP, END_OVERLAP),
        headers=customer_headers,
    )
    assert still_held.status_code == 409

    decision = client.post(
        f"/api/admin/orders/{order_id}/requests/{cancellation.json()['id']}/decision",
        json={"approved": True, "note": "Approved"},
        headers=auth_header(client_token_for_user(client, "admin@example.com")),
    )
    assert decision.status_code == 200, decision.text
    assert decision.json()["status"] == RentalStatus.CANCELLED.value
    assert decision.json()["history"][-1]["actor_id"] == admin_id

    after_release = client.post(
        "/api/orders",
        json=order_payload(product_id, START_OVERLAP, END_OVERLAP),
        headers=customer_headers,
    )
    assert after_release.status_code == 201, after_release.text


def client_token_for_user(client, email):
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": "secure-admin-password"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_customer_payment_stays_unpaid_until_admin_verifies(client):
    product_id = seed_product(client, pricing_basis="per_rental", price_cents=50_000)
    customer = create_account(client, "payer@example.com")
    create_admin(client)
    customer_headers = auth_header(customer["access_token"])
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    order = client.post("/api/orders", json=order_payload(product_id), headers=customer_headers)
    order_id = order.json()["id"]

    payment = client.post(
        f"/api/orders/{order_id}/payments",
        headers=customer_headers,
        json={
            "amount_cents": 20_000,
            "method": "gcash",
            "paid_at": datetime.now(timezone.utc).isoformat(),
            "reference_number": "REF-123",
        },
    )
    assert payment.status_code == 201
    payment_id = payment.json()["id"]
    proof_image = b"\x89PNG\r\n\x1a\n"
    invalid_proof = client.put(
        f"/api/orders/{order_id}/payments/{payment_id}/proof",
        headers={**customer_headers, "Content-Type": "image/png"},
        content=b"not an image",
    )
    assert invalid_proof.status_code == 415
    proof_upload = client.put(
        f"/api/orders/{order_id}/payments/{payment_id}/proof",
        headers={**customer_headers, "Content-Type": "image/png"},
        content=proof_image,
    )
    assert proof_upload.status_code == 200, proof_upload.text
    assert proof_upload.json()["proof_available"] is True
    customer_proof = client.get(
        f"/api/orders/{order_id}/payments/{payment_id}/proof",
        headers=customer_headers,
    )
    assert customer_proof.status_code == 200
    assert customer_proof.content == proof_image
    admin_proof = client.get(
        f"/api/orders/{order_id}/payments/{payment_id}/proof",
        headers=admin_headers,
    )
    assert admin_proof.status_code == 200
    assert admin_proof.content == proof_image
    override = client.app.dependency_overrides[get_db]
    generator = override()
    db: Session = next(generator)
    try:
        db.add(
            User(
                email="other-payer@example.com",
                password_hash=hash_password("other-customer-password"),
                display_name="Other Customer",
                role=UserRole.CUSTOMER,
            )
        )
        db.commit()
    finally:
        generator.close()
    unauthorized_proof = client.get(
        f"/api/orders/{order_id}/payments/{payment_id}/proof",
        headers=auth_header(token_for(client, "other-payer@example.com", "other-customer-password")),
    )
    assert unauthorized_proof.status_code == 404
    before_review = client.get(f"/api/orders/{order_id}", headers=customer_headers).json()
    assert before_review["paid_cents"] == 0
    assert before_review["payment_status"] == "unpaid"
    assert before_review["payments"][0]["proof_available"] is True

    decision = client.post(
        f"/api/admin/orders/{order_id}/payments/{payment_id}/decision",
        headers=admin_headers,
        json={"approved": True, "note": "Reference checked"},
    )
    assert decision.status_code == 200, decision.text
    after_review = client.get(f"/api/orders/{order_id}", headers=customer_headers).json()
    assert after_review["paid_cents"] == 20_000
    assert after_review["balance_cents"] == 30_000
    assert after_review["payment_status"] == "partially_paid"


def test_admin_routes_are_role_protected_and_password_hash_is_not_returned(client):
    account = create_account(client, "role-check@example.com")
    create_admin(client)
    response = client.get("/api/admin/orders", headers=auth_header(account["access_token"]))

    assert response.status_code == 403
    assert "password_hash" not in str(client.get("/api/users/me", headers=auth_header(account["access_token"])).json())


def test_admin_can_upload_and_serve_package_image(client):
    product_id = seed_product(client)
    customer = create_account(client, "image-customer@example.com")
    create_admin(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    package_response = client.post(
        "/api/admin/packages",
        json={"name": "Event set", "components": [{"product_id": product_id, "quantity": 1}]},
        headers=admin_headers,
    )
    assert package_response.status_code == 201, package_response.text
    package_id = package_response.json()["id"]
    image = b"\x89PNG\r\n\x1a\npackage-image"

    denied = client.put(
        f"/api/admin/packages/{package_id}/image",
        content=image,
        headers={**auth_header(customer["access_token"]), "Content-Type": "image/png"},
    )
    assert denied.status_code == 403

    invalid = client.put(
        f"/api/admin/packages/{package_id}/image",
        content=b"not an image",
        headers={**admin_headers, "Content-Type": "image/png"},
    )
    assert invalid.status_code == 415

    uploaded = client.put(
        f"/api/admin/packages/{package_id}/image",
        content=image,
        headers={**admin_headers, "Content-Type": "image/png"},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["image_url"].endswith(f"/api/catalog/packages/{package_id}/image")

    catalog_package = client.get("/api/catalog/packages").json()[0]
    assert catalog_package["image_url"] == uploaded.json()["image_url"]
    image_response = client.get(f"/api/catalog/packages/{package_id}/image")
    assert image_response.status_code == 200
    assert image_response.content == image
    assert image_response.headers["content-type"] == "image/png"
    assert image_response.headers["x-content-type-options"] == "nosniff"


def test_admin_quick_add_creates_initial_stock_and_rejects_duplicate_products(client):
    create_admin(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    standard_tier = next(tier for tier in client.get("/api/admin/quality-tiers", headers=admin_headers).json() if tier["name"] == "Standard")
    payload = {
        "name": "Portable Karaoke Set",
        "category": "karaoke",
        "quality_tier_id": standard_tier["id"],
        "price_cents": 75_000,
        "pricing_basis": "per_rental",
        "initial_stock": 2,
    }

    created = client.post("/api/admin/products", json=payload, headers=admin_headers)
    assert created.status_code == 201, created.text
    product = created.json()
    assert product["stock_count"] == 2
    assert product["pricing_basis"] == "per_rental"
    assert product["pricing_configured"] is True
    inventory = client.get("/api/admin/inventory", headers=admin_headers).json()
    assert [item["asset_tag"] for item in inventory] == ["PRD-000001-0001", "PRD-000001-0002"]

    duplicate = client.post(
        "/api/admin/products",
        json={**payload, "name": " portable karaoke set "},
        headers=admin_headers,
    )
    assert duplicate.status_code == 409


def test_inline_stock_update_preserves_assets_with_active_reservations(client):
    product_id = seed_product(client, pricing_basis="per_rental", stock=2)
    create_admin(client)
    customer = create_account(client, "stock-customer@example.com")
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    customer_headers = auth_header(customer["access_token"])
    order = client.post("/api/orders", json=order_payload(product_id), headers=customer_headers)
    assert order.status_code == 201, order.text

    too_low = client.patch(
        f"/api/admin/products/{product_id}/stock",
        json={"quantity": 0},
        headers=admin_headers,
    )
    assert too_low.status_code == 409

    reduced = client.patch(
        f"/api/admin/products/{product_id}/stock",
        json={"quantity": 1},
        headers=admin_headers,
    )
    assert reduced.status_code == 200, reduced.text
    assert reduced.json()["stock_count"] == 1
    updated_price = client.patch(
        f"/api/admin/products/{product_id}/price",
        json={"price_cents": 60_000},
        headers=admin_headers,
    )
    assert updated_price.status_code == 200, updated_price.text
    assert updated_price.json()["price_cents"] == 60_000


def test_admin_can_upload_and_serve_product_image(client):
    product_id = seed_product(client)
    create_admin(client)
    admin_headers = auth_header(client_token_for_user(client, "admin@example.com"))
    image = b"\x89PNG\r\n\x1a\nproduct-image"

    uploaded = client.put(
        f"/api/admin/products/{product_id}/image",
        content=image,
        headers={**admin_headers, "Content-Type": "image/png"},
    )
    assert uploaded.status_code == 200, uploaded.text
    product = client.get("/api/catalog/products").json()[0]
    assert product["image_url"] == uploaded.json()["image_url"]

    image_response = client.get(f"/api/catalog/products/{product_id}/image")
    assert image_response.status_code == 200
    assert image_response.content == image
    assert image_response.headers["content-type"] == "image/png"


def create_tenant_admin(client, email, business_id, role=UserRole.BUSINESS_ADMIN):
    override = client.app.dependency_overrides[get_db]
    generator = override()
    db: Session = next(generator)
    try:
        user = User(
            email=email,
            password_hash=hash_password("secure-business-password"),
            display_name="Business Manager",
            role=role,
            business_id=business_id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user.id
    finally:
        generator.close()


def create_platform_admin(client):
    override = client.app.dependency_overrides[get_db]
    generator = override()
    db: Session = next(generator)
    try:
        user = User(
            email="platform@example.com",
            password_hash=hash_password("secure-platform-password"),
            display_name="Platform Admin",
            role=UserRole.PLATFORM_ADMIN,
        )
        db.add(user)
        db.commit()
        return user.id
    finally:
        generator.close()


def token_for(client, email, password):
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_business_administrators_cannot_access_another_business_data(client):
    first_product_id = seed_product(client, pricing_basis="per_rental")
    create_admin(client)
    override = client.app.dependency_overrides[get_db]
    generator = override()
    db: Session = next(generator)
    try:
        other = Business(
            name="Other Karaoke",
            slug="other-karaoke",
            status="active",
            description="Another tenant",
        )
        db.add(other)
        db.flush()
        tier = QualityTier(business_id=other.id, name="Basic")
        db.add_all(
            [
                tier,
                BusinessCategory(business_id=other.id, name="karaoke"),
                BusinessCategory(business_id=other.id, name="table"),
                BusinessCategory(business_id=other.id, name="chair"),
            ]
        )
        db.flush()
        other_product = Product(
            business_id=other.id,
            name="Basic Karaoke",
            category=ProductCategory.KARAOKE.value,
            quality_tier_id=tier.id,
            price_cents=60_000,
            pricing_basis="per_rental",
        )
        db.add(other_product)
        db.flush()
        db.add(InventoryAsset(business_id=other.id, product_id=other_product.id, asset_tag="OTHER-1"))
        db.commit()
        other_business_id = other.id
        other_product_id = other_product.id
    finally:
        generator.close()

    create_tenant_admin(client, "other-admin@example.com", other_business_id)
    first_headers = auth_header(token_for(client, "admin@example.com", "secure-admin-password"))
    other_headers = auth_header(
        token_for(client, "other-admin@example.com", "secure-business-password")
    )

    first_products = client.get("/api/admin/products", headers=first_headers).json()
    other_products = client.get("/api/admin/products", headers=other_headers).json()
    assert [product["id"] for product in first_products] == [first_product_id]
    assert [product["id"] for product in other_products] == [other_product_id]

    forbidden_update = client.patch(
        f"/api/admin/products/{other_product_id}/price",
        json={"price_cents": 10_000},
        headers=first_headers,
    )
    assert forbidden_update.status_code == 404

    cross_tenant_package = client.post(
        "/api/admin/packages",
        json={"name": "Cross-tenant package", "components": [{"product_id": other_product_id, "quantity": 1}]},
        headers=first_headers,
    )
    assert cross_tenant_package.status_code == 404

    cross_tenant_quote = client.post(
        "/api/orders/quote",
        json=order_payload(other_product_id),
    )
    assert cross_tenant_quote.status_code == 404


def test_business_registration_requires_platform_approval_and_tenant_roles_are_separate(client):
    create_platform_admin(client)
    platform_headers = auth_header(
        token_for(client, "platform@example.com", "secure-platform-password")
    )
    registration = client.post(
        "/api/auth/business-register",
        json={
            "business_name": "North Star Karaoke",
            "owner_name": "Business Owner",
            "email": "owner@northstar.example",
            "contact_number": "+1 555 0100",
            "address": "100 Main Street",
            "password": "secure-owner-password",
        },
    )
    assert registration.status_code == 201, registration.text
    business_id = registration.json()["business_id"]
    assert registration.json()["status"] == "pending"

    owner_headers = auth_header(
        token_for(client, "owner@northstar.example", "secure-owner-password")
    )
    assert client.get("/api/admin/products", headers=owner_headers).status_code == 403
    assert client.get("/api/platform/businesses", headers=owner_headers).status_code == 403

    pending = client.get("/api/platform/businesses?status=pending", headers=platform_headers)
    assert pending.status_code == 200
    assert any(item["id"] == business_id for item in pending.json())

    approved = client.patch(
        f"/api/platform/businesses/{business_id}/status",
        json={"status": "active", "note": "Approved"},
        headers=platform_headers,
    )
    assert approved.status_code == 200, approved.text
    owner = client.get("/api/users/me", headers=owner_headers).json()
    assert owner["role"] == UserRole.BUSINESS_ADMIN.value
    assert owner["business_id"] == business_id
    assert client.get("/api/admin/categories", headers=owner_headers).status_code == 200
    suspended = client.patch(
        f"/api/platform/businesses/{business_id}/status",
        json={"status": "suspended"},
        headers=platform_headers,
    )
    assert suspended.status_code == 200
    assert client.get("/api/admin/products", headers=owner_headers).status_code == 403
    assert all(item["id"] != business_id for item in client.get("/api/marketplace/businesses").json())


def test_cors_does_not_allow_ambient_credentials(client):
    response = client.options(
        "/api/orders",
        headers={
            "Origin": "http://localhost:4200",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:4200"
    assert "access-control-allow-credentials" not in response.headers


def test_liveness_endpoint(client):
    response = client.get("/api/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
