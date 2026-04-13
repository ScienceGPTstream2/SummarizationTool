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
# Why 1 worker?  This app loads heavy Docling ML models (~1-2 GB) per process
# and relies on in-process asyncio semaphores for LLM rate-limit control.
# Multiple workers would duplicate model memory (→ OOM on 2 Gi) and fragment
# the semaphores (→ 4× the intended concurrent LLM calls).
#
# Horizontal scaling is handled by Azure Container Apps replicas (1-5).
# Each replica is one independent worker with its own semaphore and model copy.
# Gunicorn is kept (not bare uvicorn) for process supervision: it enforces
# --timeout on stuck requests and performs graceful shutdown on SIGTERM.
CMD ["sh", "-c", "gunicorn main:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers ${WORKERS:-1} \
    --bind 0.0.0.0:8001 \
    --timeout 300 \
    --graceful-timeout 30 \
    --access-logfile - \
    --error-logfile -"]
