"""Supervise local runtime services with shared .env settings."""

import argparse, os, pathlib, signal, subprocess, sys, time, urllib.request
from dotenv import load_dotenv

parser = argparse.ArgumentParser(description=__doc__)
modes = parser.add_mutually_exclusive_group()
modes.add_argument(
    "--preview",
    nargs=argparse.REMAINDER,
    metavar="COMMAND",
    help="restore local PostgreSQL and supervise a web command alongside the services",
)
modes.add_argument(
    "--production",
    action="store_true",
    help="migrate an external database and serve the production web build",
)
args = parser.parse_args()
if args.preview == []:
    parser.error(
        "--preview requires a web command, for example bun .output/server/index.mjs"
    )

ROOT = pathlib.Path(__file__).resolve().parent.parent
os.chdir(ROOT)
load_dotenv(ROOT / ".env")
# One local Eve process: reclaim interrupted inline steps promptly after restart.
os.environ.setdefault("WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS", "60")
logs = ROOT / "data" / "logs"
logs.mkdir(parents=True, exist_ok=True)
children = []
handles = []
stopping = False


def launch(name, command, cwd=ROOT):
    log = None
    if not args.production:
        log = open(logs / (name + ".log"), "a")
        handles.append(log)
    child = subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
    children.append(child)
    return child


def stop(_sig, _frame):
    global stopping
    stopping = True


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    if args.production:
        subprocess.run(["bun", "scripts/migrate.ts"], check=True)
    # VibePod restores the preview command after pod replacement, but Docker containers are ephemeral.
    if args.preview is not None:
        subprocess.run(
            ["docker", "compose", "-p", "studio", "up", "-d", "--wait"],
            check=True,
        )
    # HTTP health does not check sandbox images lost when Docker is restarted.
    subprocess.run(
        ["bun", "../node_modules/eve/bin/eve.js", "build"],
        cwd=ROOT / "eve",
        check=True,
    )
    launch("blender-mcp", [str(ROOT / ".venv/bin/python"), "blender/server.py"])
    eve = launch(
        "eve",
        [
            sys.executable,
            "../scripts/provider.py",
            "bun",
            "../node_modules/eve/bin/eve.js",
            "start",
            "--host",
            "127.0.0.1",
            "--port",
            "33441",
        ],
        ROOT / "eve",
    )
    ready = False
    for _ in range(120):
        if stopping or any(p.poll() is not None for p in children):
            break
        try:
            with urllib.request.urlopen(
                "http://127.0.0.1:33441/eve/v1/health", timeout=1
            ) as response:
                ready = response.status == 200
        except Exception:
            pass
        if ready:
            break
        time.sleep(0.5)
    if not ready:
        raise RuntimeError("Eve did not become ready; inspect data/logs/eve.log")
    launch("worker", ["bun", "scripts/worker.ts"])
    if args.preview is not None:
        launch("web", args.preview)
    elif args.production:
        launch("web", ["bun", ".output/server/index.mjs"])
    while not stopping:
        if any(p.poll() is not None for p in children):
            raise RuntimeError("A runtime service exited; inspect data/logs")
        time.sleep(1)
finally:
    for p in reversed(children):
        if p.poll() is None:
            p.terminate()
    for p in children:
        try:
            p.wait(timeout=15)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
    for handle in handles:
        handle.close()
