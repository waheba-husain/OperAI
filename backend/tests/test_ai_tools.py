from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.ai.tools import (
    ALLOWED_TOOLS,
    BEDROCK_TOOLS,
    dispatch_tool,
    execute_tool_for_converse,
    get_tool_config,
    get_tool_specs,
)
from app.errors import AppError
from app.models import Ingredient, MenuItem
from app.schemas import (
    RecoveryBaseline,
    RecoveryImpact,
    RecoveryOption,
    RecoveryProposeResponse,
    RecoveryScoring,
    RecoveryShortage,
    RecoveryWeights,
)


class TestBedrockToolSpecs:
    def test_tool_specs_count_and_names(self):
        specs = get_tool_specs()
        assert len(specs) == 4
        names = {s["toolSpec"]["name"] for s in specs}
        assert names == {"get_brief", "propose_recovery", "analyze_price", "extract_order"}
        assert "extract_order" in ALLOWED_TOOLS


    def test_tool_spec_converse_format(self):
        for s in get_tool_specs():
            assert "toolSpec" in s
            spec = s["toolSpec"]
            assert "name" in spec
            assert "description" in spec
            assert "inputSchema" in spec
            assert "json" in spec["inputSchema"]
            assert spec["inputSchema"]["json"]["type"] == "object"
            assert "properties" in spec["inputSchema"]["json"]
            assert "required" in spec["inputSchema"]["json"]

    def test_disallowed_mutation_tools_not_in_specs(self):
        forbidden_names = {
            "approve",
            "approve_action",
            "reject",
            "reject_action",
            "execute",
            "undo",
            "delete_order",
        }
        spec_names = {s["toolSpec"]["name"] for s in get_tool_specs()}
        assert not (forbidden_names & spec_names)
        assert not (forbidden_names & ALLOWED_TOOLS)

    def test_tool_config_structure(self):
        config = get_tool_config()
        assert "tools" in config
        assert config["tools"] == get_tool_specs()


class TestToolDispatchDisallowed:
    @pytest.mark.parametrize(
        "forbidden_tool",
        [
            "approve_action",
            "reject_action",
            "undo",
            "execute",
            "unknown_tool",
            "delete_all",
        ],
    )
    def test_disallowed_tools_rejected(self, forbidden_tool, db_session):
        with pytest.raises(AppError) as exc_info:
            dispatch_tool(forbidden_tool, {}, db_session)
        assert exc_info.value.status == 400
        assert exc_info.value.code == "DISALLOWED_TOOL"


class TestGetBriefTool:
    def test_get_brief_default_date(self, db_session):
        result = dispatch_tool("get_brief", {}, db_session)
        assert "date" in result
        assert "order_count" in result
        assert "shortages" in result
        assert "at_risk_orders" in result
        assert "revenue_at_risk" in result

    def test_get_brief_explicit_date(self, db_session):
        result = dispatch_tool("get_brief", {"date": "2026-10-17"}, db_session)
        assert result["date"] == "2026-10-17"
        assert isinstance(result["revenue_at_risk"], (int, float))

    def test_get_brief_invalid_date_format(self, db_session):
        with pytest.raises(AppError) as exc_info:
            dispatch_tool("get_brief", {"date": "invalid-date"}, db_session)
        assert exc_info.value.status == 422
        assert exc_info.value.code == "VALIDATION_ERROR"


class TestAnalyzePriceTool:
    def test_analyze_price_by_name(self, db_session):
        result = dispatch_tool("analyze_price", {"menu_item_name": "Paneer Biryani"}, db_session)
        assert result["name"] == "Paneer Biryani"
        assert result["analyzed_price"] == 180.0
        assert "cost_breakdown" in result
        assert "suggested_price" in result
        assert "margin_pct" in result

    def test_analyze_price_case_insensitive(self, db_session):
        result = dispatch_tool("analyze_price", {"menu_item_name": "paneer biryani"}, db_session)
        assert result["name"] == "Paneer Biryani"

    def test_analyze_price_by_id(self, db_session):
        dish = db_session.scalar(select(MenuItem).where(MenuItem.name == "Paneer Biryani"))
        assert dish is not None
        result = dispatch_tool("analyze_price", {"menu_item_id": str(dish.id)}, db_session)
        assert result["name"] == "Paneer Biryani"
        assert result["menu_item_id"] == str(dish.id)

    def test_analyze_price_with_whatif_price(self, db_session):
        result = dispatch_tool(
            "analyze_price",
            {"menu_item_name": "Paneer Biryani", "price": 220.0},
            db_session,
        )
        assert result["analyzed_price"] == 220.0
        assert result["current_price"] == 180.0

    def test_analyze_price_negative_price_raises_422(self, db_session):
        with pytest.raises(AppError) as exc_info:
            dispatch_tool(
                "analyze_price",
                {"menu_item_name": "Paneer Biryani", "price": -10.0},
                db_session,
            )
        assert exc_info.value.status == 422
        assert exc_info.value.code == "VALIDATION_ERROR"

    def test_analyze_price_menu_item_not_found(self, db_session):
        with pytest.raises(AppError) as exc_info:
            dispatch_tool(
                "analyze_price",
                {"menu_item_name": "Nonexistent Tacos"},
                db_session,
            )
        assert exc_info.value.status == 404
        assert exc_info.value.code == "MENU_ITEM_NOT_FOUND"

    def test_analyze_price_missing_identifiers_raises_422(self, db_session):
        with pytest.raises(AppError) as exc_info:
            dispatch_tool("analyze_price", {"price": 100.0}, db_session)
        assert exc_info.value.status == 422
        assert exc_info.value.code == "VALIDATION_ERROR"


