"""Loopback MCP adapter. Each capability owns an independent Blender process/workdir."""
import asyncio,json,os,pathlib,re,uuid
from mcp.server.fastmcp import FastMCP
ROOT=pathlib.Path(__file__).resolve().parent.parent
DATA=pathlib.Path(os.environ.get('STUDIO_DATA_DIR',ROOT/'data')).resolve()
mcp=FastMCP('Asset Studio Blender',host='127.0.0.1',port=int(os.environ.get('BLENDER_MCP_PORT','33442')),stateless_http=True)
locks={}
def build_timeout_seconds():
    path=DATA/'runtime-settings.json'
    value=json.loads(path.read_text())['blenderBuildTimeoutSeconds'] if path.exists() else int(os.environ.get('BLENDER_BUILD_TIMEOUT_SECONDS','600'))
    if isinstance(value,bool) or not isinstance(value,int) or not 60<=value<=7200:raise ValueError('Invalid Blender build timeout setting')
    return value
def workspace(capability):
    if not re.fullmatch(r'[0-9a-f-]{36}',capability):raise ValueError('Invalid capability')
    marker=DATA/'capabilities'/f'{capability}.json'
    info=json.loads(marker.read_text())
    if info.get('cancelled'):raise ValueError('Build cancelled by user')
    dest=(DATA/info['directory']).resolve()
    if not dest.is_relative_to(DATA):raise ValueError('Invalid workspace')
    return dest
async def watch_cancellation(capability,proc):
    marker=DATA/'capabilities'/f'{capability}.json'
    while proc.returncode is None:
        await asyncio.sleep(.5)
        try:cancelled=json.loads(marker.read_text()).get('cancelled',False)
        except (FileNotFoundError,json.JSONDecodeError):continue
        if cancelled and proc.returncode is None:
            proc.kill()
            return
@mcp.tool()
async def get_scene_info(capability:str)->dict:
    """Read Blender version and existing export metrics for this authorized builder workspace."""
    dest=workspace(capability)
    proc=await asyncio.create_subprocess_exec(os.environ.get('BLENDER_BIN','blender'),'--version',stdout=asyncio.subprocess.PIPE)
    out,_=await proc.communicate()
    return {'version':out.decode().splitlines()[0],'directory':str(dest),'metrics':json.loads((dest/'metrics.json').read_text()) if (dest/'metrics.json').exists() else None,'clean_execution':True}
@mcp.tool()
async def execute_blender_code(capability:str,code:str)->dict:
    """Execute a complete asset build in an independent Blender process. Call finish_asset() last. bpy, math, random, Vector and OUTPUT_DIR are provided. Outputs: asset.glb, source.blend, metrics.json, front.png, rear.png, detail.png. No shared scene state."""
    dest=workspace(capability)
    info=json.loads((DATA/'capabilities'/f'{capability}.json').read_text())
    if info.get('role')=='photographer':raise ValueError('Photographer capabilities cannot execute build code')
    async with locks.setdefault(capability,asyncio.Lock()):
        workspace(capability)
        dest.mkdir(parents=True,exist_ok=True)
        helper=(ROOT/'blender'/'helpers.py').read_text()
        script=dest/f'build-{uuid.uuid4()}.py'
        script.write_text('OUTPUT_DIR = '+repr(str(dest))+'\n'+helper+'\n'+code)
        env={k:v for k,v in os.environ.items() if not any(s in k.upper() for s in ['TOKEN','SECRET','PASSWORD','API_KEY','CREDENTIAL'])}
        proc=await asyncio.create_subprocess_exec(os.environ.get('BLENDER_BIN','blender'),'-b','--threads','2','--python-exit-code','1','--python',str(script),cwd=dest,env=env,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
        monitor=asyncio.create_task(watch_cancellation(capability,proc))
        timeout=build_timeout_seconds()
        try:out,_=await asyncio.wait_for(proc.communicate(),timeout)
        except asyncio.TimeoutError:
            if proc.returncode is None:proc.kill()
            await proc.wait();return {'ok':False,'error':f'Blender exceeded {timeout} seconds'}
        except asyncio.CancelledError:
            if proc.returncode is None:proc.kill()
            await proc.wait()
            raise
        finally:
            monitor.cancel()
        (dest/'build.log').write_bytes(out)
        return {'ok':proc.returncode==0,'log':out.decode(errors='replace')[-(1200 if proc.returncode==0 else 6000):],'metrics':json.loads((dest/'metrics.json').read_text()) if proc.returncode==0 and (dest/'metrics.json').exists() else None}
@mcp.tool()
def get_render(capability:str,view:str='front')->dict:
    """Inspect a rendered image from this builder's workspace. view: front, rear, detail."""
    if view not in ['front','rear','detail']:raise ValueError('Unknown view')
    path=workspace(capability)/f'{view}.png'
    return {'view':view,'exists':path.exists(),'instruction':'Use the view_render vision tool with the same capability to inspect the pixels. Never encode image bytes as text.'}
@mcp.tool()
async def photograph_asset(capability:str,front_azimuth:float=-55,elevation:float=25,framing:float=1.2,exposure:float=0)->dict:
    """Render the exact authorized GLB in an isolated studio. No asset editing. Produces front/rear/detail and, for model review capabilities, left/right/top/bottom PNGs for view_render. Angles are degrees; framing 1.05–1.8; exposure -1–1."""
    import math
    dest=workspace(capability)
    info=json.loads((DATA/'capabilities'/f'{capability}.json').read_text())
    if info.get('role')!='photographer':raise ValueError('Photographer capability required')
    if not all(math.isfinite(v) for v in [front_azimuth,elevation,framing,exposure]) or not (-360<=front_azimuth<=360 and 5<=elevation<=75 and 1.05<=framing<=1.8 and -1<=exposure<=1):
        raise ValueError('Invalid camera or exposure settings')
    paths=info.get('assets') or [info['glb']]
    glbs=[(DATA/key).resolve() for key in paths]
    if any(not path.is_relative_to(DATA/'versions') or path.name!='asset.glb' for path in glbs):raise ValueError('Expected immutable archived GLB')
    glb=[{'path':str(path)} for path in glbs] if info.get('assets') else str(glbs[0])
    async with locks.setdefault(capability,asyncio.Lock()):
        workspace(capability)
        dest.mkdir(parents=True,exist_ok=True)
        script=dest/f'photograph-{uuid.uuid4()}.py'
        script.write_text((ROOT/'blender'/'photograph.py').read_text()+'\nphotograph('+','.join(repr(v) for v in [glb,str(dest),front_azimuth,elevation,framing,exposure,info.get("views")])+')\n')
        env={k:v for k,v in os.environ.items() if not any(s in k.upper() for s in ['TOKEN','SECRET','PASSWORD','API_KEY','CREDENTIAL'])}
        proc=await asyncio.create_subprocess_exec(os.environ.get('BLENDER_BIN','blender'),'-b','--threads','2','--python-exit-code','1','--python',str(script),cwd=dest,env=env,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
        monitor=asyncio.create_task(watch_cancellation(capability,proc))
        try:out,_=await asyncio.wait_for(proc.communicate(),840 if info.get("views") and len(info["views"])>3 else 360)
        except (asyncio.TimeoutError,asyncio.CancelledError):
            if proc.returncode is None:proc.kill()
            await proc.wait()
            raise
        finally:monitor.cancel()
        (dest/'photography.log').write_bytes(out)
        return {'ok':proc.returncode==0,'log':out.decode(errors='replace')[-(1200 if proc.returncode==0 else 6000):]}

if __name__=='__main__':mcp.run(transport='streamable-http')
