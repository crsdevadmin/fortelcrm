"""Run this while uvicorn is running to see the REAL error."""
import requests, json

r = requests.post(
    "http://localhost:8000/auth/login",
    json={"email": "admin@fortel.in", "password": "admin2026"},
    timeout=10
)
print(f"Status: {r.status_code}")
print(f"Body:   {r.text[:2000]}")