class TestProposeRecoveryTool:
    def test_propose_recovery_no_shortage_raises_409(self, db_session):
        # In baseline seeded state with no planned plan_tasks, propose_recovery raises 404 PLAN_NOT_FOUND or 409
        with pytest.raises(AppError) as exc_info:
            dispatch_tool(
                "propose_recovery",
                {"ingredient_name": "Paneer", "date": "2026-10-17"},
                db_session,
            )
        assert exc_info.value.status in (404, 409)

    def test_propose_recovery_success_and_option_ids_extracted(self, db_session):
        paneer = db_session.scalar(select(Ingredient).where(Ingredient.name == "Paneer"))
        assert paneer is not None

        action_id1 = uuid4()
        action_id2 = uuid4()
        group_id = uuid4()

        mock_response = RecoveryProposeResponse(
            group_id=group_id,
            shortage=RecoveryShortage(
                ingredient_id=paneer.id,
                name="Paneer",
                short_by=Decimal("0.84"),
                unit="kg",
            ),
            baseline=RecoveryBaseline(
                late_orders=2,
                revenue_at_risk=Decimal("500.00"),
                extra_cost=Decimal("0.00"),
            ),
            scoring=RecoveryScoring(
                weights=RecoveryWeights(
                    lateness=Decimal("0.5"),
                    margin=Decimal("0.3"),
                    customer_risk=Decimal("0.2"),
                )
            ),
            recommended_option_number=1,
            options=[
                RecoveryOption(
                    action_id=action_id1,
                    option_number=1,
                    option_type="substitute",
                    title="Swap for Tofu",
                    status="pending",
                    needs_customer_consent=True,
                    impact=RecoveryImpact(
                        late_orders=0,
                        orders_protected=2,
                        revenue_at_risk_after=Decimal("0.00"),
                        extra_cost=Decimal("-15.00"),
                        margin_before_pct=Decimal("20.00"),
                        margin_after_pct=Decimal("22.50"),
                        customer_risk="low",
                        score=Decimal("0.85"),
                    ),
                    expires_at=date(2026, 10, 18),
                ),
                RecoveryOption(
                    action_id=action_id2,
                    option_number=2,
                    option_type="emergency_purchase",
                    title="Buy 1 kg paneer locally",
                    status="pending",
                    needs_customer_consent=False,
                    impact=RecoveryImpact(
                        late_orders=1,
                        orders_protected=1,
                        revenue_at_risk_after=Decimal("150.00"),
                        extra_cost=Decimal("50.00"),
                        margin_before_pct=Decimal("20.00"),
                        margin_after_pct=Decimal("18.00"),
                        customer_risk="low",
                        score=Decimal("0.65"),
                    ),
                    expires_at=date(2026, 10, 18),
                ),
            ],
        )

        with patch("app.ai.tools.propose_recovery", return_value=mock_response) as mock_service:
            result = dispatch_tool(
                "propose_recovery",
                {"ingredient_name": "Paneer", "date": "2026-10-17"},
                db_session,
            )

            mock_service.assert_called_once_with(
                db_session,
                target_date=date(2026, 10, 17),
                ingredient_id=paneer.id,
                reported_available_qty=None,
            )
            assert result["group_id"] == str(group_id)
            assert result["option_action_ids"] == [str(action_id1), str(action_id2)]
            assert len(result["options"]) == 2

    def test_propose_recovery_unknown_ingredient(self, db_session):
        with pytest.raises(AppError) as exc_info:
            dispatch_tool("propose_recovery", {"ingredient_name": "Truffles"}, db_session)
        assert exc_info.value.status == 404
        assert exc_info.value.code == "INGREDIENT_NOT_FOUND"

    def test_propose_recovery_normalizes_punctuation_and_plural_fallback(self, db_session):
        onion = db_session.scalar(select(Ingredient).where(Ingredient.name == "Onion"))
        assert onion is not None

        mock_response = MagicMock()
        mock_response.model_dump.return_value = {"group_id": str(uuid4()), "options": []}
        mock_response.options = []

        with patch("app.ai.tools.propose_recovery", return_value=mock_response) as mock_service:
            # "Onions." has trailing punctuation and plural form, should resolve to "Onion"
            _ = dispatch_tool(
                "propose_recovery",
                {"ingredient_name": "Onions.", "date": "2026-10-17"},
                db_session,
            )
            mock_service.assert_called_once_with(
                db_session,
                target_date=date(2026, 10, 17),
                ingredient_id=onion.id,
                reported_available_qty=None,
            )

    def test_propose_recovery_tomato_not_in_catalog_raises_404(self, db_session):
        # "tomato" and "tomatoes" do not exist in the simulated kitchen catalog
        for name in ("tomato", "tomatoes", "Tomato."):
            with pytest.raises(AppError) as exc_info:
                dispatch_tool("propose_recovery", {"ingredient_name": name}, db_session)
            assert exc_info.value.status == 404
            assert exc_info.value.code == "INGREDIENT_NOT_FOUND"

    def test_propose_recovery_invalid_uuid(self, db_session):
        with pytest.raises(AppError) as exc_info:
            dispatch_tool("propose_recovery", {"ingredient_id": "invalid-uuid"}, db_session)
        assert exc_info.value.status == 422
        assert exc_info.value.code == "VALIDATION_ERROR"

    def test_propose_recovery_missing_ingredient(self, db_session):
        with pytest.raises(AppError) as exc_info:
            dispatch_tool("propose_recovery", {"date": "2026-10-17"}, db_session)
        assert exc_info.value.status == 422
        assert exc_info.value.code == "VALIDATION_ERROR"

    def test_propose_recovery_negative_qty(self, db_session):
        with pytest.raises(AppError) as exc_info:
            dispatch_tool(
                "propose_recovery",
                {"ingredient_name": "Paneer", "reported_available_qty": -1.5},
                db_session,
            )
        assert exc_info.value.status == 422
        assert exc_info.value.code == "VALIDATION_ERROR"


