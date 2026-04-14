FROM python:3.11-slim AS builder

WORKDIR /app

# Install system dependencies needed for building Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt
RUN pip install --no-cache-dir --prefix=/install gunicorn

# --- Runtime stage ---
FROM python:3.11-slim

WORKDIR /app

# Install only runtime system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY . .

# Create directories for uploads and output
RUN mkdir -p uploads output files

# Expose the backend port
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8001/api/server/health || exit 1

# Run with Gunicorn + a single UvicornWorker.
#
# Docling has been extracted to a separate Container App (docling-service)
# so this image is lightweight (~500 MB, no PyTorch/ONNX).
# The backend calls docling-service over HTTP via DOCLING_SERVICE_URL.
#
# Horizontal scaling is handled by Azure Container Apps replicas (1-5).
# Gunicorn is kept for process supervision: it enforces --timeout on stuck
# requests and performs graceful shutdown on SIGTERM.
CMD ["sh", "-c", "gunicorn main:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers ${WORKERS:-1} \
    --bind 0.0.0.0:8001 \
    --timeout 300 \
    --graceful-timeout 30 \
    --access-logfile - \
    --error-logfile -"]
