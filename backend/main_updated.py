"""Legacy entry point retained for compatibility; uses the secured application."""

from fastapi import Depends

from .auth.auth import enforce_request_identity
from .main import app
from .routers.exports import router as exports_router


app.include_router(exports_router, dependencies=[Depends(enforce_request_identity)])
