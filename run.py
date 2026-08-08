"""
Alternative entry point that includes all routers.
Run with:  uvicorn run:app --reload --port 8000
"""
from backend.main import app
from fastapi import Depends
from backend.auth.auth import enforce_request_identity
from backend.routers.exports import router as exports_router

app.include_router(exports_router, dependencies=[Depends(enforce_request_identity)])
