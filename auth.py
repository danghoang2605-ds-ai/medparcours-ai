"""Xác thực access token Supabase cho FastAPI.

Dùng endpoint Auth /user thay vì tự giải mã HS256. Cách này hoạt động với cả
legacy JWT secret và signing key bất đối xứng (RS256/ES256), đồng thời tránh
phải đưa service-role key vào ứng dụng.
"""

import os
import requests
from fastapi import Header, HTTPException

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY") or ""


def _require_config() -> None:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=500,
            detail="Backend chưa cấu hình SUPABASE_URL hoặc SUPABASE_ANON_KEY",
        )


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    """Xác minh Bearer token bằng Supabase Auth và trả user đã được xác thực."""
    _require_config()

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Thiếu token đăng nhập")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token đăng nhập rỗng")

    try:
        response = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {token}",
            },
            timeout=10,
        )
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=503,
            detail="Không kết nối được Supabase Auth",
        ) from exc

    if response.status_code != 200:
        raise HTTPException(
            status_code=401,
            detail="Token không hợp lệ hoặc đã hết hạn",
        )

    payload = response.json()
    user_id = payload.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Không xác định được tài khoản")

    return {
        "id": user_id,
        "email": payload.get("email"),
        "token": token,
        "raw": payload,
    }
