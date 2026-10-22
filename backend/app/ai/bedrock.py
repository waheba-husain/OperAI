"""Amazon Bedrock Runtime client abstraction for OperAI.

Provides a thin, testable wrapper around the Bedrock Runtime Converse API
with structured error handling, lazy client initialization, and sanitized logging.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any

import boto3
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    ConnectionClosedError,
    ConnectTimeoutError,
    CredentialRetrievalError,
    EndpointConnectionError,
    NoCredentialsError,
    PartialCredentialsError,
    ReadTimeoutError,
)
from uuid import uuid4
import httpx

from app.config import settings
from app.errors import AppError
from app.ai.tools import get_gemini_tool_declarations

logger = logging.getLogger(__name__)


class BedrockError(AppError):
    """Base exception for Bedrock AI layer errors.

    Translates to HTTP 502 with code AI_UNAVAILABLE via FastAPI's AppError handler.
    """

    def __init__(
        self,
        message: str = "AI service is currently unavailable.",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            status=502,
            code="AI_UNAVAILABLE",
            message=message,
            details=details if details is not None else {},
        )


class BedrockUnavailableError(BedrockError):
    """Raised when Bedrock cannot be reached or credentials/connection fail."""

    pass


class BedrockResponseError(BedrockError):
    """Raised when Bedrock returns a malformed or unparseable response."""

    pass


@dataclass
class ConverseResult:
    """Structured result from a Bedrock Converse invocation."""

    message: dict[str, Any]
    content: list[dict[str, Any]]
    text: str
    stop_reason: str | None
    usage: dict[str, Any] | None
    raw_response: dict[str, Any]


def parse_converse_response(response: Any) -> ConverseResult:
    """Parses and validates a Bedrock Runtime Converse API response.

    Expected Bedrock Converse response contract:
    {
        "output": {
            "message": {
                "role": "assistant",
                "content": [{"text": "..."}, ...]
            }
        },
        "stopReason": "end_turn",
        "usage": {"inputTokens": ..., "outputTokens": ..., "totalTokens": ...}
    }

    Raises:
        BedrockResponseError: If the response is missing required keys or has invalid structure.
    """
    if not isinstance(response, dict):
        logger.error("Malformed Bedrock response: root is not a dict")
        raise BedrockResponseError("Malformed response from AI service.")

    output = response.get("output")
    if not isinstance(output, dict):
        logger.error("Malformed Bedrock response: missing or invalid 'output'")
        raise BedrockResponseError("Malformed response from AI service: missing output.")

    message = output.get("message")
    if not isinstance(message, dict):
        logger.error("Malformed Bedrock response: missing or invalid 'message'")
        raise BedrockResponseError("Malformed response from AI service: missing message.")

    content = message.get("content")
    if not isinstance(content, list):
        logger.error("Malformed Bedrock response: missing or invalid 'content'")
        raise BedrockResponseError("Malformed response from AI service: missing content.")

    text_parts: list[str] = []
    for block in content:
        if isinstance(block, dict) and "text" in block and isinstance(block["text"], str):
            text_parts.append(block["text"])

    stop_reason = response.get("stopReason")
    if stop_reason is not None and not isinstance(stop_reason, str):
        logger.error("Malformed Bedrock response: stopReason is not a string")
        raise BedrockResponseError("Malformed response from AI service: invalid stopReason.")

    usage = response.get("usage")
    if usage is not None and not isinstance(usage, dict):
        logger.error("Malformed Bedrock response: usage is not a dict")
        raise BedrockResponseError("Malformed response from AI service: invalid usage.")

    return ConverseResult(
        message=message,
        content=content,
        text="".join(text_parts),
        stop_reason=stop_reason,
        usage=usage,
        raw_response=response,
    )


class BedrockClient:
    """AI Runtime client supporting Gemini REST API with backward compatibility."""

    def __init__(
        self,
        model_id: str | None = None,
        region_name: str | None = None,
        client: Any = None,
        api_key: str | None = None,
    ) -> None:
        self._client = client
        if api_key is not None:
            self.api_key = api_key
        elif client is not None:
            self.api_key = ""
        else:
            self.api_key = settings.gemini_api_key

        self.model_id = model_id or settings.bedrock_model_id
        self.gemini_model_id = settings.gemini_model_id
        self.region_name = region_name or settings.aws_region

    @property
    def client(self) -> Any:
        """Returns injected client if present, or initializes Boto3 as fallback."""
        if self._client is None:
            try:
                self._client = boto3.client(
                    "bedrock-runtime",
                    region_name=self.region_name,
                )
            except (BotoCoreError, ClientError) as exc:
                logger.error(
                    "Failed to initialize Bedrock Runtime client: %s",
                    type(exc).__name__,
                )
                raise BedrockUnavailableError("AI service initialization failed.") from exc
        return self._client

    def converse(
        self,
        messages: list[dict[str, Any]],
        system: list[dict[str, Any]] | None = None,
        inference_config: dict[str, Any] | None = None,
        tool_config: dict[str, Any] | None = None,
        additional_model_request_fields: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> ConverseResult:
        """Invokes the AI model (Gemini REST API or injected client).

        Args:
            messages: List of message objects conforming to Converse API schema.
            system: Optional system prompt blocks [{"text": "..."}].
            inference_config: Optional inference parameters.
            tool_config: Optional tool configuration.
            additional_model_request_fields: Optional model-specific parameters.
            **kwargs: Additional parameters.

        Returns:
            ConverseResult with message, content, text, stop_reason, usage, and raw response.
        """
        if not messages:
            raise ValueError("messages must be a non-empty list")

        # 1. If an explicit client (e.g. test mock) was injected, use it directly
        if self._client is not None:
            params: dict[str, Any] = {
                "modelId": self.model_id,
                "messages": messages,
            }
            if system is not None:
                params["system"] = system
            if inference_config is not None:
                params["inferenceConfig"] = inference_config
            if tool_config is not None:
                params["toolConfig"] = tool_config
            if additional_model_request_fields is not None:
                params["additionalModelRequestFields"] = additional_model_request_fields
            params.update(kwargs)

            try:
                raw_response = self.client.converse(**params)
            except (
                NoCredentialsError,
                PartialCredentialsError,
                CredentialRetrievalError,
            ) as exc:
                logger.error("Bedrock credentials missing or incomplete")
                raise BedrockUnavailableError(
                    "AI credentials are not configured or incomplete."
                ) from exc
            except (
                ConnectTimeoutError,
                ReadTimeoutError,
                EndpointConnectionError,
                ConnectionClosedError,
            ) as exc:
                logger.error("Bedrock connection/timeout error: %s", type(exc).__name__)
                raise BedrockUnavailableError(
                    "AI service connection timed out or unreachable."
                ) from exc
            except ClientError as exc:
                error_dict = exc.response.get("Error", {}) if isinstance(exc.response, dict) else {}
                error_code = error_dict.get("Code", "ClientError")
                error_message = error_dict.get("Message", "")
                if error_message:
                    logger.error("Bedrock ClientError encountered: %s - %s", error_code, error_message)
                else:
                    logger.error("Bedrock ClientError encountered: %s", error_code)
                raise BedrockUnavailableError(
                    f"AI service returned an error ({error_code})."
                ) from exc
            except BotoCoreError as exc:
                logger.error("Bedrock BotoCoreError: %s", type(exc).__name__)
                raise BedrockUnavailableError(
                    "AI service error during model invocation."
                ) from exc
            except Exception as exc:
                if isinstance(exc, BedrockError):
                    raise
                logger.error("Unexpected error invoking Bedrock: %s", type(exc).__name__)
                raise BedrockUnavailableError("AI service failed unexpectedly.") from exc

            return parse_converse_response(raw_response)

        # 2. Gemini REST Provider
        if not self.api_key:
            logger.error("AI API key is missing or not configured")
            raise BedrockUnavailableError("AI credentials are not configured or incomplete.")

        # Convert system prompt
        system_instruction = None
        if system:
            system_text = "\n".join(
                s["text"]
                for s in system
                if isinstance(s, dict) and "text" in s
            )
            if system_text.strip():
                system_instruction = {"parts": [{"text": system_text}]}

        # Convert tool config
        gemini_tools = None
        if tool_config and "tools" in tool_config:
            gemini_tools = [{"function_declarations": get_gemini_tool_declarations()}]

        # Convert conversation messages
        gemini_contents: list[dict[str, Any]] = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", [])

            # Check if this message was an assistant turn holding raw gemini parts (including thoughtSignature)
            if "_gemini_parts" in msg:
                gemini_contents.append({
                    "role": "model",
                    "parts": msg["_gemini_parts"],
                })
                continue

            # Check if this turn contains toolResult blocks
            tool_results = [
                item["toolResult"]
                for item in content
                if isinstance(item, dict) and "toolResult" in item
            ]
            if tool_results:
                parts: list[dict[str, Any]] = []
                for tr in tool_results:
                    tool_use_id = tr.get("toolUseId", "")
                    func_name = "get_brief"
                    for prev_msg in reversed(messages):
                        if "_tool_map" in prev_msg and tool_use_id in prev_msg["_tool_map"]:
                            func_name = prev_msg["_tool_map"][tool_use_id]
                            break

                    result_content: Any = {}
                    tr_content = tr.get("content", [])
                    for c in tr_content:
                        if isinstance(c, dict) and "json" in c:
                            result_content = c["json"]
                        elif isinstance(c, dict) and "text" in c:
                            result_content = {"result": c["text"]}

                    parts.append({
                        "functionResponse": {
                            "name": func_name,
                            "response": {
                                "name": func_name,
                                "content": result_content,
                            },
                        }
                    })
                gemini_contents.append({"role": "user", "parts": parts})
                continue

            # Regular text message
            gemini_role = "model" if role == "assistant" else "user"
            parts = []
            if isinstance(content, str):
                parts.append({"text": content})
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and "text" in block:
                        parts.append({"text": block["text"]})
            if not parts:
                parts.append({"text": ""})
            gemini_contents.append({"role": gemini_role, "parts": parts})

        gemini_model = (
            self.model_id
            if (self.model_id and self.model_id.startswith("gemini"))
            else self.gemini_model_id
        )
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={self.api_key}"
        payload: dict[str, Any] = {"contents": gemini_contents}
        if system_instruction:
            payload["system_instruction"] = system_instruction
        if gemini_tools:
            payload["tools"] = gemini_tools

        try:
            with httpx.Client(timeout=30.0) as http_client:
                resp = http_client.post(url, json=payload)
        except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.TimeoutException) as exc:
            logger.error("Gemini connection/timeout error: %s", type(exc).__name__)
            raise BedrockUnavailableError("AI service connection timed out or unreachable.") from exc
        except httpx.NetworkError as exc:
            logger.error("Gemini network error: %s", type(exc).__name__)
            raise BedrockUnavailableError("AI service connection timed out or unreachable.") from exc
        except Exception as exc:
            logger.error("Unexpected error invoking Gemini: %s", type(exc).__name__)
            raise BedrockUnavailableError("AI service failed unexpectedly.") from exc

        if resp.status_code != 200:
            err_body = (
                resp.json().get("error", {})
                if resp.headers.get("content-type", "").startswith("application/json")
                else {}
            )
            err_code = err_body.get("status") or str(resp.status_code)
            err_msg = err_body.get("message", "")
            logger.error("Gemini API error %s: %s", err_code, err_msg)
            if resp.status_code in (401, 403):
                raise BedrockUnavailableError("AI credentials are not configured or incomplete.")
            raise BedrockUnavailableError(f"AI service returned an error ({err_code}).")

        res_json = resp.json()
        candidates = res_json.get("candidates", [])
        if not candidates:
            raise BedrockResponseError("Malformed response from AI service: missing candidates.")
        cand = candidates[0]
        content_obj = cand.get("content", {})
        gemini_parts = content_obj.get("parts", [])

        tool_use_blocks: list[dict[str, Any]] = []
        text_parts: list[str] = []
        tool_map: dict[str, str] = {}

        for part in gemini_parts:
            if isinstance(part, dict) and "functionCall" in part:
                fc = part["functionCall"]
                fname = fc.get("name", "")
                fargs = fc.get("args", {})
                fid = fc.get("id") or f"call_{uuid4().hex[:8]}"
                tool_use_blocks.append({
                    "name": fname,
                    "toolUseId": fid,
                    "input": fargs,
                })
                tool_map[fid] = fname
            elif isinstance(part, dict) and "text" in part:
                text_parts.append(part["text"])

        full_text = "".join(text_parts)

        if tool_use_blocks:
            content_blocks = [{"toolUse": tu} for tu in tool_use_blocks]
            stop_reason = "tool_use"
        else:
            content_blocks = [{"text": full_text}]
            stop_reason = "end_turn"

        message = {
            "role": "assistant",
            "content": content_blocks,
            "_gemini_parts": gemini_parts,
            "_tool_map": tool_map,
        }

        usage_meta = res_json.get("usageMetadata", {})
        usage = {
            "inputTokens": usage_meta.get("promptTokenCount", 0),
            "outputTokens": usage_meta.get("candidatesTokenCount", 0),
            "totalTokens": usage_meta.get("totalTokenCount", 0),
        }

        return ConverseResult(
            message=message,
            content=content_blocks,
            text=full_text,
            stop_reason=stop_reason,
            usage=usage,
            raw_response=res_json,
        )

    def generate_text(
        self,
        prompt: str,
        system_prompt: str | None = None,
        inference_config: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> str:
        """Convenience method to invoke the model with a single prompt string."""
        if not prompt or not prompt.strip():
            raise ValueError("prompt cannot be empty or whitespace only")
        messages = [{"role": "user", "content": [{"text": prompt}]}]
        system = [{"text": system_prompt}] if system_prompt else None
        result = self.converse(
            messages=messages,
            system=system,
            inference_config=inference_config,
            **kwargs,
        )
        return result.text

    def generate_groq_text(self, prompt: str, system_prompt: str | None = None) -> str:
        """Generate text through Groq for Feature 8 without changing chat routing."""
        if not settings.groq_api_key:
            raise BedrockUnavailableError(
                "Order extraction is not configured. Set GROQ_API_KEY in backend/.env."
            )
        if not prompt or not prompt.strip():
            raise ValueError("prompt cannot be empty or whitespace only")

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        payload = {
            "model": settings.groq_model_id,
            "messages": messages,
            "temperature": 0,
            "response_format": {"type": "json_object"},
        }
        headers = {
            "Authorization": f"Bearer {settings.groq_api_key}",
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=30.0) as http_client:
                response = http_client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers=headers,
                    json=payload,
                )
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            logger.error("Groq extraction connection failed (%s)", type(exc).__name__)
            raise BedrockUnavailableError(
                "Groq order extraction is unreachable. Check the connection and try again."
            ) from exc
        except Exception as exc:
            logger.error("Unexpected Groq extraction error (%s)", type(exc).__name__)
            raise BedrockUnavailableError("Groq order extraction failed unexpectedly.") from exc

        if response.status_code != 200:
            if response.status_code in (401, 403):
                message = "Groq authentication failed. Check GROQ_API_KEY in backend/.env."
            elif response.status_code == 400:
                message = "Groq rejected the configured model. Check GROQ_MODEL_ID in backend/.env."
            elif response.status_code == 429:
                message = "Groq order extraction is rate limited. Try again later."
            else:
                message = f"Groq order extraction failed with HTTP {response.status_code}."
            logger.error("Groq extraction returned HTTP %s", response.status_code)
            raise BedrockUnavailableError(message)

        try:
            response_body = response.json()
        except (ValueError, TypeError) as exc:
            raise BedrockResponseError("Groq returned an invalid response.") from exc

        choices = response_body.get("choices") if isinstance(response_body, dict) else None
        if not isinstance(choices, list) or not choices:
            raise BedrockResponseError("Groq returned an invalid response without a completion.")
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or not content.strip():
            raise BedrockResponseError("Groq returned an empty extraction response.")
        return content


_client_instance: BedrockClient | None = None


def get_bedrock_client() -> BedrockClient:
    """Returns a singleton BedrockClient instance for dependency injection."""
    global _client_instance
    if _client_instance is None:
        _client_instance = BedrockClient()
    return _client_instance
