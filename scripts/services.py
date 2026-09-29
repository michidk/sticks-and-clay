"""Supervise local runtime services with shared .env settings."""
import os,pathlib,signal,subprocess,time,urllib.request
from dotenv import load_dotenv
ROOT=pathlib.Path(__file__).resolve().parent.parent
os.chdir(ROOT);load_dotenv(ROOT/'.env')
logs=ROOT/'data'/'logs';logs.mkdir(parents=True,exist_ok=True)
children=[];handles=[];stopping=False
def launch(name,command,cwd=ROOT):
    log=open(logs/(name+'.log'),'a');handles.append(log)
    child=subprocess.Popen(command,cwd=cwd,stdout=log,stderr=subprocess.STDOUT);children.append(child);return child
def stop(_sig,_frame):
    global stopping
    stopping=True
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
try:
    launch('blender-mcp',[str(ROOT/'.venv/bin/python'),'blender/server.py'])
    eve=launch('eve',['python3','../scripts/provider.py','../node_modules/.bin/eve','start','--host','127.0.0.1','--port','33441'],ROOT/'eve')
    ready=False
    for _ in range(120):
        if stopping or any(p.poll() is not None for p in children):break
        try:
            with urllib.request.urlopen('http://127.0.0.1:33441/eve/v1/health',timeout=1) as response:ready=response.status==200
        except Exception:pass
        if ready:break
        time.sleep(.5)
    if not ready:raise RuntimeError('Eve did not become ready; inspect data/logs/eve.log')
    launch('worker',['bun','scripts/worker.ts'])
    while not stopping:
        if any(p.poll() is not None for p in children):raise RuntimeError('A runtime service exited; inspect data/logs')
        time.sleep(1)
finally:
    for p in reversed(children):
        if p.poll() is None:p.terminate()
    for p in children:
        try:p.wait(timeout=15)
        except subprocess.TimeoutExpired:p.kill();p.wait()
    for handle in handles:handle.close()
