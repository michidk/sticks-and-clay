"""Exercise provider setup with private temporary configuration and no API calls."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PROVIDER = Path(__file__).with_name("provider.py")


class ProviderTests(unittest.TestCase):
    def test_auth_key_works_without_codex_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".codex").mkdir()
            (root / ".codex" / "auth.json").write_text(
                json.dumps({"OPENAI_API_KEY": "fixture-api-key"})
            )
            environment = {
                k: v
                for k, v in os.environ.items()
                if k not in ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME"]
            }
            environment["HOME"] = directory
            result = subprocess.run(
                [
                    sys.executable,
                    str(PROVIDER),
                    sys.executable,
                    "-c",
                    "import os;assert os.environ['OPENAI_API_KEY']=='fixture-api-key'",
                ],
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_credentials_report_an_actionable_error(self):
        with tempfile.TemporaryDirectory() as directory:
            environment = {
                k: v
                for k, v in os.environ.items()
                if k not in ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME"]
            }
            environment["HOME"] = directory
            result = subprocess.run(
                [sys.executable, str(PROVIDER), sys.executable, "-c", "pass"],
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(
                result.stderr.strip(), "No configured API credential available"
            )


if __name__ == "__main__":
    unittest.main()
