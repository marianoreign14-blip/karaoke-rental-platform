from functools import lru_cache
import json
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    value = url.strip()
    if value.startswith("postgres://"):
        return "postgresql+psycopg://" + value[len("postgres://") :]
    if value.startswith("postgresql://"):
        return "postgresql+psycopg://" + value[len("postgresql://") :]
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str
    secret_key: str
    access_token_minutes: int = 60
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:4200", "http://localhost:8100"]
    app_base_url: str = "http://localhost:4200"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_use_tls: bool = True

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        normalized = normalize_database_url(value)
        if not normalized:
            raise ValueError("DATABASE_URL is required")
        return normalized

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, value: str) -> str:
        if len(value) < 32 or value.startswith("replace-with-"):
            raise ValueError("SECRET_KEY must be a randomly generated value of at least 32 characters")
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> list[str]:
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            if raw.startswith("["):
                parsed = json.loads(raw)
                if not isinstance(parsed, list):
                    raise ValueError("CORS_ORIGINS JSON value must be a list of origins")
                origins = [str(item).strip().rstrip("/") for item in parsed if str(item).strip()]
            else:
                origins = [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]
        elif isinstance(value, list):
            origins = [str(item).strip().rstrip("/") for item in value if str(item).strip()]
        else:
            raise ValueError("CORS_ORIGINS must be a list or comma-separated string of origins")
        if any(origin == "*" for origin in origins):
            raise ValueError("Wildcard '*' is not allowed in CORS_ORIGINS")
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
