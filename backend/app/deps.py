from typing import Annotated

from fastapi import Header

from app.config import settings
from app.errors import AppError


def require_api_key(
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> None:
    if x_api_key is None or x_api_key != settings.api_key:
        raise AppError(401, "UNAUTHORIZED", "Missing or invalid API key")
