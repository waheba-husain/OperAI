from unittest.mock import MagicMock, patch
import pytest
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

from app.ai.bedrock import (
    BedrockClient,
    BedrockError,
    BedrockResponseError,
    BedrockUnavailableError,
    ConverseResult,
    get_bedrock_client,
    parse_converse_response,
)
from app.config import DEFAULT_AWS_REGION, DEFAULT_BEDROCK_MODEL_ID, Settings, settings


@pytest.fixture
def sample_valid_converse_response():
    return {
        "output": {
            "message": {
                "role": "assistant",
                "content": [{"text": "Paneer is short for tomorrow."}],
            }
        },
        "stopReason": "end_turn",
        "usage": {"inputTokens": 12, "outputTokens": 8, "totalTokens": 20},
        "metrics": {"latencyMs": 145},
    }


class TestBedrockConfiguration:
    def test_default_settings_values(self):
        assert settings.bedrock_model_id == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
        assert settings.aws_region == "us-east-1"
        assert settings.BEDROCK_MODEL_ID == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
        assert settings.AWS_REGION == "us-east-1"

    def test_obsolete_model_id_override_upgraded_with_warning(self, caplog):
        with caplog.at_level("WARNING"):
            custom_settings = Settings(bedrock_model_id="anthropic.claude-3-haiku-20240307-v1:0")
            assert custom_settings.bedrock_model_id == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
            assert "Obsolete Bedrock model ID" in caplog.text

    def test_custom_valid_model_id_retained(self):
        custom_settings = Settings(bedrock_model_id="us.anthropic.claude-3-sonnet-20240229-v1:0")
        assert custom_settings.bedrock_model_id == "us.anthropic.claude-3-sonnet-20240229-v1:0"

    def test_custom_region_retained(self):
        custom_settings = Settings(aws_region="eu-west-1")
        assert custom_settings.aws_region == "eu-west-1"

    def test_configured_region_passed_to_boto3_client(self):
        with patch("boto3.client") as mock_boto_client:
            mock_boto = MagicMock()
            mock_boto_client.return_value = mock_boto
            client = BedrockClient()
            _ = client.client
            mock_boto_client.assert_called_once_with(
                "bedrock-runtime",
                region_name="us-east-1",
            )

    def test_configured_model_passed_to_converse_call(self, sample_valid_converse_response):
        mock_boto = MagicMock()
        mock_boto.converse.return_value = sample_valid_converse_response
        client = BedrockClient(client=mock_boto)
        client.converse(messages=[{"role": "user", "content": [{"text": "Hello"}]}])
        assert mock_boto.converse.call_args[1]["modelId"] == "us.anthropic.claude-haiku-4-5-20251001-v1:0"


class TestBedrockClientInitialization:
    def test_default_config_used(self):
        client = BedrockClient()
        assert client.model_id == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
        assert client.region_name == "us-east-1"
        assert client.model_id == settings.bedrock_model_id
        assert client.region_name == settings.aws_region
        assert client._client is None

    def test_custom_config_override(self):
        client = BedrockClient(model_id="custom-model-id", region_name="eu-central-1")
        assert client.model_id == "custom-model-id"
        assert client.region_name == "eu-central-1"

    def test_injected_client_used(self):
        mock_boto = MagicMock()
        client = BedrockClient(client=mock_boto)
        assert client.client is mock_boto

    def test_get_bedrock_client_singleton(self):
        client1 = get_bedrock_client()
        client2 = get_bedrock_client()
        assert client1 is client2
        assert isinstance(client1, BedrockClient)



