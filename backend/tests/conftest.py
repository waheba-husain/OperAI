from datetime import datetime, timezone
from decimal import Decimal
import json
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import get_db
from app.main import app
from app.models import Base, Ingredient, Kitchen, MenuItem, RecipeItem


# Allow SQLite to compile PostgreSQL ARRAY types for in-memory testing
@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "TEXT"


sqlite3.register_adapter(list, lambda l: json.dumps(l))


def _seed_sqlite_baseline(engine):
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        kitchen = Kitchen(
            id=uuid4(),
            name="Demo Kitchen",
            burner_count=3,
            cook_count=2,
            overhead_pct=Decimal("12.00"),
            commission_pct=Decimal("20.00"),
            target_margin_pct=Decimal("25.00"),
            plan_version=1,
            data_source="simulated",
            created_at=now,
        )
        session.add(kitchen)

        raw_ingredients = [
            ("paneer", "Paneer", "kg", Decimal("1.000"), Decimal("380.00"), ["dairy"], ["veg"]),
            ("tofu", "Tofu", "kg", Decimal("3.000"), Decimal("220.00"), ["soy"], ["veg", "vegan"]),
            ("rice", "Basmati rice", "kg", Decimal("12.000"), Decimal("110.00"), [], ["veg", "vegan"]),
            ("veg", "Mixed vegetables", "kg", Decimal("6.000"), Decimal("60.00"), [], ["veg", "vegan"]),
            ("onion", "Onion", "kg", Decimal("8.000"), Decimal("40.00"), [], ["veg", "vegan"]),
        ]
        ings = {}
        for key, name, unit, stock, cost, allergens, diets in raw_ingredients:
            ing = Ingredient(
                id=uuid4(),
                kitchen_id=kitchen.id,
                name=name,
                unit=unit,
                stock_qty=stock,
                cost_per_unit=cost,
                allergen_tags=allergens,
                diet_tags=diets,
                data_source="simulated",
                updated_at=now,
            )
            session.add(ing)
            ings[key] = ing

        raw_dishes = [
            ("B", "Paneer Biryani", Decimal("180.00"), Decimal("14.00"), 15, 35, {"paneer": Decimal("0.150"), "rice": Decimal("0.120"), "onion": Decimal("0.050")}),
            ("P", "Paneer Butter Masala", Decimal("220.00"), Decimal("16.00"), 10, 25, {"paneer": Decimal("0.120"), "onion": Decimal("0.080")}),
            ("V", "Veg Pulao", Decimal("150.00"), Decimal("12.00"), 10, 25, {"rice": Decimal("0.120"), "veg": Decimal("0.100"), "onion": Decimal("0.040")}),
            ("VB", "Veg Biryani", Decimal("160.00"), Decimal("14.00"), 15, 35, {"rice": Decimal("0.120"), "veg": Decimal("0.120"), "onion": Decimal("0.050")}),
            ("J", "Jeera Rice", Decimal("90.00"), Decimal("8.00"), 5, 20, {"rice": Decimal("0.150")}),
        ]
        for _code, name, price, pack, prep, cook, recipe in raw_dishes:
            dish = MenuItem(
                id=uuid4(),
                kitchen_id=kitchen.id,
                name=name,
                price=price,
                packaging_cost=pack,
                prep_minutes=prep,
                cook_minutes=cook,
                is_active=True,
                data_source="simulated",
            )
            session.add(dish)
            for ikey, qty in recipe.items():
                session.add(
                    RecipeItem(
                        id=uuid4(),
                        menu_item_id=dish.id,
                        ingredient_id=ings[ikey].id,
                        qty_per_portion=qty,
                    )
                )

        session.commit()


@pytest.fixture(scope="session")
def engine():
    engine_kwargs = {"pool_pre_ping": True}
    if settings.database_url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
        engine_kwargs["poolclass"] = StaticPool
    eng = create_engine(settings.database_url, **engine_kwargs)
    if settings.database_url.startswith("sqlite"):
        Base.metadata.create_all(eng)
        _seed_sqlite_baseline(eng)
    return eng


@pytest.fixture
def db_session(engine):
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, autoflush=False)
    connection.begin_nested()

    @event.listens_for(session, "after_transaction_end")
    def restart_savepoint(sess, trans):
        if connection.closed:
            return
        if not connection.in_nested_transaction():
            connection.begin_nested()

    try:
        yield session
    finally:
        session.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        test_client.headers["X-API-Key"] = settings.api_key
        yield test_client
    app.dependency_overrides.clear()
