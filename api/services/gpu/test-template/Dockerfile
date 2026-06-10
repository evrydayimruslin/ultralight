# Ultralight GPU Base Template — Phase 2
# Shared base image for all GPU apps. Developer code is downloaded
# at container startup from R2 via the platform code proxy.
#
# Build: docker build -t <your-registry>/ultralight-gpu-base:latest .
# Push:  docker push <your-registry>/ultralight-gpu-base:latest

FROM python:3.11-slim-bookworm

RUN pip install --no-cache-dir runpod

# Baked-in main.py is the fallback test code (used when ULTRALIGHT_CODE_URL is not set)
COPY main.py /app/main.py
COPY harness.py /app/harness.py

WORKDIR /app

CMD ["python", "-u", "/app/harness.py"]