class TestBedrockClientConverseSuccess:
    def test_successful_converse(self, sample_valid_converse_response):
        mock_boto = MagicMock()
        mock_boto.converse.return_value = sample_valid_converse_response

        client = BedrockClient(client=mock_boto)
        messages = [{"role": "user", "content": [{"text": "Hello"}]}]

        result = client.converse(
            messages=messages,
            system=[{"text": "You are a helpful assistant"}],
            inference_config={"temperature": 0.2, "maxTokens": 250},
        )

        mock_boto.converse.assert_called_once_with(
            modelId=settings.bedrock_model_id,
            messages=messages,
            system=[{"text": "You are a helpful assistant"}],
            inferenceConfig={"temperature": 0.2, "maxTokens": 250},
        )

        assert isinstance(result, ConverseResult)
        assert result.text == "Paneer is short for tomorrow."
        assert result.stop_reason == "end_turn"
        assert result.usage == {"inputTokens": 12, "outputTokens": 8, "totalTokens": 20}
        assert result.message["role"] == "assistant"
        assert result.raw_response == sample_valid_converse_response

    def test_multi_block_content_concatenation(self):
        mock_boto = MagicMock()
        mock_boto.converse.return_value = {
            "output": {
                "message": {
                    "role": "assistant",
                    "content": [
                        {"text": "First part. "},
                        {"text": "Second part."},
                    ],
                }
            },
            "stopReason": "end_turn",
        }

        client = BedrockClient(client=mock_boto)
        result = client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])
        assert result.text == "First part. Second part."

    def test_generate_text_helper(self, sample_valid_converse_response):
        mock_boto = MagicMock()
        mock_boto.converse.return_value = sample_valid_converse_response

        client = BedrockClient(client=mock_boto)
        text = client.generate_text("We are out of paneer", system_prompt="Kitchen bot")

        assert text == "Paneer is short for tomorrow."
        mock_boto.converse.assert_called_once_with(
            modelId=settings.bedrock_model_id,
            messages=[{"role": "user", "content": [{"text": "We are out of paneer"}]}],
            system=[{"text": "Kitchen bot"}],
        )

    def test_empty_messages_validation(self):
        client = BedrockClient(client=MagicMock())
        with pytest.raises(ValueError, match="messages must be a non-empty list"):
            client.converse(messages=[])

    def test_empty_prompt_validation(self):
        client = BedrockClient(client=MagicMock())
        with pytest.raises(ValueError, match="prompt cannot be empty"):
            client.generate_text("   ")


class TestBedrockClientErrorHandling:
    def test_missing_credentials_raises_bedrock_unavailable(self):
        mock_boto = MagicMock()
        mock_boto.converse.side_effect = NoCredentialsError()

        client = BedrockClient(client=mock_boto)
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        err = exc_info.value
        assert err.status == 502
        assert err.code == "AI_UNAVAILABLE"
        assert "credentials" in err.message.lower()

    def test_partial_credentials_raises_bedrock_unavailable(self):
        mock_boto = MagicMock()
        mock_boto.converse.side_effect = PartialCredentialsError(
            provider="env", cred_var="AWS_SECRET_ACCESS_KEY"
        )

        client = BedrockClient(client=mock_boto)
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        err = exc_info.value
        assert err.status == 502
        assert err.code == "AI_UNAVAILABLE"

    def test_credential_retrieval_error_raises_bedrock_unavailable(self):
        mock_boto = MagicMock()
        mock_boto.converse.side_effect = CredentialRetrievalError(
            provider="assume-role", error_msg="Access denied"
        )

        client = BedrockClient(client=mock_boto)
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        err = exc_info.value
        assert err.status == 502
        assert err.code == "AI_UNAVAILABLE"

    def test_connect_timeout_raises_bedrock_unavailable(self):
        mock_boto = MagicMock()
        mock_boto.converse.side_effect = ConnectTimeoutError(endpoint_url="https://bedrock.test")

        client = BedrockClient(client=mock_boto)
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        err = exc_info.value
        assert err.status == 502
        assert err.code == "AI_UNAVAILABLE"

    def test_read_timeout_raises_bedrock_unavailable(self):
        mock_boto = MagicMock()
        mock_boto.converse.side_effect = ReadTimeoutError(endpoint_url="https://bedrock.test")

        client = BedrockClient(client=mock_boto)
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        err = exc_info.value
        assert err.status == 502
        assert err.code == "AI_UNAVAILABLE"

    def test_endpoint_connection_error_raises_bedrock_unavailable(self):
        mock_boto = MagicMock()
        mock_boto.converse.side_effect = EndpointConnectionError(
            endpoint_url="https://bedrock.test"
        )

        client = BedrockClient(client=mock_boto)
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        assert exc_info.value.status == 502
        assert exc_info.value.code == "AI_UNAVAILABLE"

    def test_connection_closed_error_raises_bedrock_unavailable(self):
        mock_boto = MagicMock()
        mock_boto.converse.side_effect = ConnectionClosedError(
            endpoint_url="https://bedrock.test"
        )

        client = BedrockClient(client=mock_boto)
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        assert exc_info.value.status == 502
        assert exc_info.value.code == "AI_UNAVAILABLE"

    def test_client_error_model_timeout_raises_bedrock_unavailable(self):
        mock_boto = MagicMock()
        mock_boto.converse.side_effect = ClientError(
            {"Error": {"Code": "ModelTimeoutException", "Message": "Model timed out"}},
            "Converse",
        )

        client = BedrockClient(client=mock_boto)
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        err = exc_info.value
        assert err.status == 502
        assert err.code == "AI_UNAVAILABLE"
        assert "ModelTimeoutException" in err.message

    def test_client_error_throttling_raises_bedrock_unavailable(self):
        mock_boto = MagicMock()
        mock_boto.converse.side_effect = ClientError(
            {"Error": {"Code": "ThrottlingException", "Message": "Rate limit exceeded"}},
            "Converse",
        )

        client = BedrockClient(client=mock_boto)
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        assert exc_info.value.status == 502
        assert exc_info.value.code == "AI_UNAVAILABLE"

    def test_client_error_logging_includes_aws_diagnostic_message_without_secrets(self, caplog):
        mock_boto = MagicMock()
        mock_boto.converse.side_effect = ClientError(
            {
                "Error": {
                    "Code": "ValidationException",
                    "Message": "Expected toolResult blocks at messages.2.content for the following Ids: tooluse_abc123",
                },
                "ResponseMetadata": {
                    "HTTPHeaders": {
                        "x-amz-security-token": "secret-token-to-never-leak",
                    }
                },
            },
            "Converse",
        )

        client = BedrockClient(client=mock_boto)
        with caplog.at_level("ERROR"):
            with pytest.raises(BedrockUnavailableError) as exc_info:
                client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        # Verify logged message includes diagnostic error code and message
        assert "ValidationException" in caplog.text
        assert "Expected toolResult blocks at messages.2.content" in caplog.text

        # Verify secrets in metadata/headers are NOT leaked in logs
        assert "secret-token-to-never-leak" not in caplog.text

        # Verify external exception remains sanitized for frontend/client
        err = exc_info.value
        assert err.status == 502
        assert err.code == "AI_UNAVAILABLE"
        assert err.message == "AI service returned an error (ValidationException)."
        assert "Expected toolResult" not in err.message
        assert "secret-token-to-never-leak" not in err.message

    def test_generic_botocore_error_raises_bedrock_unavailable(self):
        mock_boto = MagicMock()
        mock_boto.converse.side_effect = BotoCoreError()

        client = BedrockClient(client=mock_boto)
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        assert exc_info.value.status == 502
        assert exc_info.value.code == "AI_UNAVAILABLE"


