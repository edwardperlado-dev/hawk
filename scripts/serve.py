"""Run the local demo and terminate all children together."""

import os
import signal
import subprocess
import sys
import time

from backend.store import initialize


def main():
    initialize()
    api_port = os.environ.get("HAWK_API_PORT", "8000")
    web_port = os.environ.get("HAWK_WEB_PORT", "3000")
    os.environ.setdefault("HAWK_API", f"http://127.0.0.1:{api_port}")
    os.environ.setdefault("HAWK_ORIGINS", f"http://localhost:{web_port},http://127.0.0.1:{web_port}")
    processes = []
    web_mode = os.environ.get("HAWK_WEB_MODE", "dev")
    reload_api = ["--reload", "--reload-dir", "backend"] if web_mode == "dev" else []
    commands = [
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.api:app",
            "--host",
            "127.0.0.1",
            "--port",
            api_port,
            *reload_api,
        ],
        [sys.executable, "-m", "backend.worker"],
        [
            "npm",
            "--prefix",
            "web",
            "run",
            web_mode,
            "--",
            "--hostname",
            "127.0.0.1",
            "--port",
            web_port,
        ],
    ]
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        for cmd in commands:
            processes.append(subprocess.Popen(cmd, start_new_session=True))
        while all(p.poll() is None for p in processes):
            time.sleep(0.5)
        return next((p.returncode for p in processes if p.returncode), 0)
    except KeyboardInterrupt:
        return 0
    finally:
        for p in processes:
            if p.poll() is None:
                os.killpg(p.pid, signal.SIGTERM)
        for p in processes:
            p.wait()


if __name__ == "__main__":
    sys.exit(main())
