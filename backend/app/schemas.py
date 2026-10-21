from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    field_validator,
)

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
Score = Annotated[
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


class OrderExtractRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)


class OrderDraftItemOut(BaseModel):
    menu_item_id: UUID
    name: str
    quantity: int
    unit_price: Money


class OrderDraftOut(BaseModel):
    customer_name: str
    customer_phone: str | None = None
    channel: str = "whatsapp"
    deadline: IsoDateTime
    items: list[OrderDraftItemOut]
    total_amount: Money


class OrderExtractActionOut(BaseModel):
    id: UUID
    group_id: UUID
    option_number: int
    action_type: str = "order_intake"
    title: str
    status: str = "pending"
    expires_at: IsoDateTime


class OrderExtractSuccessResponse(BaseModel):
    draft: OrderDraftOut
    confidence: float
    warnings: list[str] = Field(default_factory=list)
    action: OrderExtractActionOut


class OrderExtractAmbiguousResponse(BaseModel):
    draft: None = None
    confidence: float
    clarifying_questions: list[str]
    action: None = None


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


# Recovery Options schemas


class RecoveryProposeRequest(BaseModel):
    date: date
    ingredient_id: UUID
    reported_available_qty: Qty | None = None

    @field_validator("reported_available_qty")
    @classmethod
    def validate_reported_available_qty(
        cls, value: Decimal | None
    ) -> Decimal | None:
        if value is not None and value < 0:
            raise ValueError("reported_available_qty must be nonnegative")
        return value


class RecoveryShortage(BaseModel):
    ingredient_id: UUID
    name: str
    short_by: Qty
    unit: str


class RecoveryBaseline(BaseModel):
    label: str = "Do nothing"
    late_orders: int
    revenue_at_risk: Money
    extra_cost: Money = Decimal("0.00")


class RecoveryWeights(BaseModel):
    lateness: Score
    margin: Score
    customer_risk: Score


class RecoveryScoring(BaseModel):
    weights: RecoveryWeights


class RecoveryImpact(BaseModel):
    late_orders: int
    orders_protected: int
    revenue_at_risk_after: Money
    extra_cost: Money
    margin_before_pct: MarginPct
    margin_after_pct: MarginPct
    customer_risk: Literal["low", "medium", "high"]
    score: Score


class RecoveryOption(BaseModel):
    action_id: UUID
    option_number: int
    option_type: Literal[
        "substitute",
        "dish_swap",
        "delay_notify",
        "partial",
        "emergency_purchase",
    ]
    title: str
    status: Literal["pending"]
    needs_customer_consent: bool
    impact: RecoveryImpact
    expires_at: IsoDateTime


class RecoveryProposeResponse(BaseModel):
    group_id: UUID
    shortage: RecoveryShortage
    baseline: RecoveryBaseline
    scoring: RecoveryScoring
    recommended_option_number: int | None
    options: list[RecoveryOption]
    escalation: str | None = None


class ProposedActionOut(BaseModel):
    id: UUID
    group_id: UUID
    option_number: int
    action_type: str
    title: str
    status: str
    impact: dict
    base_plan_version: int
    created_at: IsoDateTime
    expires_at: IsoDateTime


class ProposedActionListResponse(BaseModel):
    data: list[ProposedActionOut]
    count: int


# Action Approval & Rejection schemas (Rest_API_Spec.md §3.12, §3.13)


class ActionRejectRequest(BaseModel):
    reason: str | None = None


class ActionRejectActionOut(BaseModel):
    id: UUID
    status: Literal["rejected"] = "rejected"
    decided_at: IsoDateTime


class ActionRejectResponse(BaseModel):
    action: ActionRejectActionOut
    audit_id: UUID


class ActionApproveRequest(BaseModel):
    confirm_option_number: int
    input_mode: Literal["voice", "click"] | None = None
    transcript: str | None = None


class ActionApproveActionOut(BaseModel):
    id: UUID
    status: Literal["executed"] = "executed"
    executed_at: IsoDateTime


class CustomerMessageOut(BaseModel):
    order_id: UUID
    customer_name: str
    needs_consent: bool
    message: str
    whatsapp_url: str


class ActionChangesOut(BaseModel):
    orders_affected: list[str]
    tasks_rescheduled: int
    summary: str


class ActionApproveResponse(BaseModel):
    action: ActionApproveActionOut
    plan_version_before: int
    plan_version_after: int
    audit_id: UUID
    changes: ActionChangesOut
    customer_messages: list[CustomerMessageOut]
    expired_action_ids: list[UUID]


class AuditEntryOut(BaseModel):
    id: UUID
    action_id: UUID | None
    event_type: str
    actor: str
    summary: str
    plan_version_before: int | None
    plan_version_after: int | None
    undoable: bool
    created_at: IsoDateTime
    before_snapshot: dict | None = None
    after_snapshot: dict | None = None


class AuditListResponse(BaseModel):
    data: list[AuditEntryOut]
    count: int


class UndoActionOut(BaseModel):
    id: UUID
    group_id: UUID
    option_number: int
    action_type: Literal["undo"]
    title: str
    status: Literal["pending"]
    undo_of_audit_id: UUID
    base_plan_version: int
    expires_at: IsoDateTime


class UndoActionResponse(BaseModel):
    action: UndoActionOut


# Risk Brief schemas


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
