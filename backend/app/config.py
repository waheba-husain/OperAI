from decimal import Decimal

from pydantic_settings import BaseSettings, SettingsConfigDict


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


settings = Settings()
