# backend/core/config.py
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "Fortel CRM"
    DEBUG: bool = False
    SECRET_KEY: str                        # generate: openssl rand -hex 32
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480 # 8 hours

    # PostgreSQL on AWS RDS
    DATABASE_URL: str

    # Google OAuth (replace with AWS Cognito if preferred)
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/auth/google/callback"

    # AWS S3 (bill/invoice uploads)
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_S3_BUCKET: str = "fortel-crm-uploads"
    AWS_REGION: str = "ap-south-1"

    # SMS reminders via AWS SNS. Keep disabled/dry-run until AWS SNS SMS is approved.
    SMS_ENABLED: bool = False
    SMS_DRY_RUN: bool = True
    SMS_SENDER_ID: str = "FORTELCRM"
    SMS_DEFAULT_COUNTRY_CODE: str = "+91"

    FRONTEND_URL: str = "http://localhost:3000"

    class Config:
        env_file = (
            ".env",
            "backend/.env",
            "../.env",
        )
        case_sensitive = True


settings = Settings()
