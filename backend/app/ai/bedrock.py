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

from app.config import settings
from app.errors import AppError

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
    """Reusable Bedrock Runtime client supporting the Converse API."""

    def __init__(
        self,
        model_id: str | None = None,
        region_name: str | None = None,
        client: Any = None,
    ) -> None:
        self.model_id = model_id or settings.bedrock_model_id
        self.region_name = region_name or settings.aws_region
        self._client = client

    @property
    def client(self) -> Any:
        """Lazily creates and returns the boto3 bedrock-runtime client."""
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
        """Invokes the Bedrock Runtime Converse API.

        Args:
            messages: List of message objects conforming to Converse API schema.
            system: Optional system prompt blocks [{"text": "..."}].
            inference_config: Optional inference parameters (e.g. maxTokens, temperature).
            tool_config: Optional tool configuration.
            additional_model_request_fields: Optional model-specific parameters.
            **kwargs: Additional parameters passed to client.converse.

        Returns:
            ConverseResult with message, content, text, stop_reason, usage, and raw response.

        Raises:
            ValueError: If messages is empty.
            BedrockUnavailableError: If credentials are missing or service unreachable.
            BedrockResponseError: If the model response is malformed.
        """
        if not messages:
            raise ValueError("messages must be a non-empty list")

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


_client_instance: BedrockClient | None = None


def get_bedrock_client() -> BedrockClient:
    """Returns a singleton BedrockClient instance for dependency injection."""
    global _client_instance
    if _client_instance is None:
        _client_instance = BedrockClient()
    return _client_instance
