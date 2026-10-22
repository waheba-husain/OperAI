from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from botocore.exceptions import ConnectTimeoutError

from app.ai.bedrock import BedrockClient, BedrockResponseError, BedrockUnavailableError, ConverseResult, get_bedrock_client
from app.config import settings
from app.errors import AppError
from app.main import app
from app.models import Ingredient
from app.schemas import (
    RecoveryBaseline,
    RecoveryImpact,
    RecoveryOption,
    RecoveryProposeResponse,
    RecoveryScoring,
    RecoveryShortage,
    RecoveryWeights,
)
from app.services.chat import MAX_TOOL_ROUNDS, orchestrate_chat


def _make_converse_result(text: str, content: list | None = None, stop_reason: str = "end_turn") -> ConverseResult:
    if content is None:
        content = [{"text": text}]
    return ConverseResult(
        message={"role": "assistant", "content": content},
        content=content,
        text=text,
        stop_reason=stop_reason,
        usage={"inputTokens": 10, "outputTokens": 10, "totalTokens": 20},
        raw_response={"output": {"message": {"role": "assistant", "content": content}}},
    )


class TestAgentChatAuthenticationAndValidation:
    def test_missing_api_key_returns_401(self, client):
        client.headers.pop("X-API-Key", None)
        response = client.post("/api/agent/chat", json={"message": "Hello"})
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "UNAUTHORIZED"

    def test_invalid_api_key_returns_401(self, client):
        client.headers["X-API-Key"] = "wrong-key"
        response = client.post("/api/agent/chat", json={"message": "Hello"})
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "UNAUTHORIZED"

    def test_empty_message_returns_422(self, client):
        response = client.post("/api/agent/chat", json={"message": ""})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_whitespace_message_returns_422(self, client):
        response = client.post("/api/agent/chat", json={"message": "   \n\t  "})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_message_too_long_returns_422(self, client):
        response = client.post("/api/agent/chat", json={"message": "a" * 501})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_invalid_input_mode_returns_422(self, client):
        response = client.post(
            "/api/agent/chat",
            json={"message": "Hello", "input_mode": "click"},
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


class TestAgentChatPlainText:
    def test_plain_text_direct_response_no_tools(self, client):
        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.return_value = _make_converse_result(
            "Hello! I am OperAI. How can I assist you with kitchen operations today?"
        )

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            response = client.post(
                "/api/agent/chat",
                json={"message": "Hello there", "input_mode": "voice"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["reply"] == "Hello! I am OperAI. How can I assist you with kitchen operations today?"
            assert data["intent"] == "unknown"
            assert data["tool_used"] is None
            assert data["data"] is None
            assert data["requires_confirmation"] is False
            assert data["confirm_phrases"] == []
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)


class TestAgentChatToolUseCycles:
    def test_get_brief_tool_cycle(self, client):
        tool_call_result = _make_converse_result(
            text="",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_brief_01",
                        "name": "get_brief",
                        "input": {"date": "2026-10-17"},
                    }
                }
            ],
            stop_reason="tool_use",
        )
        final_text_result = _make_converse_result(
            "For tomorrow, 26 orders are scheduled with revenue at risk of 1,180 rupees."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, final_text_result]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            response = client.post(
                "/api/agent/chat",
                json={"message": "What is my morning risk brief?"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["reply"] == "For tomorrow, 26 orders are scheduled with revenue at risk of 1,180 rupees."
            assert data["intent"] == "get_brief"
            assert data["tool_used"] == "get_brief"
            assert isinstance(data["data"], dict)
            assert data["data"]["date"] == "2026-10-17"
            assert data["requires_confirmation"] is False
            assert data["confirm_phrases"] == []
            assert mock_bedrock.converse.call_count == 2
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_analyze_price_tool_cycle(self, client):
        tool_call_result = _make_converse_result(
            text="",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_price_01",
                        "name": "analyze_price",
                        "input": {"menu_item_name": "Paneer Biryani", "price": 200.0},
                    }
                }
            ],
            stop_reason="tool_use",
        )
        final_text_result = _make_converse_result(
            "At 200 rupees, Paneer Biryani gives a healthy margin of 22%."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, final_text_result]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            response = client.post(
                "/api/agent/chat",
                json={"message": "What if we price paneer biryani at 200?"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["reply"] == "At 200 rupees, Paneer Biryani gives a healthy margin of 22%."
            assert data["intent"] == "analyze_price"
            assert data["tool_used"] == "analyze_price"
            assert isinstance(data["data"], dict)
            assert data["data"]["analyzed_price"] == 200.0
            assert data["requires_confirmation"] is False
            assert data["confirm_phrases"] == []
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_propose_recovery_tool_cycle_with_confirmation_phrases(self, client, db_session):
        group_id = uuid4()
        act_id1 = uuid4()
        act_id2 = uuid4()
        act_id3 = uuid4()

        mock_recovery_resp = RecoveryProposeResponse(
            group_id=group_id,
            shortage=RecoveryShortage(
                ingredient_id=uuid4(),
                name="Paneer",
                short_by=Decimal("0.84"),
                unit="kg",
            ),
            baseline=RecoveryBaseline(
                late_orders=4,
                revenue_at_risk=Decimal("1180.00"),
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
                    action_id=act_id1,
                    option_number=1,
                    option_type="substitute",
                    title="Swap paneer for tofu in 4 orders",
                    status="pending",
                    needs_customer_consent=True,
                    impact=RecoveryImpact(
                        late_orders=0,
                        orders_protected=4,
                        revenue_at_risk_after=Decimal("0.00"),
                        extra_cost=Decimal("-147.00"),
                        margin_before_pct=Decimal("15.00"),
                        margin_after_pct=Decimal("18.00"),
                        customer_risk="low",
                        score=Decimal("0.88"),
                    ),
                    expires_at=datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc),
                ),
                RecoveryOption(
                    action_id=act_id2,
                    option_number=2,
                    option_type="emergency_purchase",
                    title="Buy 1 kg paneer locally",
                    status="pending",
                    needs_customer_consent=False,
                    impact=RecoveryImpact(
                        late_orders=1,
                        orders_protected=3,
                        revenue_at_risk_after=Decimal("300.00"),
                        extra_cost=Decimal("80.00"),
                        margin_before_pct=Decimal("15.00"),
                        margin_after_pct=Decimal("13.00"),
                        customer_risk="low",
                        score=Decimal("0.70"),
                    ),
                    expires_at=datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc),
                ),
                RecoveryOption(
                    action_id=act_id3,
                    option_number=3,
                    option_type="delay_notify",
                    title="Notify customers of 30 min delay",
                    status="pending",
                    needs_customer_consent=True,
                    impact=RecoveryImpact(
                        late_orders=4,
                        orders_protected=0,
                        revenue_at_risk_after=Decimal("1180.00"),
                        extra_cost=Decimal("0.00"),
                        margin_before_pct=Decimal("15.00"),
                        margin_after_pct=Decimal("15.00"),
                        customer_risk="high",
                        score=Decimal("0.30"),
                    ),
                    expires_at=datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc),
                ),
            ],
        )

        tool_call_result = _make_converse_result(
            text="",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_rec_01",
                        "name": "propose_recovery",
                        "input": {"ingredient_name": "Paneer"},
                    }
                }
            ],
            stop_reason="tool_use",
        )
        final_text_result = _make_converse_result(
            "Paneer is short for tomorrow and four orders worth 1,180 rupees are at risk. "
            "Option 1: use tofu in four orders, saves 147 rupees, needs customer consent. "
            "Option 2: buy 1 kg locally, one order runs 30 minutes late. "
            "Say confirm option 1, or confirm option 2."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, final_text_result]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            with patch("app.ai.tools.propose_recovery", return_value=mock_recovery_resp):
                response = client.post(
                    "/api/agent/chat",
                    json={"message": "We are out of paneer", "input_mode": "voice"},
                )
                assert response.status_code == 200
                data = response.json()
                assert "four orders worth 1,180 rupees are at risk" in data["reply"]
                assert data["intent"] == "report_shortage"
                assert data["tool_used"] == "propose_recovery"
                assert data["requires_confirmation"] is True
                assert data["confirm_phrases"] == [
                    "confirm option 1",
                    "confirm option 2",
                    "confirm option 3",
                ]
                assert data["data"]["group_id"] == str(group_id)
                assert data["data"]["option_action_ids"] == [
                    str(act_id1),
                    str(act_id2),
                    str(act_id3),
                ]
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_propose_recovery_plan_not_found_handled_gracefully(self, client):
        from app.errors import AppError

        tool_call_result = _make_converse_result(
            text="",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_rec_pnf",
                        "name": "propose_recovery",
                        "input": {"ingredient_name": "Paneer", "reported_available_qty": 1},
                    }
                }
            ],
            stop_reason="tool_use",
        )
        plan_not_found_reply = _make_converse_result(
            "It looks like there's no active production plan in the system for today. "
            "Please generate the daily plan through the Plan tab first."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, plan_not_found_reply]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            with patch(
                "app.ai.tools.propose_recovery",
                side_effect=AppError(404, "PLAN_NOT_FOUND", "No plan found for the requested date"),
            ):
                response = client.post(
                    "/api/agent/chat",
                    json={"message": "There is a shortage of paneer right now", "input_mode": "voice"},
                )
                assert response.status_code == 200
                data = response.json()
                assert "no active production plan" in data["reply"]
                assert data["intent"] == "report_shortage"
                assert data["tool_used"] == "propose_recovery"
                assert data["requires_confirmation"] is False
                assert data["confirm_phrases"] == []
                assert data["data"] is None

                # Verify converse received toolResult error
                assert mock_bedrock.converse.call_count == 2
                second_call_messages = mock_bedrock.converse.call_args_list[1][1]["messages"]
                tool_res = second_call_messages[-1]["content"][0]["toolResult"]
                assert tool_res["status"] == "error"
                assert "PLAN_NOT_FOUND" in tool_res["content"][0]["text"]
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_parallel_tool_calls_both_results_included_and_recovery_prioritized(
        self, client
    ):
        group_id = uuid4()
        act_id1 = uuid4()
        act_id2 = uuid4()

        mock_recovery_resp = RecoveryProposeResponse(
            group_id=group_id,
            shortage=RecoveryShortage(
                ingredient_id=uuid4(),
                name="Paneer",
                short_by=Decimal("1.5"),
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
                    action_id=act_id1,
                    option_number=1,
                    option_type="substitute",
                    title="Swap paneer for tofu",
                    status="pending",
                    needs_customer_consent=True,
                    impact=RecoveryImpact(
                        late_orders=0,
                        orders_protected=2,
                        revenue_at_risk_after=Decimal("0.00"),
                        extra_cost=Decimal("-50.00"),
                        margin_before_pct=Decimal("15.00"),
                        margin_after_pct=Decimal("17.00"),
                        customer_risk="low",
                        score=Decimal("0.90"),
                    ),
                    expires_at=datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc),
                ),
                RecoveryOption(
                    action_id=act_id2,
                    option_number=2,
                    option_type="emergency_purchase",
                    title="Buy locally",
                    status="pending",
                    needs_customer_consent=False,
                    impact=RecoveryImpact(
                        late_orders=0,
                        orders_protected=2,
                        revenue_at_risk_after=Decimal("0.00"),
                        extra_cost=Decimal("40.00"),
                        margin_before_pct=Decimal("15.00"),
                        margin_after_pct=Decimal("14.00"),
                        customer_risk="low",
                        score=Decimal("0.75"),
                    ),
                    expires_at=datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc),
                ),
            ],
        )

        # First converse returns parallel toolUse blocks: get_brief AND propose_recovery
        tool_call_result = _make_converse_result(
            text="Checking both the risk brief and shortage options for today.",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_brief_parallel_01",
                        "name": "get_brief",
                        "input": {"date": "2026-10-18"},
                    }
                },
                {
                    "toolUse": {
                        "toolUseId": "tool_recovery_parallel_02",
                        "name": "propose_recovery",
                        "input": {"ingredient_name": "Paneer"},
                    }
                },
            ],
            stop_reason="tool_use",
        )
        final_text_result = _make_converse_result(
            "Here is the recovery plan for Paneer. Option 1: Swap for tofu. Option 2: Buy locally. "
            "Say confirm option 1, or confirm option 2."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, final_text_result]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            with patch("app.ai.tools.propose_recovery", return_value=mock_recovery_resp):
                response = client.post(
                    "/api/agent/chat",
                    json={
                        "message": "We have a shortage of paneer and need the brief for today",
                        "input_mode": "text",
                    },
                )
                assert response.status_code == 200
                data = response.json()

                # Verify converse was called twice
                assert mock_bedrock.converse.call_count == 2

                # Verify round 2 messages includes toolResult for BOTH toolUseIds
                second_call_messages = mock_bedrock.converse.call_args_list[1][1]["messages"]
                assert len(second_call_messages) == 3
                user_tool_results = second_call_messages[2]["content"]
                assert len(user_tool_results) == 2

                result_map = {
                    item["toolResult"]["toolUseId"]: item["toolResult"]
                    for item in user_tool_results
                }
                assert "tool_brief_parallel_01" in result_map
                assert "tool_recovery_parallel_02" in result_map
                assert result_map["tool_brief_parallel_01"]["status"] == "success"
                assert result_map["tool_recovery_parallel_02"]["status"] == "success"

                # Verify recovery proposal remains primary response data over get_brief
                assert data["intent"] == "report_shortage"
                assert data["tool_used"] == "propose_recovery"
                assert data["requires_confirmation"] is True
                assert data["confirm_phrases"] == [
                    "confirm option 1",
                    "confirm option 2",
                ]
                assert data["data"]["group_id"] == str(group_id)
                assert data["data"]["option_action_ids"] == [str(act_id1), str(act_id2)]
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_parallel_tool_calls_one_tool_errors_other_succeeds(self, client):
        # Bedrock returns parallel calls: propose_recovery (fails) and get_brief (succeeds)
        tool_call_result = _make_converse_result(
            text="Checking shortage and daily brief.",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_rec_err_01",
                        "name": "propose_recovery",
                        "input": {"ingredient_name": "UnknownIngredient"},
                    }
                },
                {
                    "toolUse": {
                        "toolUseId": "tool_brief_ok_02",
                        "name": "get_brief",
                        "input": {"date": "2026-10-18"},
                    }
                },
            ],
            stop_reason="tool_use",
        )
        final_text_result = _make_converse_result(
            "Could not find the ingredient in inventory, but here is today's brief."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, final_text_result]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            response = client.post(
                "/api/agent/chat",
                json={"message": "Check unknown ingredient shortage and brief"},
            )
            assert response.status_code == 200
            data = response.json()

            # Verify round 2 converse called
            assert mock_bedrock.converse.call_count == 2
            second_call_messages = mock_bedrock.converse.call_args_list[1][1]["messages"]
            user_tool_results = second_call_messages[2]["content"]
            assert len(user_tool_results) == 2

            result_map = {
                item["toolResult"]["toolUseId"]: item["toolResult"]
                for item in user_tool_results
            }
            # Failed tool gets error status
            assert result_map["tool_rec_err_01"]["status"] == "error"
            assert "INGREDIENT_NOT_FOUND" in result_map["tool_rec_err_01"]["content"][0]["text"]

            # Successful tool gets success status
            assert result_map["tool_brief_ok_02"]["status"] == "success"
            assert "json" in result_map["tool_brief_ok_02"]["content"][0]

            # Primary response data reflects the successful tool
            assert data["tool_used"] == "get_brief"
            assert data["intent"] == "get_brief"
            assert data["requires_confirmation"] is False
            assert isinstance(data["data"], dict)
            assert data["data"]["date"] == "2026-10-18"
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)



