"""
Ultralight GPU Harness — injected into every GPU container at build time.

Wraps the developer's function with structured error handling, timing,
and VRAM measurement. Conforms to RunPod's serverless worker protocol.

Output contract (matches RunPodHarnessOutput in runpod.ts):
{
    "success": bool,
    "exit_code": "success" | "oom" | "timeout" | "exception" | "infra_error",
    "result": <any>,
    "duration_ms": float,
    "peak_vram_gb": float,
    "logs": [str],
    "error": {"type": str, "message": str, "traceback": str} | None
}
"""

import importlib
import io
import signal
import sys
import time
import traceback

import runpod


def get_peak_vram_gb():
    """Read peak GPU VRAM usage via torch.cuda if available."""
    try:
        import torch
        if torch.cuda.is_available():
            peak_bytes = torch.cuda.max_memory_allocated()
            torch.cuda.reset_peak_memory_stats()
            return round(peak_bytes / (1024 ** 3), 3)
    except ImportError:
        pass
    return 0.0


def reset_vram_stats():
    """Reset VRAM tracking before execution."""
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
    except ImportError:
        pass


def handler(event):
    """
    RunPod handler — receives input dict, returns structured result.

    Input format (from Ultralight platform):
    {
        "function": "function_name",   # Python function to call
        "args": { ... },               # Keyword arguments
        "max_duration_ms": 30000       # Execution timeout
    }
    """
    input_data = event.get("input", {})
    function_name = input_data.get("function", "main")
    args = input_data.get("args", {})
    max_duration_ms = input_data.get("max_duration_ms", 60000)

    # Capture stdout/stderr for logs
    captured = io.StringIO()
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    sys.stdout = captured
    sys.stderr = captured

    max_duration_s = max_duration_ms / 1000.0

    try:
        # Reset VRAM stats before execution
        reset_vram_stats()

        # Import developer module (main.py in the container)
        dev_module = importlib.import_module("main")
        func = getattr(dev_module, function_name, None)

        if func is None:
            sys.stdout = old_stdout
            sys.stderr = old_stderr
            return {
                "success": False,
                "exit_code": "exception",
                "result": None,
                "duration_ms": 0,
                "peak_vram_gb": 0.0,
                "logs": captured.getvalue().splitlines(),
                "error": {
                    "type": "AttributeError",
                    "message": f"Function '{function_name}' not found in main.py",
                },
            }

        # Set SIGALRM for hard timeout (Unix only, backup to RunPod's timeout)
        def timeout_handler(signum, frame):
            raise TimeoutError(
                f"Execution exceeded {max_duration_ms}ms limit"
            )

        signal.signal(signal.SIGALRM, timeout_handler)
        # Add 1s buffer to integer alarm (signal.alarm only takes int seconds)
        signal.alarm(int(max_duration_s) + 1)

        # Execute with timing
        start = time.perf_counter()
        if isinstance(args, dict):
            result = func(**args)
        elif isinstance(args, (list, tuple)):
            result = func(*args)
        else:
            result = func(args)
        duration_ms = (time.perf_counter() - start) * 1000

        # Cancel alarm
        signal.alarm(0)

        # Restore stdout/stderr
        sys.stdout = old_stdout
        sys.stderr = old_stderr

        return {
            "success": True,
            "exit_code": "success",
            "result": result,
            "duration_ms": round(duration_ms, 2),
            "peak_vram_gb": get_peak_vram_gb(),
            "logs": captured.getvalue().splitlines(),
        }

    except TimeoutError as e:
        signal.alarm(0)
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        return {
            "success": False,
            "exit_code": "timeout",
            "result": None,
            "duration_ms": max_duration_ms,
            "peak_vram_gb": get_peak_vram_gb(),
            "logs": captured.getvalue().splitlines(),
            "error": {
                "type": "TimeoutError",
                "message": str(e),
            },
        }

    except MemoryError as e:
        signal.alarm(0)
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        return {
            "success": False,
            "exit_code": "oom",
            "result": None,
            "duration_ms": 0,
            "peak_vram_gb": get_peak_vram_gb(),
            "logs": captured.getvalue().splitlines(),
            "error": {
                "type": "MemoryError",
                "message": str(e),
            },
        }

    except Exception as e:
        signal.alarm(0)
        sys.stdout = old_stdout
        sys.stderr = old_stderr

        # Detect CUDA OOM from exception message
        msg = str(e).lower()
        if "out of memory" in msg or "cuda" in msg and "memory" in msg:
            exit_code = "oom"
        else:
            exit_code = "exception"

        tb = ""
        try:
            tb = traceback.format_exc()
        except Exception:
            tb = "(traceback unavailable)"

        return {
            "success": False,
            "exit_code": exit_code,
            "result": None,
            "duration_ms": 0,
            "peak_vram_gb": get_peak_vram_gb(),
            "logs": captured.getvalue().splitlines(),
            "error": {
                "type": str(type(e).__name__),
                "message": str(e)[:1000],
                "traceback": tb[:2000],
            },
        }


# Start RunPod serverless worker
runpod.serverless.start({"handler": handler})
