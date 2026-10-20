from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

from app.timeutil import IST

Money = Annotated[
    Decimal,
    PlainSerializer(lambda v: float(v), return_type=float, when_used="json"),
]
Qty = Annotated[
    Decimal,
    PlainSerializer(lambda v: float(v), return_type=float, when_used="json"),
]
MarginPct = Annotated[
    Decimal,
    PlainSerializer(lambda v: float(v), return_type=float, when_used="json"),
]


def _iso_ist(value: datetime) -> str:
    return value.astimezone(IST).isoformat()


IsoDateTime = Annotated[
    datetime,
    PlainSerializer(_iso_ist, return_type=str, when_used="json"),
]

MarginStatus = Literal["loss", "below_target", "healthy"]
OrderStatus = Literal[
    "new", "planned", "in_progress", "delayed", "partial", "completed", "cancelled"
]


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    error: ErrorBody


class IngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    unit: str
    stock_qty: Qty
    cost_per_unit: Money
    allergen_tags: list[str]
    diet_tags: list[str]
    data_source: str


class IngredientListResponse(BaseModel):
    data: list[IngredientOut]
    count: int


class CostBreakdown(BaseModel):
    ingredients: Money
    packaging: Money
    commission: Money
    overhead: Money
    total: Money


class MenuItemOut(BaseModel):
    id: UUID
    name: str
    price: Money
    cost_breakdown: CostBreakdown
    profit_per_order: Money
    margin_pct: MarginPct
    margin_status: MarginStatus
    is_active: bool
    data_source: str


class MenuListResponse(BaseModel):
    data: list[MenuItemOut]
    count: int


class OrderItemOut(BaseModel):
    menu_item_id: UUID
    name: str
    quantity: int
    unit_price: Money


class OrderOut(BaseModel):
    id: UUID
    customer_name: str
    channel: str
    deadline: IsoDateTime
    status: str
    total_amount: Money
    items: list[OrderItemOut]


class OrderListResponse(BaseModel):
    data: list[OrderOut]
    count: int


class PlanGenerateRequest(BaseModel):
    date: date
    regenerate: bool = False


class PlanGenerateResponse(BaseModel):
    date: str
    plan_version: int
    solver: Literal["greedy", "cp_sat"] = "greedy"
    feasible: bool
    orders_scheduled: int
    task_count: int
    late_orders: list[str] = Field(default_factory=list)


class PlanTaskOut(BaseModel):
    id: UUID
    order_id: UUID
    order_item_id: UUID
    dish: str
    task_type: str
    burner_no: int | None
    cook_no: int
    start_at: IsoDateTime
    end_at: IsoDateTime
    status: str
    locked: bool


class PlanResponse(BaseModel):
    date: str
    plan_version: int
    tasks: list[PlanTaskOut]
    late_orders: list[str] = Field(default_factory=list)


class ShortageOut(BaseModel):
    ingredient_id: UUID
    name: str
    unit: str
    stock_qty: Qty
    needed_qty: Qty
    short_by: Qty


class AtRiskOrderOut(BaseModel):
    order_id: UUID
    customer_name: str
    deadline: IsoDateTime
    total_amount: Money


class BriefResponse(BaseModel):
    date: str
    order_count: int
    shortages: list[ShortageOut]
    at_risk_orders: list[AtRiskOrderOut]
    revenue_at_risk: Money
    data_source: str


