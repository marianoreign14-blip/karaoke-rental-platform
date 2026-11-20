from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Notification, User, UserRole


def notify_user(
    db: Session,
    *,
    user_id: int,
    kind: str,
    title: str,
    message: str,
    link: str | None = None,
    business_id: int | None = None,
) -> Notification:
    item = Notification(
        user_id=user_id,
        business_id=business_id,
        kind=kind,
        title=title[:160],
        message=message,
        link=link,
    )
    db.add(item)
    return item


def notify_business_team(
    db: Session,
    *,
    business_id: int,
    kind: str,
    title: str,
    message: str,
    link: str | None = "/admin",
) -> None:
    member_ids = db.scalars(
        select(User.id).where(
            User.business_id == business_id,
            User.is_active.is_(True),
            User.role.in_([UserRole.BUSINESS_ADMIN, UserRole.BUSINESS_STAFF]),
        )
    ).all()
    for member_id in member_ids:
        notify_user(
            db,
            user_id=member_id,
            business_id=business_id,
            kind=kind,
            title=title,
            message=message,
            link=link,
        )


def notify_platform_admins(
    db: Session,
    *,
    kind: str,
    title: str,
    message: str,
    link: str | None = "/platform",
    business_id: int | None = None,
) -> None:
    admin_ids = db.scalars(
        select(User.id).where(
            User.role == UserRole.PLATFORM_ADMIN,
            User.is_active.is_(True),
        )
    ).all()
    for admin_id in admin_ids:
        notify_user(
            db,
            user_id=admin_id,
            business_id=business_id,
            kind=kind,
            title=title,
            message=message,
            link=link,
        )