class TestResponseParsingValidation:
    def test_non_dict_response_raises_bedrock_response_error(self):
        with pytest.raises(BedrockResponseError):
            parse_converse_response(["not", "a", "dict"])

    def test_missing_output_key_raises_bedrock_response_error(self):
        with pytest.raises(BedrockResponseError, match="missing output"):
            parse_converse_response({"stopReason": "end_turn"})

    def test_non_dict_output_raises_bedrock_response_error(self):
        with pytest.raises(BedrockResponseError, match="missing output"):
            parse_converse_response({"output": "invalid_output"})

    def test_missing_message_key_raises_bedrock_response_error(self):
        with pytest.raises(BedrockResponseError, match="missing message"):
            parse_converse_response({"output": {}})

    def test_missing_content_key_raises_bedrock_response_error(self):
        with pytest.raises(BedrockResponseError, match="missing content"):
            parse_converse_response({"output": {"message": {"role": "assistant"}}})

    def test_non_list_content_raises_bedrock_response_error(self):
        with pytest.raises(BedrockResponseError, match="missing content"):
            parse_converse_response(
                {"output": {"message": {"role": "assistant", "content": "not_a_list"}}}
            )

    def test_invalid_stop_reason_type_raises_bedrock_response_error(self):
        with pytest.raises(BedrockResponseError, match="invalid stopReason"):
            parse_converse_response(
                {
                    "output": {"message": {"role": "assistant", "content": []}},
                    "stopReason": 12345,
                }
            )

    def test_invalid_usage_type_raises_bedrock_response_error(self):
        with pytest.raises(BedrockResponseError, match="invalid usage"):
            parse_converse_response(
                {
                    "output": {"message": {"role": "assistant", "content": []}},
                    "usage": "not_a_dict",
                }
            )

    def test_bedrock_response_error_is_app_error_502(self):
        err = BedrockResponseError("Malformed payload")
        assert isinstance(err, BedrockError)
        assert err.status == 502
        assert err.code == "AI_UNAVAILABLE"