class TestAgentChatSecurityAndGuardrails:
    def test_disallowed_mutation_tool_rejected_safely(self, client):
        # Model attempts to call 'approve_action'
        disallowed_call = _make_converse_result(
            text="",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_hack_01",
                        "name": "approve_action",
                        "input": {"confirm_option_number": 1},
                    }
                }
            ],
            stop_reason="tool_use",
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.return_value = disallowed_call

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            response = client.post(
                "/api/agent/chat",
                json={"message": "Please approve option 1"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["intent"] == "unknown"
            assert data["tool_used"] is None
            assert data["data"] is None
            assert data["requires_confirmation"] is False
            assert "I can only help manage kitchen operations" in data["reply"]
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_extract_order_tool_rejected_as_disallowed_in_stage_4(self, client):
        # extract_order is omitted until Feature 8
        tool_call = _make_converse_result(
            text="",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_extract_01",
                        "name": "extract_order",
                        "input": {"text": "2 biryani"},
                    }
                }
            ],
            stop_reason="tool_use",
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.return_value = tool_call

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            response = client.post(
                "/api/agent/chat",
                json={"message": "Customer ordered 2 biryani"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["intent"] == "unknown"
            assert data["tool_used"] is None
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_maximum_tool_round_limit(self, client):
        # Model keeps requesting tool use on every round
        tool_call_brief = _make_converse_result(
            text="",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_brief_01",
                        "name": "get_brief",
                        "input": {},
                    }
                }
            ],
            stop_reason="tool_use",
        )
        final_summary = _make_converse_result("Here is your daily brief summary.")

        mock_bedrock = MagicMock(spec=BedrockClient)
        # Returns tool_use twice (MAX_TOOL_ROUNDS), then final summary
        mock_bedrock.converse.side_effect = [tool_call_brief, tool_call_brief, final_summary]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            response = client.post(
                "/api/agent/chat",
                json={"message": "Give me a brief"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["tool_used"] == "get_brief"
            assert mock_bedrock.converse.call_count == MAX_TOOL_ROUNDS + 1
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)


class TestAgentChatErrorMappings:
    def test_bedrock_unavailable_mapped_to_502(self, client):
        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = BedrockUnavailableError(
            "AI service connection timed out or unreachable."
        )

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            response = client.post(
                "/api/agent/chat",
                json={"message": "Check orders"},
            )
            assert response.status_code == 502
            data = response.json()
            assert data["error"]["code"] == "AI_UNAVAILABLE"
            assert "AI service connection timed out" in data["error"]["message"]
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_bedrock_malformed_response_mapped_to_502(self, client):
        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = BedrockResponseError(
            "Malformed response from AI service: missing output."
        )

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            response = client.post(
                "/api/agent/chat",
                json={"message": "Check orders"},
            )
            assert response.status_code == 502
            data = response.json()
            assert data["error"]["code"] == "AI_UNAVAILABLE"
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)


