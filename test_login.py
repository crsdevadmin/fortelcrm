"""Run this while uvicorn is running to verify a configured test login."""
import os
import requests

email = os.environ.get("FORTEL_TEST_EMAIL")
password = os.environ.get("FORTEL_TEST_PASSWORD")
if not email or not password:
    raise SystemExit("Set FORTEL_TEST_EMAIL and FORTEL_TEST_PASSWORD")

r = requests.post(
    "http://localhost:8000/auth/login",
    json={"email": email, "password": password},
    timeout=10
)
print(f"Status: {r.status_code}")
print(f"Body:   {r.text[:2000]}")
