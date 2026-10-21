"""Bedrock Converse chat orchestration service.

Handles multi-turn tool calling with Amazon Bedrock, ensuring only read-and-propose
tools are executed, enforcing strict bounds on tool rounds, and formatting responses
to match the AgentChatResponse schema and frontend AgentChatResponseDTO.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.ai.bedrock import BedrockClient
from app.ai.prompts import CHAT_AGENT_SYSTEM_PROMPT
from app.ai.tools import ALLOWED_TOOLS, dispatch_tool, get_tool_config
from app.errors import AppError
from app.schemas import AgentChatResponse, ChatHistoryMessage

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 2


def _build_response(
    reply: str,
    tool_used: str | None,
    tool_result_data: dict[str, Any] | None,
) -> AgentChatResponse:
    """Builds an AgentChatResponse from the final text reply and tool execution results."""
    clean_reply = reply.strip() if reply else ""
    if not clean_reply:
        clean_reply = "I'm here to help manage kitchen operations, shortages, and margins."

    intent = "unknown"
    if tool_used == "get_brief":
        intent = "get_brief"
    elif tool_used == "propose_recovery":
        intent = "report_shortage"
    elif tool_used == "analyze_price":
        intent = "analyze_price"

    requires_confirmation = False
    confirm_phrases: list[str] = []
    response_data: dict[str, Any] | None = None

    if tool_used == "propose_recovery" and tool_result_data and tool_result_data.get("options"):
        requires_confirmation = True
        group_id = tool_result_data.get("group_id")
        option_action_ids = tool_result_data.get("option_action_ids", [])
        response_data = {
            "group_id": str(group_id) if group_id else None,
            "option_action_ids": option_action_ids,
        }
        options = tool_result_data.get("options", [])
        confirm_phrases = [
            f"confirm option {opt.get('option_number', idx + 1)}"
            for idx, opt in enumerate(options)
        ]
    elif tool_result_data is not None:
        response_data = tool_result_data

    return AgentChatResponse(
        reply=clean_reply,
        intent=intent,
        tool_used=tool_used,
        data=response_data,
        requires_confirmation=requires_confirmation,
        confirm_phrases=confirm_phrases,
    )


def _should_update_primary_tool(
    current_tool: str | None,
    current_data: dict[str, Any] | None,
    new_tool: str,
    new_data: dict[str, Any] | None,
) -> bool:
    """Determines whether new_tool should supersede current_tool as the primary response tool.

    Priority:
    1. propose_recovery with active recovery options (highest: actionable proposal requiring user confirmation).
    2. Any tool producing valid result data over a tool with no data / an error.
    3. propose_recovery over get_brief / analyze_price when neither has active options.
    4. First tool evaluated if current_tool is None.
    """
    if current_tool is None:
        return True

    # Never overwrite a propose_recovery that produced active confirmation options
    if current_tool == "propose_recovery" and current_data and current_data.get("options"):
        return False

    # A propose_recovery with options always supersedes any other tool
    if new_tool == "propose_recovery" and new_data and new_data.get("options"):
        return True

    # If current tool produced no data (e.g. error) but new tool produced valid data, supersede
    if current_data is None and new_data is not None:
        return True

    # If new tool is propose_recovery and current tool does not have active options, prioritize recovery
    if new_tool == "propose_recovery" and current_tool != "propose_recovery":
        return True

    return False


def _build_bedrock_messages(
    history: list[ChatHistoryMessage] | None,
    current_message: str,
) -> list[dict[str, Any]]:
    """Constructs a normalized, compliant Bedrock Converse messages list.

    Enforces Bedrock Converse API invariants:
    - Starts with 'user'.
    - Strictly alternates between 'user' and 'assistant'.
    - Merges consecutive turns of the same role if present.
    - Ends with the current user message (role 'user').
    - Bounds history to recent turns to avoid token overflow.
    """
    cleaned: list[dict[str, Any]] = []

    if history:
        for item in history[-10:]:
            text = item.content.strip() if item.content else ""
            if not text:
                continue
            role = item.role
            # Bedrock conversation must start with 'user'
            if not cleaned and role != "user":
                continue
            # Merge consecutive messages of the same role
            if cleaned and cleaned[-1]["role"] == role:
                prev = cleaned[-1]["content"][0]["text"]
                cleaned[-1]["content"] = [{"text": f"{prev}\n{text}"}]
            else:
                cleaned.append({"role": role, "content": [{"text": text}]})

        # Bedrock requires that the user message being answered follows an assistant turn
        # If the history ended on a user turn, merge it into the current message
        if cleaned and cleaned[-1]["role"] == "user":
            prev_user_text = cleaned.pop()["content"][0]["text"]
            current_message = f"{prev_user_text}\n{current_message}"

    cleaned.append({"role": "user", "content": [{"text": current_message}]})
    return cleaned


def orchestrate_chat(
    db: Session,
    bedrock: BedrockClient,
    message: str,
    input_mode: str | None = None,
    history: list[ChatHistoryMessage] | None = None,
) -> AgentChatResponse:
    """Orchestrates a chat interaction with Bedrock using tool-use mechanism.

    Args:
        db: Active SQLAlchemy database session.
        bedrock: Configured BedrockClient instance.
        message: Validated user input message.
        input_mode: Optional 'voice' or 'text' mode.
        history: Optional list of previous conversation turns.

    Returns:
        AgentChatResponse matching Rest_API_Spec.md §3.16.

    Raises:
        BedrockUnavailableError: If Bedrock is unreachable or credentials fail (mapped to 502).
        BedrockResponseError: If Bedrock returns a malformed payload (mapped to 502).
    """
    messages = _build_bedrock_messages(history, message)
    system = [{"text": CHAT_AGENT_SYSTEM_PROMPT}]
    tool_config = get_tool_config()

    tool_used: str | None = None
    tool_result_data: dict[str, Any] | None = None

    for _round in range(MAX_TOOL_ROUNDS):
        result = bedrock.converse(
            messages=messages,
            system=system,
            tool_config=tool_config,
        )

        # Collect every toolUse block in the model response content
        tool_use_blocks = [
            block["toolUse"]
            for block in result.content
            if isinstance(block, dict) and "toolUse" in block
        ]

        if not tool_use_blocks:
            # Model responded with final text without requesting tools
            return _build_response(
                reply=result.text,
                tool_used=tool_used,
                tool_result_data=tool_result_data,
            )

        # Safety guardrail: Never allow mutations, approvals, or unapproved tools
        disallowed = [
            tu.get("name", "")
            for tu in tool_use_blocks
            if tu.get("name", "") not in ALLOWED_TOOLS
        ]
        if disallowed:
            logger.warning("Disallowed tool(s) requested by model: %s", disallowed)
            return AgentChatResponse(
                reply=(
                    "I can only help manage kitchen operations, inventory shortages, "
                    "pricing analysis, and incoming order intake. Would you like me to "
                    "check today's risk brief or report an ingredient shortage?"
                ),
                intent="unknown",
                tool_used=None,
                data=None,
                requires_confirmation=False,
                confirm_phrases=[],
            )

        tool_result_content: list[dict[str, Any]] = []
        for tu in tool_use_blocks:
            tool_name = tu.get("name", "")
            tool_use_id = tu.get("toolUseId", "")
            tool_input = tu.get("input", {})

            current_result: dict[str, Any] | None = None
            try:
                current_result = dispatch_tool(tool_name, tool_input, db)
                tool_result_content.append(
                    {
                        "toolResult": {
                            "toolUseId": tool_use_id,
                            "status": "success",
                            "content": [{"json": current_result}],
                        }
                    }
                )
            except AppError as exc:
                logger.info("Tool %s returned application error: %s", tool_name, exc.code)
                tool_result_content.append(
                    {
                        "toolResult": {
                            "toolUseId": tool_use_id,
                            "status": "error",
                            "content": [{"text": f"Error ({exc.code}): {exc.message}"}],
                        }
                    }
                )
            except Exception as exc:
                logger.error("Unexpected error executing tool %s: %s", tool_name, type(exc).__name__)
                tool_result_content.append(
                    {
                        "toolResult": {
                            "toolUseId": tool_use_id,
                            "status": "error",
                            "content": [{"text": "Tool execution encountered an internal error."}],
                        }
                    }
                )

            # Update primary response tool tracking
            if current_result is not None:
                if _should_update_primary_tool(
                    tool_used,
                    tool_result_data,
                    tool_name,
                    current_result,
                ):
                    tool_used = tool_name
                    tool_result_data = current_result
            elif tool_used is None:
                tool_used = tool_name

        # Append assistant turn and complete user toolResult turn
        messages.append(result.message)
        messages.append({"role": "user", "content": tool_result_content})


    # If maximum tool rounds reached, query model for final summary or build fallback
    try:
        final_result = bedrock.converse(
            messages=messages,
            system=system,
            tool_config=tool_config,
        )
        final_reply = final_result.text
    except Exception:
        final_reply = "Here are the results from your kitchen."

    return _build_response(
        reply=final_reply,
        tool_used=tool_used,
        tool_result_data=tool_result_data,
    )
