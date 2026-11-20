from collections.abc import Generator

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models import Business, BusinessStatus, User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication is required",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        user_id = int(decode_access_token(token)["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise unauthorized from None
    user = db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
    if user is None:
        raise unauthorized
    return user


def administrator(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> User:
    if user.role not in {UserRole.BUSINESS_ADMIN, UserRole.BUSINESS_STAFF} or user.business_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Business administrator access is required")
    business = db.get(Business, user.business_id)
    if business is None or business.status != BusinessStatus.ACTIVE.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This business is not active")
    return user


def platform_administrator(user: User = Depends(current_user)) -> User:
    if user.role != UserRole.PLATFORM_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform administrator access is required")
    return user