class TestAgentChatMultiTurnContextAndRecoveryRouting:
    def test_multiturn_context_accumulates_details_across_turns(self, client):
        group_id = uuid4()
        act_id1 = uuid4()
        act_id2 = uuid4()

        mock_recovery_resp = RecoveryProposeResponse(
            group_id=group_id,
            shortage=RecoveryShortage(
                ingredient_id=uuid4(),
                name="Paneer",
                short_by=Decimal("2.0"),
                unit="kg",
            ),
            baseline=RecoveryBaseline(
                late_orders=4,
                revenue_at_risk=Decimal("1180.00"),
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
                    action_id=act_id1,
                    option_number=1,
                    option_type="substitute",
                    title="Swap paneer for tofu in 4 orders",
                    status="pending",
                    needs_customer_consent=True,
                    impact=RecoveryImpact(
                        late_orders=0,
                        orders_protected=4,
                        revenue_at_risk_after=Decimal("0.00"),
                        extra_cost=Decimal("-147.00"),
                        margin_before_pct=Decimal("15.00"),
                        margin_after_pct=Decimal("18.00"),
                        customer_risk="low",
                        score=Decimal("0.88"),
                    ),
                    expires_at=datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc),
                ),
                RecoveryOption(
                    action_id=act_id2,
                    option_number=2,
                    option_type="emergency_purchase",
                    title="Buy 2 kg paneer locally",
                    status="pending",
                    needs_customer_consent=False,
                    impact=RecoveryImpact(
                        late_orders=1,
                        orders_protected=3,
                        revenue_at_risk_after=Decimal("300.00"),
                        extra_cost=Decimal("120.00"),
                        margin_before_pct=Decimal("15.00"),
                        margin_after_pct=Decimal("13.00"),
                        customer_risk="low",
                        score=Decimal("0.70"),
                    ),
                    expires_at=datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc),
                ),
            ],
        )

        tool_call_result = _make_converse_result(
            text="Checking recovery options using paneer for today with 1 kg available on hand.",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_rec_multiturn_01",
                        "name": "propose_recovery",
                        "input": {
                            "ingredient_name": "Paneer",
                            "date": "today",
                            "reported_available_qty": 1.0,
                        },
                    }
                }
            ],
            stop_reason="tool_use",
        )
        final_text_result = _make_converse_result(
            "Paneer is short for today with 4 orders at risk. Option 1: Swap for tofu. Option 2: Buy 2 kg locally. "
            "Say confirm option 1, or confirm option 2."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, final_text_result]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            with patch("app.ai.tools.propose_recovery", return_value=mock_recovery_resp):
                # Turn 3: User specifies available quantity, while ingredient and date were in history
                response = client.post(
                    "/api/agent/chat",
                    json={
                        "message": "I currently have 1 kg and require 3 kg to complete the orders.",
                        "input_mode": "text",
                        "history": [
                            {
                                "role": "user",
                                "content": "There is a shortage of paneer.",
                            },
                            {
                                "role": "assistant",
                                "content": "What date is the shortage for and how much do you have on hand?",
                            },
                            {
                                "role": "user",
                                "content": "The shortage is for today, and I have four orders that use paneer.",
                            },
                            {
                                "role": "assistant",
                                "content": "Could you provide your current available inventory quantity?",
                            },
                        ],
                    },
                )
                assert response.status_code == 200
                data = response.json()

                # Verify Bedrock received multi-turn message sequence with strict user/assistant alternation
                assert mock_bedrock.converse.call_count == 2
                # In the 2-round tool conversation, messages list is appended in-place with toolUse and toolResult
                first_call_messages = mock_bedrock.converse.call_args_list[0][1]["messages"]
                assert len(first_call_messages) == 7
                assert [m["role"] for m in first_call_messages[:5]] == [
                    "user",
                    "assistant",
                    "user",
                    "assistant",
                    "user",
                ]
                assert first_call_messages[0]["content"][0]["text"] == "There is a shortage of paneer."
                assert "require 3 kg" in first_call_messages[4]["content"][0]["text"]
                assert first_call_messages[5]["role"] == "assistant"
                assert first_call_messages[6]["role"] == "user"

                # Verify proposal result was prioritized and confirmation phrases generated
                assert data["intent"] == "report_shortage"
                assert data["tool_used"] == "propose_recovery"
                assert data["requires_confirmation"] is True
                assert data["confirm_phrases"] == ["confirm option 1", "confirm option 2"]
                assert data["data"]["group_id"] == str(group_id)
                assert data["data"]["option_action_ids"] == [str(act_id1), str(act_id2)]
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_clean_daily_brief_does_not_negate_explicit_shortage(self, client):
        group_id = uuid4()
        act_id1 = uuid4()

        mock_recovery_resp = RecoveryProposeResponse(
            group_id=group_id,
            shortage=RecoveryShortage(
                ingredient_id=uuid4(),
                name="Paneer",
                short_by=Decimal("1.0"),
                unit="kg",
            ),
            baseline=RecoveryBaseline(
                late_orders=1,
                revenue_at_risk=Decimal("300.00"),
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
                    action_id=act_id1,
                    option_number=1,
                    option_type="emergency_purchase",
                    title="Buy 1 kg paneer locally",
                    status="pending",
                    needs_customer_consent=False,
                    impact=RecoveryImpact(
                        late_orders=0,
                        orders_protected=1,
                        revenue_at_risk_after=Decimal("0.00"),
                        extra_cost=Decimal("50.00"),
                        margin_before_pct=Decimal("15.00"),
                        margin_after_pct=Decimal("14.00"),
                        customer_risk="low",
                        score=Decimal("0.85"),
                    ),
                    expires_at=datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc),
                ),
            ],
        )

        # Model requests get_brief (which returns clean/empty shortages) AND propose_recovery
        tool_call_result = _make_converse_result(
            text="Checking daily brief and running recovery simulation.",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_brief_clean_01",
                        "name": "get_brief",
                        "input": {"date": "2026-10-18"},
                    }
                },
                {
                    "toolUse": {
                        "toolUseId": "tool_rec_shortage_02",
                        "name": "propose_recovery",
                        "input": {"ingredient_name": "Paneer"},
                    }
                },
            ],
            stop_reason="tool_use",
        )
        final_text_result = _make_converse_result(
            "Found recovery option 1: Buy 1 kg paneer locally. Say confirm option 1."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, final_text_result]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            with patch("app.ai.tools.propose_recovery", return_value=mock_recovery_resp):
                # Mock get_brief to return 0 shortages (clean brief)
                with patch(
                    "app.ai.tools.get_risk_brief",
                    return_value=MagicMock(
                        model_dump=lambda mode: {
                            "date": "2026-10-18",
                            "order_count": 5,
                            "shortages": [],
                            "at_risk_orders": [],
                            "revenue_at_risk": 0.0,
                        }
                    ),
                ):
                    response = client.post(
                        "/api/agent/chat",
                        json={"message": "There is a shortage of paneer for tomorrow."},
                    )
                    assert response.status_code == 200
                    data = response.json()

                    # propose_recovery must remain the primary tool despite clean brief
                    assert data["tool_used"] == "propose_recovery"
                    assert data["intent"] == "report_shortage"
                    assert data["requires_confirmation"] is True
                    assert data["confirm_phrases"] == ["confirm option 1"]
                    assert data["data"]["group_id"] == str(group_id)
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_missing_production_plan_produces_clear_explanation(self, client):
        tool_call_result = _make_converse_result(
            text="Checking recovery options.",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_rec_pnf_01",
                        "name": "propose_recovery",
                        "input": {"ingredient_name": "Paneer", "date": "today"},
                    }
                }
            ],
            stop_reason="tool_use",
        )
        final_text_result = _make_converse_result(
            "Generating recovery options requires an existing production plan for today. "
            "Please generate the daily plan through the Plan tab first."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, final_text_result]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            with patch(
                "app.ai.tools.propose_recovery",
                side_effect=AppError(404, "PLAN_NOT_FOUND", "No plan found for the requested date"),
            ):
                response = client.post(
                    "/api/agent/chat",
                    json={"message": "I have a shortage of paneer today"},
                )
                assert response.status_code == 200
                data = response.json()

                # Verify explanation is preserved truthfully without invented options
                assert "existing production plan" in data["reply"]
                assert data["intent"] == "report_shortage"
                assert data["tool_used"] == "propose_recovery"
                assert data["requires_confirmation"] is False
                assert data["confirm_phrases"] == []
                assert data["data"] is None
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_context_isolation_across_independent_requests(self, client):
        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.return_value = _make_converse_result("Acknowledged.")

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            # Request 1: Contains history about paneer shortage
            _ = client.post(
                "/api/agent/chat",
                json={
                    "message": "When can it arrive?",
                    "history": [
                        {"role": "user", "content": "We are short of paneer."},
                        {"role": "assistant", "content": "I can propose recovery options."},
                    ],
                },
            )
            req1_messages = mock_bedrock.converse.call_args_list[0][1]["messages"]
            assert len(req1_messages) == 3
            assert "paneer" in req1_messages[0]["content"][0]["text"].lower()

            # Request 2: Brand new independent request with no history
            _ = client.post(
                "/api/agent/chat",
                json={"message": "What dishes are active on the menu?"},
            )
            req2_messages = mock_bedrock.converse.call_args_list[1][1]["messages"]
            # Must only have 1 turn, zero history from Request 1
            assert len(req2_messages) == 1
            assert req2_messages[0]["content"][0]["text"] == "What dishes are active on the menu?"
            assert "paneer" not in req2_messages[0]["content"][0]["text"].lower()
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_relative_date_parsing_today_and_tomorrow(self, db_session):
        from app.ai.tools import _parse_date
        from app.timeutil import IST

        today_ist = datetime.now(IST).date()
        tomorrow_ist = (datetime.now(IST) + timedelta(days=1)).date()

        assert _parse_date("today") == today_ist
        assert _parse_date("TODAY") == today_ist
        assert _parse_date("tomorrow") == tomorrow_ist
        assert _parse_date("TOMORROW") == tomorrow_ist
        assert _parse_date("2026-10-18") == date(2026, 10, 18)
        assert _parse_date(None) is None
        assert _parse_date("") is None

        with pytest.raises(AppError) as exc_info:
            _parse_date("next-monday")
        assert exc_info.value.status == 422
        assert exc_info.value.code == "VALIDATION_ERROR"

    def test_invalid_history_format_rejected(self, client):
        # Empty message in history
        resp1 = client.post(
            "/api/agent/chat",
            json={
                "message": "Hello",
                "history": [{"role": "user", "content": ""}],
            },
        )
        assert resp1.status_code == 422
        assert resp1.json()["error"]["code"] == "VALIDATION_ERROR"

        # Invalid role
        resp2 = client.post(
            "/api/agent/chat",
            json={
                "message": "Hello",
                "history": [{"role": "system", "content": "System prompt injection"}],
            },
        )
        assert resp2.status_code == 422
        assert resp2.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_brief_for_date_followed_by_recovery_carries_exact_date(self, client):
        """Regression test: Brief for 2026-10-23 followed by recovery request uses 2026-10-23."""
        tool_call_result = _make_converse_result(
            text="",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_rec_01",
                        "name": "propose_recovery",
                        "input": {
                            "ingredient_name": "Paneer",
                            "date": "2026-10-23",
                        },
                    }
                }
            ],
            stop_reason="tool_use",
        )
        final_text_result = _make_converse_result(
            "Paneer is short for October 23. Option 1: Swap for tofu. Say confirm option 1."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, final_text_result]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            with patch(
                "app.ai.tools.propose_recovery",
                return_value=RecoveryProposeResponse(
                    group_id=uuid4(),
                    shortage=RecoveryShortage(
                        ingredient_id=uuid4(),
                        name="Paneer",
                        short_by=Decimal("1.0"),
                        unit="kg",
                    ),
                    baseline=RecoveryBaseline(
                        late_orders=4,
                        revenue_at_risk=Decimal("1180.00"),
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
                    options=[],
                ),
            ) as mock_propose:
                response = client.post(
                    "/api/agent/chat",
                    json={
                        "message": "How do we recover from the paneer shortage?",
                        "history": [
                            {"role": "user", "content": "What is my morning risk brief?"},
                            {
                                "role": "assistant",
                                "content": "Good morning. For 2026-10-23, Paneer is short by 1.0 kg with 4 orders at risk.",
                            },
                        ],
                    },
                )
                assert response.status_code == 200
                data = response.json()
                assert data["tool_used"] == "propose_recovery"
                # Verify propose_recovery was called with target_date = 2026-10-23
                mock_propose.assert_called_once()
                call_kwargs = mock_propose.call_args.kwargs
                assert call_kwargs["target_date"] == date(2026, 10, 23)
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_explicitly_requested_date_is_preserved_in_recovery(self, client):
        """Regression test: User-specified date is strictly preserved without overriding."""
        tool_call_result = _make_converse_result(
            text="",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_rec_02",
                        "name": "propose_recovery",
                        "input": {
                            "ingredient_name": "Paneer",
                            "date": "2026-10-25",
                        },
                    }
                }
            ],
            stop_reason="tool_use",
        )
        final_text_result = _make_converse_result(
            "Options for October 25 have been prepared."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, final_text_result]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            with patch(
                "app.ai.tools.propose_recovery",
                return_value=RecoveryProposeResponse(
                    group_id=uuid4(),
                    shortage=RecoveryShortage(
                        ingredient_id=uuid4(),
                        name="Paneer",
                        short_by=Decimal("1.0"),
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
                    options=[],
                ),
            ) as mock_propose:
                response = client.post(
                    "/api/agent/chat",
                    json={
                        "message": "We have a paneer shortage on 2026-10-25",
                    },
                )
                assert response.status_code == 200
                mock_propose.assert_called_once()
                assert mock_propose.call_args.kwargs["target_date"] == date(2026, 10, 25)
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)

    def test_missing_production_plan_for_genuinely_requested_date_returns_structured_error(self, client):
        """Regression test: Genuinely missing production plan returns PLAN_NOT_FOUND structured error."""
        tool_call_result = _make_converse_result(
            text="",
            content=[
                {
                    "toolUse": {
                        "toolUseId": "tool_rec_03",
                        "name": "propose_recovery",
                        "input": {
                            "ingredient_name": "Paneer",
                            "date": "2026-10-22",
                        },
                    }
                }
            ],
            stop_reason="tool_use",
        )
        final_text_result = _make_converse_result(
            "There's no production plan for 2026-10-22 in the system. Please generate the daily plan through the Plan tab first."
        )

        mock_bedrock = MagicMock(spec=BedrockClient)
        mock_bedrock.converse.side_effect = [tool_call_result, final_text_result]

        app.dependency_overrides[get_bedrock_client] = lambda: mock_bedrock
        try:
            with patch(
                "app.ai.tools.propose_recovery",
                side_effect=AppError(
                    404,
                    "PLAN_NOT_FOUND",
                    "No plan found for the requested date",
                    {"date": "2026-10-22"},
                ),
            ):
                response = client.post(
                    "/api/agent/chat",
                    json={
                        "message": "Fix the paneer shortage on 2026-10-22",
                    },
                )
                assert response.status_code == 200
                data = response.json()
                assert data["intent"] == "report_shortage"
                assert data["tool_used"] == "propose_recovery"
                assert data["data"] is None
                assert "existing production plan" in data["reply"] or "no production plan" in data["reply"].lower()
                assert data["requires_confirmation"] is False
        finally:
            app.dependency_overrides.pop(get_bedrock_client, None)
