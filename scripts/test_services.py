"""Sandbox provisioning must finish before services can consume queued jobs."""

import pathlib
import runpy
import signal
import subprocess
import sys
import unittest
from unittest.mock import MagicMock, patch


class ServicesTests(unittest.TestCase):
    def setUp(self):
        argv = patch.object(sys, "argv", ["services.py"])
        argv.start()
        self.addCleanup(argv.stop)

    def test_worker_starts_only_after_build_and_http_readiness(self):
        handlers = {
            sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)
        }
        calls = []

        def launch(command, **_kwargs):
            calls.append(command)
            child = MagicMock()
            child.poll.return_value = 0 if command[-1] == "scripts/worker.ts" else None
            return child

        try:
            with (
                patch(
                    "subprocess.run",
                    side_effect=lambda command, **_kwargs: calls.append(command),
                ),
                patch("subprocess.Popen", side_effect=launch),
                patch("urllib.request.urlopen") as health,
            ):
                health.return_value.__enter__.return_value.status = 200
                with self.assertRaisesRegex(RuntimeError, "A runtime service exited"):
                    runpy.run_path(str(pathlib.Path(__file__).with_name("services.py")))
                self.assertEqual(
                    calls[0], ["bun", "../node_modules/eve/bin/eve.js", "build"]
                )
                self.assertEqual(calls[-1], ["bun", "scripts/worker.ts"])
                health.assert_called_once()
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)

    def test_failed_provisioning_never_launches_a_worker(self):
        handlers = {
            sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)
        }
        try:
            with (
                patch(
                    "subprocess.run",
                    side_effect=subprocess.CalledProcessError(1, "eve build"),
                ) as build,
                patch("subprocess.Popen") as launch,
            ):
                with self.assertRaises(subprocess.CalledProcessError):
                    runpy.run_path(str(pathlib.Path(__file__).with_name("services.py")))
                self.assertEqual(
                    build.call_args.args[0],
                    ["bun", "../node_modules/eve/bin/eve.js", "build"],
                )
                self.assertTrue(build.call_args.kwargs["check"])
                launch.assert_not_called()
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)

    def test_preview_restores_database_before_build_and_serves_after_eve_is_ready(self):
        handlers = {
            sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)
        }
        calls = []
        children = []
        web = ["bun", "/saved-build/server/index.mjs", "--port=43505"]

        def launch(command, **_kwargs):
            calls.append(command)
            child = MagicMock()
            child.poll.return_value = 0 if command == web else None
            children.append(child)
            return child

        def ready(*_args, **_kwargs):
            calls.append("eve ready")
            response = MagicMock()
            response.__enter__.return_value.status = 200
            return response

        try:
            with (
                patch.object(sys, "argv", ["services.py", "--preview", *web]),
                patch(
                    "subprocess.run",
                    side_effect=lambda command, **_kwargs: calls.append(command),
                ),
                patch("subprocess.Popen", side_effect=launch),
                patch("urllib.request.urlopen", side_effect=ready),
            ):
                with self.assertRaisesRegex(RuntimeError, "A runtime service exited"):
                    runpy.run_path(str(pathlib.Path(__file__).with_name("services.py")))
            self.assertEqual(
                calls[:2],
                [
                    ["docker", "compose", "-p", "studio", "up", "-d", "--wait"],
                    ["bun", "../node_modules/eve/bin/eve.js", "build"],
                ],
            )
            self.assertEqual(
                calls[-3:], ["eve ready", ["bun", "scripts/worker.ts"], web]
            )
            for child in children[:-1]:
                child.terminate.assert_called_once()
                child.wait.assert_called_once_with(timeout=15)
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)

    def test_unavailable_database_never_starts_the_web_or_worker(self):
        handlers = {
            sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)
        }
        try:
            with (
                patch.object(
                    sys, "argv", ["services.py", "--preview", "bun", "server.mjs"]
                ),
                patch(
                    "subprocess.run",
                    side_effect=subprocess.CalledProcessError(1, "docker compose"),
                ) as compose,
                patch("subprocess.Popen") as launch,
            ):
                with self.assertRaises(subprocess.CalledProcessError):
                    runpy.run_path(str(pathlib.Path(__file__).with_name("services.py")))
                self.assertEqual(
                    compose.call_args.args[0],
                    ["docker", "compose", "-p", "studio", "up", "-d", "--wait"],
                )
                self.assertTrue(compose.call_args.kwargs["check"])
                launch.assert_not_called()
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)

    def test_preview_requires_a_web_command_before_starting_services(self):
        with (
            patch.object(sys, "argv", ["services.py", "--preview"]),
            patch("subprocess.run") as run,
        ):
            with self.assertRaises(SystemExit) as error:
                runpy.run_path(str(pathlib.Path(__file__).with_name("services.py")))
            self.assertEqual(error.exception.code, 2)
            run.assert_not_called()

    def test_production_migrates_before_starting_and_does_not_require_docker(self):
        handlers = {
            sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)
        }
        calls = []
        web = ["bun", ".output/server/index.mjs"]

        def launch(command, **_kwargs):
            calls.append(command)
            child = MagicMock()
            child.poll.return_value = 0 if command == web else None
            return child

        try:
            with (
                patch.object(sys, "argv", ["services.py", "--production"]),
                patch(
                    "subprocess.run",
                    side_effect=lambda command, **_kwargs: calls.append(command),
                ),
                patch("subprocess.Popen", side_effect=launch),
                patch("urllib.request.urlopen") as health,
            ):
                health.return_value.__enter__.return_value.status = 200
                with self.assertRaisesRegex(RuntimeError, "A runtime service exited"):
                    runpy.run_path(str(pathlib.Path(__file__).with_name("services.py")))
            self.assertEqual(
                calls[:2],
                [
                    ["bun", "scripts/migrate.ts"],
                    ["bun", "../node_modules/eve/bin/eve.js", "build"],
                ],
            )
            self.assertEqual(calls[-2:], [["bun", "scripts/worker.ts"], web])
            self.assertFalse(any(command[0] == "docker" for command in calls))
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)

    def test_failed_production_migration_never_starts_services(self):
        handlers = {
            sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)
        }
        try:
            with (
                patch.object(sys, "argv", ["services.py", "--production"]),
                patch(
                    "subprocess.run",
                    side_effect=subprocess.CalledProcessError(1, "migrate"),
                ),
                patch("subprocess.Popen") as launch,
            ):
                with self.assertRaises(subprocess.CalledProcessError):
                    runpy.run_path(str(pathlib.Path(__file__).with_name("services.py")))
                launch.assert_not_called()
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)


if __name__ == "__main__":
    unittest.main()
