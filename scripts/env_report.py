"""Print the facts docs/model-card.md needs about this machine: OS, Python,
CPU, RAM, disk, GPU/VRAM/driver, and the local Ollama install and models.
Uses only the standard library and local commands; makes no network calls
except to Ollama on 127.0.0.1.

    python scripts/env_report.py
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import urllib.request


def run(cmd: list[str]) -> str:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        return (out.stdout or out.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as exc:
        return f"unavailable ({exc.__class__.__name__})"


def ram_gb() -> str:
    try:
        if sys.platform.startswith("linux"):
            with open("/proc/meminfo") as f:
                kb = int(next(l for l in f if l.startswith("MemTotal")).split()[1])
            return f"{kb / 1024 / 1024:.1f} GB"
        if sys.platform == "win32":
            import ctypes

            class MEM(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong),
                            ("ullAvailPhys", ctypes.c_ulonglong), ("a", ctypes.c_ulonglong), ("b", ctypes.c_ulonglong),
                            ("c", ctypes.c_ulonglong), ("d", ctypes.c_ulonglong), ("e", ctypes.c_ulonglong)]
            m = MEM()
            m.dwLength = ctypes.sizeof(MEM)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return f"{m.ullTotalPhys / 1024**3:.1f} GB"
        if sys.platform == "darwin":
            return f"{int(run(['sysctl', '-n', 'hw.memsize'])) / 1024**3:.1f} GB"
    except Exception as exc:  # noqa: BLE001
        return f"unknown ({exc.__class__.__name__})"
    return "unknown"


def environment_kind() -> str:
    if sys.platform.startswith("linux"):
        rel = platform.release().lower()
        if "microsoft" in rel or "wsl" in rel:
            return "WSL"
        if os.path.exists("/.dockerenv"):
            return "container"
    return "native"


def main() -> None:
    print("os:", platform.platform(), f"[{environment_kind()}]")
    print("python:", sys.version.split()[0], sys.executable)
    print("cpu:", platform.processor() or platform.machine(), f"{os.cpu_count()} logical cores")
    print("ram:", ram_gb())
    total, _, free = shutil.disk_usage(os.getcwd())
    print(f"disk (cwd): {free / 1024**3:.1f} GB free of {total / 1024**3:.1f} GB")
    if shutil.which("nvidia-smi"):
        print("gpu:", run(["nvidia-smi", "--query-gpu=name,memory.total,memory.used,driver_version", "--format=csv,noheader"]))
        print("cuda (driver):", next((l.strip() for l in run(["nvidia-smi"]).splitlines() if "CUDA Version" in l), "unknown"))
    else:
        print("gpu: nvidia-smi not found (no NVIDIA driver visible)")
    print("ollama:", run(["ollama", "--version"]) if shutil.which("ollama") else "not installed")
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=3) as r:
            for m in json.load(r).get("models", []):
                d = m.get("details", {})
                print(f"  model {m['name']}: {m.get('size', 0) / 1024**3:.2f} GB, {d.get('parameter_size')}, {d.get('quantization_level')}")
    except OSError:
        print("  ollama server not reachable on 127.0.0.1:11434")
    if shutil.which("ollama"):
        print("  ollama ps:", run(["ollama", "ps"]))


if __name__ == "__main__":
    main()
