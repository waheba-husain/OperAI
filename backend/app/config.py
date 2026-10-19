from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    api_key: str = "dev-key"
    database_url: str = ""
    frontend_origin: str = "http://localhost:5173"
    list_default_limit: int = 50
    list_max_limit: int = 200


settings = Settings()