class TestExtractOrderTool:
    def test_extract_order_in_active_registry(self):
        active_names = {s["toolSpec"]["name"] for s in get_tool_specs()}
        assert "extract_order" in active_names
        assert "extract_order" in ALLOWED_TOOLS
        config_names = {s["toolSpec"]["name"] for s in get_tool_config().get("tools", [])}
        assert "extract_order" in config_names

    def test_extract_order_dispatch_returns_pending_proposal(self, db_session, monkeypatch):
        from app.ai.extractor import RawExtractedItem, RawExtractedOrder
        from app.models import ProposedAction

        monkeypatch.setattr(
            "app.services.orders.extract_order_from_text",
            lambda _text: RawExtractedOrder(
                customer_name="Customer D",
                deadline="2026-10-17T13:00:00+05:30",
                items=[RawExtractedItem(dish="Paneer Biryani", quantity=2)],
                confidence=0.9,
            ),
        )
        result = dispatch_tool(
            "extract_order",
            {"text": "2 Paneer Biryani for tomorrow at 1pm, Customer D"},
            db_session,
        )
        assert result["action"]["status"] == "pending"
        assert result["option_action_ids"] == [result["action"]["id"]]
        assert db_session.query(ProposedAction).filter_by(action_type="order_intake").count() == 1



class TestExecuteToolForConverse:
    def test_execute_tool_success_packaging(self, db_session):
        res = execute_tool_for_converse(
            tool_use_id="tool_123",
            name="get_brief",
            input_params={"date": "2026-10-17"},
            db=db_session,
        )
        assert "toolResult" in res
        tr = res["toolResult"]
        assert tr["toolUseId"] == "tool_123"
        assert tr["status"] == "success"
        assert isinstance(tr["content"], list)
        assert "json" in tr["content"][0]
        assert tr["content"][0]["json"]["date"] == "2026-10-17"

    def test_execute_tool_error_packaging(self, db_session):
        res = execute_tool_for_converse(
            tool_use_id="tool_456",
            name="approve_action",
            input_params={"confirm_option_number": 1},
            db=db_session,
        )
        assert "toolResult" in res
        tr = res["toolResult"]
        assert tr["toolUseId"] == "tool_456"
        assert tr["status"] == "error"
        assert isinstance(tr["content"], list)
        assert "text" in tr["content"][0]
        assert "DISALLOWED_TOOL" in tr["content"][0]["text"]
