"""Launch an authorized child using the configured provider; never print secrets."""

import json
import os
import pathlib
import sys
import tomllib

root = pathlib.Path.home() / ".codex"
env = os.environ.copy()
if not env.get("OPENAI_API_KEY"):
    auth_file = root / "auth.json"
    config_file = root / "config.toml"
    auth = json.loads(auth_file.read_text()) if auth_file.exists() else {}
    config = tomllib.loads(config_file.read_text()) if config_file.exists() else {}
    provider = config.get("model_providers", {}).get(config.get("model_provider"), {})
    key = auth.get("OPENAI_API_KEY") or env.get(provider.get("env_key", ""))
    if not key:
        raise SystemExit("No configured API credential available")
    env["OPENAI_API_KEY"] = key
    if provider.get("base_url"):
        env["OPENAI_BASE_URL"] = provider["base_url"]
os.execvpe(sys.argv[1], sys.argv[1:], env)
