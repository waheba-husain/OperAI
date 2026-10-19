from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_api_key
from app.schemas import MenuListResponse
from app.services.pricing import list_menu

router = APIRouter(tags=["menu"], dependencies=[Depends(require_api_key)])


@router.get("/api/menu", response_model=MenuListResponse)
def get_menu(db: Session = Depends(get_db)) -> MenuListResponse:
    result = list_menu(db)
    db.commit()
    return result
