"""
Configuration via environment variables (and optional .env file).
All required secrets raise a clear error at startup if missing.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Google OAuth ──────────────────────────────────────────────────────────
    # Path to token.json decoded from the GOOGLE_OAUTH_TOKEN GitHub secret
    google_token_path: str = "/tmp/google_token.json"

    # ── Asana ─────────────────────────────────────────────────────────────────
    asana_pat: str
    asana_workspace_gid: str
    # Optional: restrict task fetch to a single project GID
    asana_project_gid: str = ""

    # ── Weather ───────────────────────────────────────────────────────────────
    openweathermap_api_key: str
    weather_city: str = "Boston,MA,US"

    # ── Gemini ────────────────────────────────────────────────────────────────
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"

    # ── Email + Calendar ──────────────────────────────────────────────────────
    briefing_email_to: str = "ncduncan@gmail.com"
    work_email: str = "Nathaniel.duncan@geaerospace.com"

    # ── TRMNL display ─────────────────────────────────────────────────────────
    trmnl_webhook_url: str = ""

    # ── Feature flags ─────────────────────────────────────────────────────────
    # If true: print briefing to stdout; skip email + calendar writes
    briefing_dry_run: bool = False
    # Future e-ink display support
    eink_enabled: bool = False
    eink_output_path: str = "/tmp/briefing_eink.json"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
