"""Sandbox provisioning must finish before services can consume queued jobs."""
import pathlib
import runpy
import signal
import subprocess
import unittest
from unittest.mock import MagicMock, patch


class ServicesTests(unittest.TestCase):
    def test_worker_starts_only_after_build_and_http_readiness(self):
        handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
        calls = []
        def launch(command, **_kwargs):
            calls.append(command)
            child = MagicMock()
            child.poll.return_value = 0 if command[-1] == 'scripts/worker.ts' else None
            return child
        try:
            with patch('subprocess.run', side_effect=lambda command, **_kwargs: calls.append(command)), patch('subprocess.Popen', side_effect=launch), patch('urllib.request.urlopen') as health:
                health.return_value.__enter__.return_value.status = 200
                with self.assertRaisesRegex(RuntimeError, 'A runtime service exited'):
                    runpy.run_path(str(pathlib.Path(__file__).with_name('services.py')))
                self.assertEqual(calls[0], ['bun', '../node_modules/eve/bin/eve.js', 'build'])
                self.assertEqual(calls[-1], ['bun', 'scripts/worker.ts'])
                health.assert_called_once()
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)

    def test_failed_provisioning_never_launches_a_worker(self):
        handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
        try:
            with patch('subprocess.run', side_effect=subprocess.CalledProcessError(1, 'eve build')) as build, patch('subprocess.Popen') as launch:
                with self.assertRaises(subprocess.CalledProcessError):
                    runpy.run_path(str(pathlib.Path(__file__).with_name('services.py')))
                self.assertEqual(build.call_args.args[0], ['bun', '../node_modules/eve/bin/eve.js', 'build'])
                self.assertTrue(build.call_args.kwargs['check'])
                launch.assert_not_called()
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)


if __name__ == '__main__':
    unittest.main()
