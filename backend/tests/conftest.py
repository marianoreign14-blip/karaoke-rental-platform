import os
from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

test_database_url = os.environ.get("TEST_DATABASE_URL", "sqlite://")
os.environ["DATABASE_URL"] = test_database_url
os.environ["SECRET_KEY"] = "test-secret-key-only-not-for-use-in-deployment-32-characters"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.routes import limiter
from app.core.database import Base, get_db
from app.main import app


@pytest.fixture
def client():
    limiter.reset()
    if test_database_url.startswith("sqlite"):
        engine = create_engine(
            test_database_url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    else:
        engine = create_engine(test_database_url, pool_pre_ping=True)
    Base.metadata.create_all(engine)

    def override_get_db():
        with Session(engine, autoflush=False) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()