class TestGroqProviderConfiguration:
    def test_groq_default_settings(self):
        assert settings.groq_model_id == "openai/gpt-oss-120b"
        assert settings.GROQ_MODEL_ID == "openai/gpt-oss-120b"

    def test_custom_groq_settings(self):
        custom = Settings(groq_model_id="custom-groq-model", groq_api_key="gsk-test-key")
        assert custom.groq_model_id == "custom-groq-model"
        assert custom.groq_api_key == "gsk-test-key"
        assert custom.GROQ_MODEL_ID == "custom-groq-model"
        assert custom.GROQ_API_KEY == "gsk-test-key"


class TestGroqConverseExecution:
    def test_groq_request_format_and_headers(self, monkeypatch):
        import httpx
        captured_request = {}

        def mock_post(client, url, headers=None, json=None):
            captured_request["url"] = str(url)
            captured_request["headers"] = headers
            captured_request["json"] = json
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 200
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {
                "id": "chatcmpl-test",
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "Hello from Groq!",
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 15, "completion_tokens": 5, "total_tokens": 20},
            }
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)

        client = BedrockClient(api_key="gsk-mock-key", model_id="openai/gpt-oss-120b")
        result = client.converse(
            messages=[{"role": "user", "content": [{"text": "Hello"}]}],
            system=[{"text": "System prompt text"}],
            inference_config={"temperature": 0.1, "maxTokens": 500},
        )

        assert captured_request["url"] == "https://api.groq.com/openai/v1/chat/completions"
        assert captured_request["headers"]["Authorization"] == "Bearer gsk-mock-key"
        assert captured_request["headers"]["Content-Type"] == "application/json"

        payload = captured_request["json"]
        assert payload["model"] == "openai/gpt-oss-120b"
        assert payload["temperature"] == 0.1
        assert payload["max_tokens"] == 500
        assert payload["messages"][0] == {"role": "system", "content": "System prompt text"}
        assert payload["messages"][1] == {"role": "user", "content": "Hello"}

        assert isinstance(result, ConverseResult)
        assert result.text == "Hello from Groq!"
        assert result.stop_reason == "end_turn"
        assert result.usage == {"inputTokens": 15, "outputTokens": 5, "totalTokens": 20}

    def test_groq_single_tool_call_parsing(self, monkeypatch):
        import httpx
        from app.ai.tools import get_tool_config

        def mock_post(client, url, headers=None, json=None):
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 200
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_brief_123",
                                    "type": "function",
                                    "function": {
                                        "name": "get_brief",
                                        "arguments": '{"date": "2026-10-23"}',
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 30, "completion_tokens": 12, "total_tokens": 42},
            }
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)

        client = BedrockClient(api_key="gsk-mock-key", model_id="openai/gpt-oss-120b")
        result = client.converse(
            messages=[{"role": "user", "content": [{"text": "Get brief"}]}],
            tool_config=get_tool_config(),
        )

        assert result.stop_reason == "tool_use"
        assert len(result.content) == 1
        tu = result.content[0]["toolUse"]
        assert tu["name"] == "get_brief"
        assert tu["toolUseId"] == "call_brief_123"
        assert tu["input"] == {"date": "2026-10-23"}
        assert result.message["_tool_map"]["call_brief_123"] == "get_brief"

    def test_groq_multiple_tool_calls_in_single_turn(self, monkeypatch):
        import httpx

        def mock_post(client, url, headers=None, json=None):
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 200
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {
                                        "name": "get_brief",
                                        "arguments": '{"date": "2026-10-23"}',
                                    },
                                },
                                {
                                    "id": "call_2",
                                    "type": "function",
                                    "function": {
                                        "name": "analyze_price",
                                        "arguments": '{"menu_item_name": "Paneer Biryani"}',
                                    },
                                },
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 50, "completion_tokens": 25, "total_tokens": 75},
            }
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)

        client = BedrockClient(api_key="gsk-mock-key", model_id="openai/gpt-oss-120b")
        result = client.converse(
            messages=[{"role": "user", "content": [{"text": "Brief and price"}]}],
        )

        assert result.stop_reason == "tool_use"
        assert len(result.content) == 2
        assert result.content[0]["toolUse"]["name"] == "get_brief"
        assert result.content[0]["toolUse"]["toolUseId"] == "call_1"
        assert result.content[1]["toolUse"]["name"] == "analyze_price"
        assert result.content[1]["toolUse"]["toolUseId"] == "call_2"

    def test_groq_sequential_tool_results_history_serialization(self, monkeypatch):
        import httpx
        captured_messages = []

        def mock_post(client, url, headers=None, json=None):
            captured_messages.extend(json.get("messages", []))
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 200
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "Shortage confirmed.",
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 60, "completion_tokens": 10, "total_tokens": 70},
            }
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)

        client = BedrockClient(api_key="gsk-mock-key", model_id="openai/gpt-oss-120b")

        # Simulate round 2 where messages contains tool results
        messages = [
            {"role": "user", "content": [{"text": "We are short on Paneer"}]},
            {
                "role": "assistant",
                "content": [
                    {
                        "toolUse": {
                            "toolUseId": "call_rec_999",
                            "name": "propose_recovery",
                            "input": {"ingredient_name": "Paneer"},
                        }
                    }
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "toolResult": {
                            "toolUseId": "call_rec_999",
                            "status": "success",
                            "content": [{"json": {"options": [{"option_number": 1}]}}],
                        }
                    }
                ],
            },
        ]

        result = client.converse(messages=messages)
        assert result.text == "Shortage confirmed."

        # Verify how toolResult turn was transformed into OpenAI format
        tool_messages = [m for m in captured_messages if m.get("role") == "tool"]
        assert len(tool_messages) == 1
        assert tool_messages[0]["tool_call_id"] == "call_rec_999"
        assert "options" in tool_messages[0]["content"]

    def test_groq_malformed_tool_arguments_falls_back_to_empty_dict(self, monkeypatch):
        import httpx

        def mock_post(client, url, headers=None, json=None):
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 200
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_broken",
                                    "type": "function",
                                    "function": {
                                        "name": "get_brief",
                                        "arguments": "{not-valid-json",
                                    },
                                }
                            ],
                        },
                    }
                ],
            }
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)

        client = BedrockClient(api_key="gsk-mock-key", model_id="openai/gpt-oss-120b")
        result = client.converse(messages=[{"role": "user", "content": [{"text": "Brief"}]}])
        assert result.content[0]["toolUse"]["input"] == {}

    def test_groq_missing_choices_raises_bedrock_response_error(self, monkeypatch):
        import httpx

        def mock_post(client, url, headers=None, json=None):
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 200
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {"choices": []}
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)

        client = BedrockClient(api_key="gsk-mock-key", model_id="openai/gpt-oss-120b")
        with pytest.raises(BedrockResponseError, match="missing choices"):
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])


