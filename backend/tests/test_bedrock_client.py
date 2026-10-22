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
