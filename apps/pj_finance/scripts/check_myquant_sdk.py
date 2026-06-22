#!/usr/bin/env python3
"""Check whether the MyQuant Python SDK is importable in this interpreter."""

from __future__ import annotations

import importlib
import sys


REQUIRED_API_NAMES = ("set_token", "subscribe", "run", "MODE_LIVE")


def main() -> int:
    print(f"python: {sys.executable}")
    print(f"version: {sys.version.split()[0]}")

    try:
        gm = importlib.import_module("gm")
        api = importlib.import_module("gm.api")
    except Exception as exc:
        print("status: NOT_INSTALLED")
        print(f"error: {type(exc).__name__}: {exc}")
        print("hint: install the official MyQuant/掘金量化 Python SDK that provides `gm.api`.")
        return 3

    print(f"gm: {getattr(gm, '__file__', '<namespace>')}")
    print(f"gm.api: {getattr(api, '__file__', '<namespace>')}")

    missing = [name for name in REQUIRED_API_NAMES if not hasattr(api, name)]
    if missing:
        print("status: INCOMPLETE")
        print("missing: " + ", ".join(missing))
        return 4

    print("status: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
