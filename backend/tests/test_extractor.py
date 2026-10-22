from unittest.mock import MagicMock
import pytest
import httpx

from app.ai.extractor import (
    RawExtractedItem,
    RawExtractedOrder,
    _parse_extracted_json,
    extract_order_from_text,
    extract_order_with_bedrock,
    extract_order_with_groq,
)
from app.config import settings
from app.errors import AppError


class TestOrderExtractionJsonParsing:
    def test_parse_valid_clean_json(self):
        raw = """{
            "customer_name": "Rohan Sharma",
            "customer_phone": "9876543210",
            "channel": "whatsapp",
            "deadline": "2026-10-23T14:00:00+05:30",
            "items": [
                {"dish": "Paneer Biryani", "quantity": 2}
            ],
            "confidence": 0.95,
            "warnings": []
        }"""
        parsed = _parse_extracted_json(raw)
        assert isinstance(parsed, RawExtractedOrder)
        assert parsed.customer_name == "Rohan Sharma"
        assert parsed.customer_phone == "9876543210"
        assert len(parsed.items) == 1
        assert parsed.items[0].dish == "Paneer Biryani"
        assert parsed.items[0].quantity == 2
        assert parsed.confidence == 0.95

    def test_parse_markdown_fenced_json(self):
        raw = """```json
        {
            "customer_name": "Aarav",
            "customer_phone": null,
            "channel": "whatsapp",
            "deadline": null,
            "items": [
                {"dish": "Butter Naan", "quantity": 4}
            ],
            "confidence": 0.9,
            "warnings": []
        }
        ```"""
        parsed = _parse_extracted_json(raw)
        assert parsed.customer_name == "Aarav"
        assert len(parsed.items) == 1
        assert parsed.items[0].dish == "Butter Naan"
        assert parsed.items[0].quantity == 4

    def test_parse_invalid_json_raises_422(self):
        raw = "{invalid-json-string}"
        with pytest.raises(AppError) as exc_info:
            _parse_extracted_json(raw)
        assert exc_info.value.status == 422
        assert exc_info.value.code == "EXTRACTION_FAILED"

    def test_parse_schema_validation_failure_raises_422(self):
        # items with non-integer or zero quantity
        raw = """{
            "customer_name": "Test",
            "items": [
                {"dish": "Paneer", "quantity": 0}
            ]
        }"""
        with pytest.raises(AppError) as exc_info:
            _parse_extracted_json(raw)
        assert exc_info.value.status == 422
        assert exc_info.value.code == "EXTRACTION_FAILED"


class TestOrderExtractionGroqExecution:
    def test_extract_order_with_groq_success(self, monkeypatch):
        captured = {}

        def mock_post(client, url, headers=None, json=None):
            captured["url"] = str(url)
            captured["headers"] = headers
            captured["json"] = json
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 200
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": (
                                '{"customer_name": "Priya", "customer_phone": "9998887776", '
                                '"channel": "whatsapp", "deadline": null, '
                                '"items": [{"dish": "Paneer Tikka", "quantity": 1}], '
                                '"confidence": 0.95, "warnings": []}'
                            ),
                        }
                    }
                ]
            }
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)
        monkeypatch.setattr(settings, "groq_api_key", "gsk-mock-extractor-key")

        result = extract_order_with_groq("1 paneer tikka please - Priya 9998887776")
        assert captured["url"] == "https://api.groq.com/openai/v1/chat/completions"
        assert captured["headers"]["Authorization"] == "Bearer gsk-mock-extractor-key"
        assert captured["json"]["response_format"] == {"type": "json_object"}
        assert captured["json"]["model"] == "openai/gpt-oss-120b"

        assert isinstance(result, RawExtractedOrder)
        assert result.customer_name == "Priya"
        assert result.customer_phone == "9998887776"
        assert len(result.items) == 1
        assert result.items[0].dish == "Paneer Tikka"
        assert result.items[0].quantity == 1

    def test_extract_order_from_text_contract_delegation(self, monkeypatch):
        # Verifies that extract_order_from_text and extract_order_with_bedrock alias delegate to Groq
        called = []

        def mock_groq(text):
            called.append(text)
            return RawExtractedOrder(
                customer_name="Test",
                channel="whatsapp",
                items=[RawExtractedItem(dish="Naan", quantity=2)],
            )

        monkeypatch.setattr("app.ai.extractor.extract_order_with_groq", mock_groq)

        res1 = extract_order_from_text("Test 1")
        assert len(called) == 1
        assert res1.customer_name == "Test"

        res2 = extract_order_with_bedrock("Test 2")
        assert len(called) == 2
        assert res2.customer_name == "Test"

    def test_extract_order_empty_content_raises_422(self, monkeypatch):
        def mock_post(client, url, headers=None, json=None):
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 200
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {
                "choices": [{"message": {"role": "assistant", "content": "   "}}]
            }
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)
        monkeypatch.setattr(settings, "groq_api_key", "gsk-mock-key")

        with pytest.raises(AppError) as exc_info:
            extract_order_with_groq("Random text")
        assert exc_info.value.status == 422
        assert exc_info.value.code == "EXTRACTION_FAILED"


