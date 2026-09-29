"""Launch an authorized child using the configured provider; never print secrets."""
import os,sys,json,tomllib,pathlib
root=pathlib.Path.home()/'.codex'
env=os.environ.copy()
if not env.get('OPENAI_API_KEY'):
    auth=json.loads((root/'auth.json').read_text()) if (root/'auth.json').exists() else {}
    config=tomllib.loads((root/'config.toml').read_text())
    provider=config.get('model_providers',{}).get(config.get('model_provider'),{})
    key=auth.get('OPENAI_API_KEY') or env.get(provider.get('env_key',''))
    if not key: raise SystemExit('No configured API credential available')
    env['OPENAI_API_KEY']=key
    if provider.get('base_url'):env['OPENAI_BASE_URL']=provider['base_url']
os.execvpe(sys.argv[1],sys.argv[1:],env)
