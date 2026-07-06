"""
Alternative entry point that includes all routers.
Run with:  uvicorn run:app --reload --port 8000
"""
from backend.main import app
from backend.routers.exports import router as exports_router

app.include_router(exports_router)