class TestOrderExtractionGroqErrors:
    def test_missing_api_key_raises_502(self, monkeypatch):
        monkeypatch.setattr(settings, "groq_api_key", "")
        monkeypatch.setattr(settings, "gemini_api_key", "")

        with pytest.raises(AppError) as exc_info:
            extract_order_with_groq("Order text")
        assert exc_info.value.status == 502
        assert exc_info.value.code == "AI_UNAVAILABLE"

    def test_provider_401_raises_502_sanitized(self, monkeypatch):
        secret_key = "gsk-ultra-secret-key-12345"

        def mock_post(client, url, headers=None, json=None):
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 401
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {"error": {"message": "Invalid API Key"}}
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)
        monkeypatch.setattr(settings, "groq_api_key", secret_key)

        with pytest.raises(AppError) as exc_info:
            extract_order_with_groq("Order text")
        err = exc_info.value
        assert err.status == 502
        assert err.code == "AI_UNAVAILABLE"
        assert secret_key not in err.message

    def test_provider_429_rate_limit_raises_502(self, monkeypatch):
        def mock_post(client, url, headers=None, json=None):
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 429
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {
                "error": {"code": "rate_limit", "message": "Tokens per minute exceeded"}
            }
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)
        monkeypatch.setattr(settings, "groq_api_key", "gsk-test")

        with pytest.raises(AppError) as exc_info:
            extract_order_with_groq("Order text")
        err = exc_info.value
        assert err.status == 502
        assert "rate limit" in err.message.lower()

    def test_provider_500_raises_502(self, monkeypatch):
        def mock_post(client, url, headers=None, json=None):
            mock_resp = MagicMock(spec=httpx.Response)
            mock_resp.status_code = 500
            mock_resp.headers = {"content-type": "application/json"}
            mock_resp.json.return_value = {"error": {"message": "Groq internal error"}}
            return mock_resp

        monkeypatch.setattr(httpx.Client, "post", mock_post)
        monkeypatch.setattr(settings, "groq_api_key", "gsk-test")

        with pytest.raises(AppError) as exc_info:
            extract_order_with_groq("Order text")
        assert exc_info.value.status == 502

    def test_provider_timeout_raises_502(self, monkeypatch):
        def mock_post(client, url, headers=None, json=None):
            raise httpx.ReadTimeout("Timeout while contacting Groq")

        monkeypatch.setattr(httpx.Client, "post", mock_post)
        monkeypatch.setattr(settings, "groq_api_key", "gsk-test")

        with pytest.raises(AppError) as exc_info:
            extract_order_with_groq("Order text")
        assert exc_info.value.status == 502
        assert "timed out" in exc_info.value.message.lower()
