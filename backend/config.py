from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = "development"

    # CORS: comma-separated origins, e.g. "chrome-extension://<id>,http://localhost:5173"
    cors_origins: str = "http://localhost:5173"

    # LLM (Featherless AI, OpenAI-compatible API)
    featherless_api_key: str = ""
    featherless_base_url: str = "https://api.featherless.ai/v1"
    featherless_model: str = "deepseek-ai/DeepSeek-V4-Flash"
    llm_timeout_seconds: float = 8.0

    # Request limits
    max_blocks_per_request: int = 150
    max_block_text_length: int = 500
    max_request_bytes: int = 300_000

    # Rate limiting (slowapi / limits syntax)
    rate_limit_analyze: str = "20/minute"
    rate_limit_calibration: str = "10/minute"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
