from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Ingredient
from app.schemas import IngredientListResponse, IngredientOut
from app.services.kitchen import get_kitchen


def list_ingredients(db: Session) -> IngredientListResponse:
    kitchen = get_kitchen(db)
    rows = db.scalars(
        select(Ingredient)
        .where(Ingredient.kitchen_id == kitchen.id)
        .order_by(Ingredient.name)
    ).all()
    data = [IngredientOut.model_validate(row) for row in rows]
    return IngredientListResponse(data=data, count=len(data))
