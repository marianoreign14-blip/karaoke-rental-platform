from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str
    secret_key: str
    access_token_minutes: int = 60
    cors_origins: list[str] = ["http://localhost:4200", "http://localhost:8100"]

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, value: str) -> str:
        if len(value) < 32 or value.startswith("replace-with-"):
            raise ValueError("SECRET_KEY must be a randomly generated value of at least 32 characters")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
