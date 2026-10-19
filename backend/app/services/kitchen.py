from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import Kitchen


def get_kitchen(db: Session) -> Kitchen:
    kitchen = db.scalars(select(Kitchen)).first()
    if kitchen is None:
        raise AppError(500, "INTERNAL_ERROR", "No kitchen configured")
    return kitchen