class TestGroqErrorHandling:
    def test_groq_401_raises_bedrock_unavailable(self, monkeypatch):
        import httpx

        def mock_post(client, url, headers=None, json=None):
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 401
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {
                "error": {"code": "invalid_api_key", "message": "Invalid API key"}
            }
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)

        client = BedrockClient(api_key="gsk-invalid-secret", model_id="openai/gpt-oss-120b")
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        err = exc_info.value
        assert err.status == 502
        assert err.code == "AI_UNAVAILABLE"
        assert "gsk-invalid-secret" not in err.message

    def test_groq_429_raises_bedrock_unavailable(self, monkeypatch):
        import httpx

        def mock_post(client, url, headers=None, json=None):
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 429
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {
                "error": {"code": "rate_limit_exceeded", "message": "Rate limit reached"}
            }
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)

        client = BedrockClient(api_key="gsk-test", model_id="openai/gpt-oss-120b")
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        err = exc_info.value
        assert err.status == 502
        assert "rate limit" in err.message.lower()

    def test_groq_500_raises_bedrock_unavailable(self, monkeypatch):
        import httpx

        def mock_post(client, url, headers=None, json=None):
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 500
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {
                "error": {"code": "server_error", "message": "Internal Groq error"}
            }
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)

        client = BedrockClient(api_key="gsk-test", model_id="openai/gpt-oss-120b")
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        err = exc_info.value
        assert err.status == 502

    def test_groq_timeout_raises_bedrock_unavailable(self, monkeypatch):
        import httpx

        def mock_post(client, url, headers=None, json=None):
            raise httpx.ReadTimeout("Timeout connecting to Groq")

        monkeypatch.setattr(httpx.Client, "post", mock_post)

        client = BedrockClient(api_key="gsk-test", model_id="openai/gpt-oss-120b")
        with pytest.raises(BedrockUnavailableError) as exc_info:
            client.converse(messages=[{"role": "user", "content": [{"text": "Hi"}]}])

        err = exc_info.value
        assert err.status == 502
        assert "timed out" in err.message.lower()
