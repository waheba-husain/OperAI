from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_api_key
from app.services.pricing_analysis import analyze_price

router = APIRouter(tags=["pricing"], dependencies=[Depends(require_api_key)])


class PricingAnalyzeIn(BaseModel):
    menu_item_id: UUID
    price: Decimal | None = None
    propose_change: bool = False  # accepted but ignored until feature 5


class PriceCostBreakdown(BaseModel):
    ingredients: float
    packaging: float
    commission: float
    overhead: float
    total: float


class PriceAssumptions(BaseModel):
    commission_pct: float
    overhead_pct: float
    target_margin_pct: float
    data_source: str


class PricingAnalyzeOut(BaseModel):
    menu_item_id: UUID
    name: str
    analyzed_price: float
    current_price: float
    cost_breakdown: PriceCostBreakdown
    profit_per_order: float
    margin_pct: float
    margin_status: Literal["loss", "below_target", "healthy"]
    suggested_price: float
    suggested_profit_per_order: float
    suggested_margin_pct: float
    assumptions: PriceAssumptions
    action: None = None


@router.post("/api/pricing/analyze", response_model=PricingAnalyzeOut)
def analyze(body: PricingAnalyzeIn, db: Session = Depends(get_db)) -> dict:
    return analyze_price(db, body.menu_item_id, body.price)