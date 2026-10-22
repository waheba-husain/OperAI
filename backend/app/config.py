from decimal import Decimal
import logging

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

OBSOLETE_BEDROCK_MODEL_IDS: set[str] = {
    "anthropic.claude-3-haiku-20240307-v1:0",
}
DEFAULT_BEDROCK_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
DEFAULT_AWS_REGION = "us-east-1"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    api_key: str = "dev-key"
    database_url: str = ""
    frontend_origin: str = "http://localhost:5173"
    list_default_limit: int = 50
    list_max_limit: int = 200
    recovery_lateness_weight: Decimal = Decimal("0.5")
    recovery_margin_weight: Decimal = Decimal("0.3")
    recovery_customer_risk_weight: Decimal = Decimal("0.2")
    recovery_emergency_purchase_premium: Decimal = Decimal("1.2")
    recovery_emergency_delay_minutes: int = 30
    recovery_action_ttl_minutes: int = 30
    bedrock_model_id: str = DEFAULT_BEDROCK_MODEL_ID
    aws_region: str = DEFAULT_AWS_REGION

    @field_validator("bedrock_model_id", mode="before")
    @classmethod
    def upgrade_obsolete_model_id(cls, v: str) -> str:
        if v in OBSOLETE_BEDROCK_MODEL_IDS:
            logger.warning(
                "Obsolete Bedrock model ID '%s' detected; upgrading to '%s'.",
                v,
                DEFAULT_BEDROCK_MODEL_ID,
            )
            return DEFAULT_BEDROCK_MODEL_ID
        return v

    @property
    def BEDROCK_MODEL_ID(self) -> str:
        return self.bedrock_model_id

    @property
    def AWS_REGION(self) -> str:
        return self.aws_region


settings = Settings()
