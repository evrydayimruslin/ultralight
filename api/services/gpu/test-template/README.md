# Ultralight GPU Base Worker

Shared base image for all Ultralight GPU apps. Developer code is downloaded
at container startup from R2 via the platform code proxy.

## What's inside

- `harness.py` — Platform harness that downloads developer code, installs deps, then wraps functions with structured error handling, timing, and VRAM measurement
- `main.py` — Fallback test functions (used when `ULTRALIGHT_CODE_URL` is not set)
- `Dockerfile` — Python 3.11 + RunPod SDK + harness

## How it works

1. Container starts → `harness.py` runs
2. If `ULTRALIGHT_CODE_URL` is set (per-app template), downloads code bundle from platform proxy
3. Writes developer files to `/app/`, installs `requirements.txt` if present
4. Starts RunPod serverless worker loop
5. Each request: imports `main.py`, calls the specified function, returns structured result

## Environment variables (set per-app via RunPod template)

| Var | Purpose |
|-----|---------|
| `ULTRALIGHT_CODE_URL` | Platform proxy URL for code bundle download |
| `ULTRALIGHT_PLATFORM_SECRET` | Auth header for code proxy |
| `ULTRALIGHT_APP_ID` | App ID for logging |
| `ULTRALIGHT_VERSION` | Version for logging |

## Test functions (fallback)

| Function | Args | Purpose |
|----------|------|---------|
| `hello` | `name="World"` | Basic function dispatch |
| `add` | `a=0, b=0` | Kwargs passing |
| `slow` | `duration_ms=1000` | Timing/billing verification |
| `compute` | `n=1000000` | CPU-bound compute timing |
| `fail` | none | Error handling / exit_code classification |
| `echo` | `**kwargs` | Arbitrary kwargs passthrough |

## Deployment

Connected to RunPod via GitHub integration. RunPod builds the Docker image automatically.
Set the resulting image name as `RUNPOD_BASE_IMAGE` in the platform env.
