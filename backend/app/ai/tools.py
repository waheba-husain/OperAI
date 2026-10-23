"""Tool registry and execution layer for Amazon Bedrock Converse API.

Exposes only read-and-propose tools:
1. get_brief: Read daily risk brief.
2. propose_recovery: Generate and store scored recovery options (pending).
3. analyze_price: Perform pricing and margin analysis.
4. extract_order: Extract order from text (Feature 8 contract).

Strictly enforces read-and-propose only: approvals, rejections, and execution
are never exposed to the LLM and must go through POST /api/actions/{id}/approve.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
import logging
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import Ingredient, MenuItem
from app.services.kitchen import get_kitchen
from app.services.orders import extract_order
from app.services.pricing_analysis import analyze_price
from app.services.recovery import propose_recovery
from app.services.risk import get_risk_brief
from app.timeutil import IST

logger = logging.getLogger(__name__)

ALLOWED_TOOLS = {
    "get_brief",
    "propose_recovery",
    "analyze_price",
    "extract_order",
}



# Tool Input Schemas


class GetBriefInput(BaseModel):
    date: str | None = None


class ProposeRecoveryInput(BaseModel):
    ingredient_name: str | None = None
    ingredient_id: str | None = None
    date: str | None = None
    reported_available_qty: float | Decimal | None = None


class AnalyzePriceInput(BaseModel):
    menu_item_name: str | None = None
    menu_item_id: str | None = None
    price: float | Decimal | None = None


class ExtractOrderInput(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


# Bedrock Converse API Tool Specifications


BEDROCK_TOOLS: list[dict[str, Any]] = [
    {
        "toolSpec": {
            "name": "get_brief",
            "description": (
                "Get the proactive daily risk brief showing ingredient shortages, "
                "at-risk customer orders, and revenue exposure for a given date."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "date": {
                            "type": "string",
                            "description": (
                                "Target date in YYYY-MM-DD format. "
                                "Defaults to tomorrow in IST if omitted."
                            ),
                        }
                    },
                    "required": [],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "propose_recovery",
            "description": (
                "Generate and propose scored recovery options (substitute, dish swap, "
                "emergency purchase, delay notify, partial) for an ingredient shortage. "
                "Creates pending proposals that require owner approval."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "ingredient_name": {
                            "type": "string",
                            "description": "Name of the short ingredient (e.g. 'Paneer', 'Tofu').",
                        },
                        "ingredient_id": {
                            "type": "string",
                            "description": "UUID of the short ingredient.",
                        },
                        "date": {
                            "type": "string",
                            "description": (
                                "Operational date of shortage in YYYY-MM-DD format (must match the "
                                "operational date from get_brief or the conversation). "
                                "Defaults to tomorrow in IST if omitted."
                            ),
                        },
                        "reported_available_qty": {
                            "type": "number",
                            "description": "Optional physical stock quantity remaining on hand.",
                        },
                    },
                    "required": [],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "analyze_price",
            "description": (
                "Analyze dish margins, unit costs, and compute a suggested price "
                "to meet the kitchen's target profit margin."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "menu_item_name": {
                            "type": "string",
                            "description": "Name of the dish/menu item (e.g. 'Paneer Biryani').",
                        },
                        "menu_item_id": {
                            "type": "string",
                            "description": "UUID of the dish/menu item.",
                        },
                        "price": {
                            "type": "number",
                            "description": "Optional what-if price in INR to evaluate margins for.",
                        },
                    },
                    "required": [],
                }
            },
        }
    },
]

EXTRACT_ORDER_SPEC: dict[str, Any] = {
    "toolSpec": {
        "name": "extract_order",
        "description": (
            "Extract customer details, items, quantities, and deadlines from "
            "raw message text into a pending order intake proposal."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Raw customer message text (1-2000 characters).",
                    }
                },
                "required": ["text"],
            }
        },
    }
}


def get_tool_specs() -> list[dict[str, Any]]:
    """Returns the list of Bedrock Converse API tool specifications."""
    return [*BEDROCK_TOOLS, EXTRACT_ORDER_SPEC]


def get_tool_config() -> dict[str, Any]:
    """Returns the complete toolConfig dictionary for Bedrock Converse API calls."""
    return {"tools": get_tool_specs()}


def get_openai_tool_declarations() -> list[dict[str, Any]]:
    """Converts tool specs to OpenAI/Groq function-tool declarations format."""
    declarations = []
    for spec in BEDROCK_TOOLS:
        ts = spec["toolSpec"]
        input_schema = ts["inputSchema"]["json"]
        declarations.append({
            "type": "function",
            "function": {
                "name": ts["name"],
                "description": ts["description"],
                "parameters": input_schema,
            },
        })
    return declarations


get_groq_tool_declarations = get_openai_tool_declarations


def get_gemini_tool_declarations() -> list[dict[str, Any]]:
    """Converts tool specs to Gemini function declarations format."""
    declarations = []
    for spec in get_tool_specs():
        ts = spec["toolSpec"]
        input_schema = ts["inputSchema"]["json"]
        props: dict[str, Any] = {}
        for prop_name, prop_def in input_schema.get("properties", {}).items():
            t = prop_def.get("type", "string").upper()
            props[prop_name] = {
                "type": t,
                "description": prop_def.get("description", ""),
            }
        declarations.append({
            "name": ts["name"],
            "description": ts["description"],
            "parameters": {
                "type": "OBJECT",
                "properties": props,
                "required": input_schema.get("required", []),
            },
        })
    return declarations


def _parse_date(date_str: str | None) -> date | None:
    if date_str is None or not date_str.strip():
        return None
    val = date_str.strip().lower()
    if val == "today":
        return datetime.now(IST).date()
    if val == "tomorrow":
        return (datetime.now(IST) + timedelta(days=1)).date()
    try:
        return date.fromisoformat(date_str.strip())
    except ValueError as exc:
        raise AppError(
            422,
            "VALIDATION_ERROR",
            f"Invalid date format: '{date_str}'. Expected YYYY-MM-DD.",
            {"date": date_str},
        ) from exc


def _handle_get_brief(input_data: dict[str, Any], db: Session) -> dict[str, Any]:
    try:
        parsed_input = GetBriefInput(**input_data)
    except ValidationError as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc)) from exc

    target_date = _parse_date(parsed_input.date)
    brief = get_risk_brief(db, target_date=target_date)
    return brief.model_dump(mode="json")


def _handle_propose_recovery(input_data: dict[str, Any], db: Session) -> dict[str, Any]:
    try:
        parsed_input = ProposeRecoveryInput(**input_data)
    except ValidationError as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc)) from exc

    kitchen = get_kitchen(db)
    target_date = _parse_date(parsed_input.date)
    if target_date is None:
        target_date = (datetime.now(IST) + timedelta(days=1)).date()

    resolved_ingredient_id: UUID | None = None
    if parsed_input.ingredient_id:
        try:
            resolved_ingredient_id = UUID(str(parsed_input.ingredient_id))
        except ValueError as exc:
            raise AppError(
                422,
                "VALIDATION_ERROR",
                f"Invalid UUID for ingredient_id: '{parsed_input.ingredient_id}'",
            ) from exc
    elif parsed_input.ingredient_name and parsed_input.ingredient_name.strip():
        name_clean = parsed_input.ingredient_name.strip().strip(".,!?:;\"'")
        ing = db.scalar(
            select(Ingredient).where(
                Ingredient.kitchen_id == kitchen.id,
                func.lower(Ingredient.name) == name_clean.lower(),
            )
        )
        if ing is None and name_clean:
            lower = name_clean.lower()
            candidates: list[str] = []
            if lower.endswith("es"):
                candidates.append(name_clean[:-2])
            if lower.endswith("s"):
                candidates.append(name_clean[:-1])
            else:
                candidates.extend([name_clean + "s", name_clean + "es"])
            for cand in candidates:
                ing = db.scalar(
                    select(Ingredient).where(
                        Ingredient.kitchen_id == kitchen.id,
                        func.lower(Ingredient.name) == cand.lower(),
                    )
                )
                if ing is not None:
                    break

        if ing is None:
            raise AppError(
                404,
                "INGREDIENT_NOT_FOUND",
                f"Ingredient '{name_clean}' not found",
                {"ingredient_name": name_clean},
            )
        resolved_ingredient_id = ing.id
    else:
        raise AppError(
            422,
            "VALIDATION_ERROR",
            "Either ingredient_name or ingredient_id must be provided",
        )

    qty_decimal: Decimal | None = None
    if parsed_input.reported_available_qty is not None:
        qty_decimal = Decimal(str(parsed_input.reported_available_qty))
        if qty_decimal < Decimal("0"):
            raise AppError(
                422,
                "VALIDATION_ERROR",
                "reported_available_qty must be nonnegative",
            )

    result = propose_recovery(
        db,
        target_date=target_date,
        ingredient_id=resolved_ingredient_id,
        reported_available_qty=qty_decimal,
    )
    db.commit()

    output = result.model_dump(mode="json")
    output["option_action_ids"] = [str(opt.action_id) for opt in result.options]
    return output


def _handle_analyze_price(input_data: dict[str, Any], db: Session) -> dict[str, Any]:
    try:
        parsed_input = AnalyzePriceInput(**input_data)
    except ValidationError as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc)) from exc

    kitchen = get_kitchen(db)
    resolved_item_id: UUID | None = None

    if parsed_input.menu_item_id:
        try:
            resolved_item_id = UUID(str(parsed_input.menu_item_id))
        except ValueError as exc:
            raise AppError(
                422,
                "VALIDATION_ERROR",
                f"Invalid UUID for menu_item_id: '{parsed_input.menu_item_id}'",
            ) from exc
    elif parsed_input.menu_item_name and parsed_input.menu_item_name.strip():
        name_clean = parsed_input.menu_item_name.strip().strip(".,!?:;\"'")
        item = db.scalar(
            select(MenuItem).where(
                MenuItem.kitchen_id == kitchen.id,
                func.lower(MenuItem.name) == name_clean.lower(),
            )
        )
        if item is None:
            raise AppError(
                404,
                "MENU_ITEM_NOT_FOUND",
                f"Menu item '{name_clean}' not found",
                {"menu_item_name": name_clean},
            )
        resolved_item_id = item.id
    else:
        raise AppError(
            422,
            "VALIDATION_ERROR",
            "Either menu_item_name or menu_item_id must be provided",
        )

    price_decimal: Decimal | None = None
    if parsed_input.price is not None:
        price_decimal = Decimal(str(parsed_input.price))
        if price_decimal <= Decimal("0"):
            raise AppError(422, "VALIDATION_ERROR", "price must be greater than 0")

    result = analyze_price(db, menu_item_id=resolved_item_id, price=price_decimal)
    if "menu_item_id" in result and isinstance(result["menu_item_id"], UUID):
        result["menu_item_id"] = str(result["menu_item_id"])
    return result


def _handle_extract_order(input_data: dict[str, Any], db: Session) -> dict[str, Any]:
    try:
        parsed_input = ExtractOrderInput(**input_data)
    except ValidationError as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc)) from exc

    result, created = extract_order(db, parsed_input.text)
    if created:
        db.commit()
    output = result.model_dump(mode="json")
    action = output.get("action")
    if action:
        output["option_action_ids"] = [action["id"]]
    return output


def dispatch_tool(name: str, input_params: dict[str, Any], db: Session) -> dict[str, Any]:
    """Dispatches a read-and-propose tool invocation.

    Enforces that only permitted read/propose tools can be called. Approval and rejection
    operations are strictly disallowed.

    Args:
        name: Tool name (e.g. 'get_brief', 'propose_recovery', 'analyze_price', 'extract_order').
        input_params: Input parameters dictionary matching the tool's input schema.
        db: Active SQLAlchemy Session.

    Returns:
        Structured, serializable result dictionary.

    Raises:
        AppError: On unknown tool, unauthorized mutation attempt, validation failure,
                  or service error.
    """
    if name not in ALLOWED_TOOLS:
        logger.warning("Attempted to invoke disallowed or unknown tool: %s", name)
        raise AppError(
            400,
            "DISALLOWED_TOOL",
            f"Tool '{name}' is not allowed. Only read-and-propose tools are supported.",
        )

    if name == "get_brief":
        return _handle_get_brief(input_params, db)
    elif name == "propose_recovery":
        return _handle_propose_recovery(input_params, db)
    elif name == "analyze_price":
        return _handle_analyze_price(input_params, db)
    elif name == "extract_order":
        return _handle_extract_order(input_params, db)

    raise AppError(400, "DISALLOWED_TOOL", f"Tool '{name}' is not supported.")


def execute_tool_for_converse(
    tool_use_id: str,
    name: str,
    input_params: dict[str, Any],
    db: Session,
) -> dict[str, Any]:
    """Executes a tool and packages the result into the Bedrock Converse toolResult block."""
    try:
        result = dispatch_tool(name, input_params, db)
        return {
            "toolResult": {
                "toolUseId": tool_use_id,
                "status": "success",
                "content": [{"json": result}],
            }
        }
    except AppError as exc:
        logger.info("Tool execution '%s' returned AppError: %s", name, exc.code)
        return {
            "toolResult": {
                "toolUseId": tool_use_id,
                "status": "error",
                "content": [{"text": f"Error ({exc.code}): {exc.message}"}],
            }
        }
    except Exception as exc:
        logger.error("Unexpected error in tool '%s': %s", name, type(exc).__name__)
        return {
            "toolResult": {
                "toolUseId": tool_use_id,
                "status": "error",
                "content": [{"text": "Internal error executing tool."}],
            }
        }
