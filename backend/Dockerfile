# backend/Dockerfile
# Backend MedParcours AI — FastAPI + rule engine + ECG/document extraction
FROM python:3.11-slim

# Cài đặt thư viện hệ thống cần thiết cho opencv-python-headless (libGL...)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements và cài đặt (Tận dụng Docker cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ code backend vào container
COPY . .

EXPOSE 8000

# Chạy server FastAPI
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
