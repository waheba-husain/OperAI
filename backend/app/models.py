from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, JSON, Numeric, Text, Uuid
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Kitchen(Base):
    __tablename__ = "kitchens"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    burner_count: Mapped[int] = mapped_column(Integer, nullable=False)
    cook_count: Mapped[int] = mapped_column(Integer, nullable=False)
    overhead_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    commission_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    target_margin_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    plan_version: Mapped[int] = mapped_column(Integer, nullable=False)
    data_source: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(nullable=False)


class Ingredient(Base):
    __tablename__ = "ingredients"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    kitchen_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("kitchens.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str] = mapped_column(Text, nullable=False)
    stock_qty: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    cost_per_unit: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    allergen_tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    diet_tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    data_source: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(nullable=False)


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    kitchen_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("kitchens.id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    packaging_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    prep_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    cook_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False)
    data_source: Mapped[str] = mapped_column(Text, nullable=False)

    recipe_items: Mapped[list["RecipeItem"]] = relationship(back_populates="menu_item")


class RecipeItem(Base):
    __tablename__ = "recipe_items"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    menu_item_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False
    )
    ingredient_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("ingredients.id"), nullable=False)
    qty_per_portion: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)

    menu_item: Mapped[MenuItem] = relationship(back_populates="recipe_items")
    ingredient: Mapped[Ingredient] = relationship()


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    kitchen_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("kitchens.id"), nullable=False)
    customer_name: Mapped[str] = mapped_column(Text, nullable=False)
    customer_phone: Mapped[str | None] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(Text, nullable=False)
    deadline: Mapped[datetime] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    source_text: Mapped[str | None] = mapped_column(Text)
    extraction_confidence: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    data_source: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(nullable=False)

    items: Mapped[list["OrderItem"]] = relationship(back_populates="order")


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    order_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    menu_item_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("menu_items.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    swapped_from_item_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("menu_items.id"))

    order: Mapped[Order] = relationship(back_populates="items")
    menu_item: Mapped[MenuItem] = relationship(foreign_keys=[menu_item_id])
    tasks: Mapped[list["PlanTask"]] = relationship(back_populates="order_item", cascade="all, delete-orphan")


class PlanTask(Base):
    __tablename__ = "plan_tasks"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    kitchen_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("kitchens.id"), nullable=False)
    order_item_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False
    )
    task_type: Mapped[str] = mapped_column(Text, nullable=False)
    burner_no: Mapped[int | None] = mapped_column(Integer)
    cook_no: Mapped[int] = mapped_column(Integer, nullable=False)
    start_at: Mapped[datetime] = mapped_column(nullable=False)
    end_at: Mapped[datetime] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="scheduled")
    locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    plan_version: Mapped[int] = mapped_column(Integer, nullable=False)

    order_item: Mapped[OrderItem] = relationship(back_populates="tasks")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    kitchen_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("kitchens.id"), nullable=False)
    action_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    actor: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    before_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    plan_version_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    plan_version_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False)

