from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_api_key
from app.schemas import IngredientListResponse
from app.services.ingredients import list_ingredients

router = APIRouter(tags=["ingredients"], dependencies=[Depends(require_api_key)])


@router.get("/api/ingredients", response_model=IngredientListResponse)
def get_ingredients(db: Session = Depends(get_db)) -> IngredientListResponse:
    result = list_ingredients(db)
    db.commit()
    return result
