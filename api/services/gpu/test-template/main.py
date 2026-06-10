"""
Ultralight GPU Test Functions — Phase 1 smoke test.

These functions exercise the harness contract without needing a real GPU.
Used to validate the full pipeline: upload → build → deploy → call → billing.
"""

import time
import math


def hello(name="World"):
    """Simple echo test — verifies basic function dispatch."""
    return f"Hello {name} from Ultralight GPU!"


def add(a=0, b=0):
    """Arithmetic test — verifies kwargs passing."""
    return {"sum": a + b, "a": a, "b": b}


def slow(duration_ms=1000):
    """Duration test — verifies timing and billing calculation."""
    seconds = duration_ms / 1000.0
    time.sleep(seconds)
    return {"slept_ms": duration_ms}


def compute(n=1000000):
    """CPU-bound test — verifies real compute timing."""
    total = 0.0
    for i in range(n):
        total += math.sqrt(i)
    return {"n": n, "result": round(total, 4)}


def fail():
    """Exception test — verifies error handling and exit_code classification."""
    raise ValueError("Intentional test failure")


def echo(**kwargs):
    """Echo all args back — verifies arbitrary kwargs passing."""
    return kwargs
