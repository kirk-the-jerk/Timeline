#!/usr/bin/env python3
import argparse
import os
import signal
import socket
import subprocess
import sys
import time
from contextlib import suppress
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8000
ROOT = Path(__file__).resolve().parent.parent
VSCODE_DIR = ROOT / ".vscode"
PID_FILE = VSCODE_DIR / "timeline-server.pid"
LOG_FILE = VSCODE_DIR / "timeline-server.log"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--restart", action="store_true")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--stop", action="store_true")
    args = parser.parse_args()

    if args.restart:
        return restart_server()

    if args.serve:
        return serve()

    if args.stop:
        stop_previous_server()
        print("Stopped Timeline POC server.")
        return 0

    parser.print_help()
    return 2


def restart_server():
    VSCODE_DIR.mkdir(exist_ok=True)
    stop_previous_server()

    with LOG_FILE.open("ab") as log:
        kwargs = {
            "cwd": ROOT,
            "stdout": log,
            "stderr": subprocess.STDOUT,
        }

        if os.name == "nt":
            kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True

        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--serve"], **kwargs)

    if wait_until_ready(child):
        print(f"Serving Timeline POC at http://{HOST}:{PORT}/")
        return 0

    if is_port_open():
        print(f"Using existing server at http://{HOST}:{PORT}/")
        return 0

    print(f"Server did not start. Check {LOG_FILE}.", file=sys.stderr)
    print_log_tail()
    return 1


class NoCacheHandler(SimpleHTTPRequestHandler):
    # Without this the browser heuristically caches ES modules, so an edited
    # src/*.js can be served stale next to a fresh one and fail import checks.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve():
    os.chdir(ROOT)
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")

    try:
        ThreadingHTTPServer.allow_reuse_address = True
        with ThreadingHTTPServer((HOST, PORT), NoCacheHandler) as httpd:
            print(f"Serving Timeline POC at http://{HOST}:{PORT}/", flush=True)
            httpd.serve_forever()
    finally:
        remove_pid_file_for_current_process()


def stop_previous_server():
    pid = read_pid()
    if pid is None or pid == os.getpid():
        return

    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        with suppress(ProcessLookupError, PermissionError, OSError):
            os.kill(pid, signal.SIGTERM)

    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if not process_exists(pid):
            remove_pid_file()
            return
        time.sleep(0.1)

    if hasattr(signal, "SIGKILL"):
        with suppress(ProcessLookupError, PermissionError, OSError):
            os.kill(pid, signal.SIGKILL)

    remove_pid_file()


def wait_until_ready(child):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if child.poll() is not None:
            return False
        try:
            with socket.create_connection((HOST, PORT), timeout=0.25):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def is_port_open():
    try:
        with socket.create_connection((HOST, PORT), timeout=0.25):
            return True
    except OSError:
        return False


def read_pid():
    try:
        return int(PID_FILE.read_text(encoding="utf-8").strip())
    except (FileNotFoundError, ValueError):
        return None


def process_exists(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def print_log_tail():
    try:
        lines = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
    except FileNotFoundError:
        return

    print("--- timeline-server.log tail ---", file=sys.stderr)
    for line in lines[-20:]:
        print(line, file=sys.stderr)


def remove_pid_file_for_current_process():
    if read_pid() == os.getpid():
        remove_pid_file()


def remove_pid_file():
    try:
        PID_FILE.unlink()
    except FileNotFoundError:
        pass


if __name__ == "__main__":
    raise SystemExit(main())
