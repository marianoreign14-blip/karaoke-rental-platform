import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.routes import api, limiter
from app.core.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("karaokewebapp")
settings = get_settings()

app = FastAPI(
    title="KARAOKEWEBAPP API",
    description="A multi-tenant rental marketplace with business and platform administration.",
    version="1.0.0",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(IntegrityError)
async def integrity_error_handler(_: Request, exc: IntegrityError):
    logger.warning("Database integrity constraint rejected a request: %s", exc.orig)
    return JSONResponse(
        status_code=409,
        content={"detail": "The operation conflicts with existing application data"},
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception):
    logger.exception("Unhandled API error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "The request could not be completed. Contact an administrator if this continues."},
    )


app.include_router(api)
