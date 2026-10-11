"""Loopback MCP adapter. Each capability owns an independent Blender process/workdir."""
import asyncio,json,os,pathlib,re,uuid,shutil,hashlib
from mcp.server.mcpserver import MCPServer
from starlette.responses import JSONResponse
try:
    from .workspace import prepare, save_script
except ImportError:
    from workspace import prepare, save_script
ROOT=pathlib.Path(__file__).resolve().parent.parent
DATA=pathlib.Path(os.environ.get('STUDIO_DATA_DIR',ROOT/'data')).resolve()
mcp=MCPServer('Asset Studio Blender')
locks={}
build_slots=asyncio.Semaphore(max(1,int(os.environ.get('BLENDER_CONCURRENCY','2'))))
def build_timeout_seconds():
    path=DATA/'runtime-settings.json'
    if path.exists():
        settings=json.loads(path.read_text())
        value=settings.get('timeouts',{}).get('blenderSeconds',settings.get('blenderBuildTimeoutSeconds',600))
    else:value=int(os.environ.get('BLENDER_BUILD_TIMEOUT_SECONDS','600'))
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
async def execute_blender_code(capability:str,code:str,preview:bool=False)->dict:
    """Execute a reproducible asset script. assetkit and finish_asset() are provided. preview=True makes cheap draft views; finish with preview=False to publish GLB/source/metrics. Inspect drafts using view_render views preview_front/preview_rear/preview_detail. Final builds retain pivots/hierarchy. No shared scene state."""
    return await run_saved_asset(capability,preview,code)


async def run_saved_asset(capability,preview=False,code=None):
    dest=workspace(capability)
    info=json.loads((DATA/'capabilities'/f'{capability}.json').read_text())
    if info.get('role')=='photographer':raise ValueError('Photographer capabilities cannot execute build code')
    async with locks.setdefault(capability,asyncio.Lock()),build_slots:
        workspace(capability)
        prepare(ROOT,DATA,dest,info)
        if code is None:
            if not (dest/'asset.py').exists():raise ValueError('Write asset.py before running it')
            code=(dest/'asset.py').read_text(encoding='utf-8')
        else:
            save_script(dest,code)
            code=(dest/'asset.py').read_text(encoding='utf-8')
        (dest/'build-state.json').write_text(json.dumps({'ok':False,'preview':preview,'state':'building'}))
        # Pin support code on first use so resumed sessions use the same helper API.
        snapshot=dest/'build-support'
        candidate=dest/('.candidate-'+str(uuid.uuid4()))
        shutil.copytree(snapshot,candidate)
        relocations={}
        # Copy only explicitly authorized baselines and dependencies into the source bundle.
        dependencies=json.loads((dest/'work-source.json').read_text()).get('dependencies',[])
        for index,path in enumerate(dict.fromkeys(info.get('inputs',[])+dependencies)):
            source=(DATA/path).resolve()
            if not source.is_relative_to(DATA):raise ValueError('Invalid build input')
            target=candidate/'inputs'/f'{index}{source.suffix}'
            target.parent.mkdir(exist_ok=True)
            shutil.copyfile(source,target)
            relocations[str(source).replace('\\','/')]=str(target.relative_to(candidate)).replace('\\','/')
            relocations[str(source)]=str(target.relative_to(candidate)).replace('\\','/')
            relocations[str(source).replace('\\','\\\\')]=str(target.relative_to(candidate)).replace('\\','/')
        if (dest/'textures').exists():shutil.copytree(dest/'textures',candidate/'textures')
        (candidate/'asset.py').write_bytes(code.encode('utf-8'))
        params=json.loads((dest/'params.json').read_text())
        shutil.copyfile(dest/'params.json',candidate/'params.json')
        (candidate/'build-config.json').write_text(json.dumps({'version':1,'directory':str(dest).replace('\\','/'),'directories':[str(dest).replace('\\','/'),str(dest).replace('\\','\\\\'),str(dest)],'preview':preview,'params':params,'relocations':relocations}),encoding='utf-8')
        script=candidate/'render.py'
        env={k:v for k,v in os.environ.items() if not any(s in k.upper() for s in ['TOKEN','SECRET','PASSWORD','API_KEY','CREDENTIAL'])}
        proc=await asyncio.create_subprocess_exec(os.environ.get('BLENDER_BIN','blender'),'-b','--factory-startup','--threads','2','--python-exit-code','1','--python',str(script),cwd=candidate,env=env,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
        monitor=asyncio.create_task(watch_cancellation(capability,proc))
        timeout=build_timeout_seconds()
        try:out,_=await asyncio.wait_for(proc.communicate(),timeout)
        except asyncio.TimeoutError:
            if proc.returncode is None:proc.kill()
            await proc.wait()
            (dest/'build-state.json').write_text(json.dumps({'ok':False,'preview':preview,'error':'timeout'}))
            shutil.rmtree(candidate)
            return {'ok':False,'error':f'Blender exceeded {timeout} seconds'}
        except asyncio.CancelledError:
            if proc.returncode is None:proc.kill()
            await proc.wait()
            shutil.rmtree(candidate)
            raise
        finally:
            monitor.cancel()
        (dest/'build.log').write_bytes(out)
        required=['metrics.json','front.png','rear.png','detail.png']+([] if preview else ['asset.glb','source.blend'])
        ok=proc.returncode==0 and all((candidate/f).exists() for f in required)
        state={'ok':ok,'preview':preview,'scriptSha256':hashlib.sha256(code.encode()).hexdigest()}
        output=dest/'preview' if preview else dest
        if ok:
            output.mkdir(exist_ok=True)
            names=required if preview else required+['asset.py','build-config.json','helpers.py','rebuild.py','render.py','params.json']
            for name in names:shutil.copyfile(candidate/name,output/name)
            if not preview:
                for path in [dest/'sprites.png',dest/'sprites.json',dest/'lods.json',*dest.glob('asset-lod-*.glb')]:path.unlink(missing_ok=True)
                for name in ['assetkit','inputs','textures']:
                    if (candidate/name).exists():shutil.copytree(candidate/name,dest/name,dirs_exist_ok=True)
                for name in ['sprites.png','sprites.json']:
                    if (candidate/name).exists():shutil.copyfile(candidate/name,dest/name)
                for path in candidate.glob('asset-lod-*.glb'):shutil.copyfile(path,dest/path.name)
                if (candidate/'lods.json').exists():shutil.copyfile(candidate/'lods.json',dest/'lods.json')
            (output/'state.json').write_text(json.dumps(state))
        (dest/'build-state.json').write_text(json.dumps(state))
        metrics=json.loads((candidate/'metrics.json').read_text()) if ok else None
        shutil.rmtree(candidate)
        return {'ok':ok,'preview':preview,'scriptSha256':state['scriptSha256'],'lastGoodRetained':not ok,'log':out.decode(errors='replace')[-(1200 if ok else 6000):],'metrics':metrics}


async def asset_workspace(input):
    capability=input.get('capability','')
    if not isinstance(capability,str):raise ValueError('Invalid capability')
    dest=workspace(capability)
    info=json.loads((DATA/'capabilities'/f'{capability}.json').read_text())
    if info.get('role')!='builder':raise ValueError('Builder workspace required')
    operation=input.get('operation')
    if operation=='run':
        mode=input.get('mode','quick')
        if mode not in ['quick','final']:raise ValueError('Unknown render mode')
        return await run_saved_asset(capability,mode=='quick')
    async with locks.setdefault(capability,asyncio.Lock()):
        workspace(capability)
        prepare(ROOT,DATA,dest,info)
        current=(dest/'asset.py').read_text(encoding='utf-8') if (dest/'asset.py').exists() else ''
        digest=hashlib.sha256(current.encode()).hexdigest()
        if operation=='read':
            offset,limit=input.get('offset',1),input.get('limit',120)
            if type(offset)!=int or type(limit)!=int or offset<1 or not 1<=limit<=200:raise ValueError('Invalid source line range')
            lines=current.splitlines()
            return {'file':'asset.py','sha256':digest,'totalLines':len(lines),'offset':offset,'content':'\n'.join(f'{i+offset}: {line}' for i,line in enumerate(lines[offset-1:offset-1+limit]))[:16000],'params':json.loads((dest/'params.json').read_text()),'state':json.loads((dest/'build-state.json').read_text()) if (dest/'build-state.json').exists() else None}
        if input.get('expectedSha256') and input['expectedSha256']!=digest:raise ValueError('Script changed; read the current source before editing')
        if operation=='write':
            code=input.get('code')
        elif operation=='edit':
            old,new=input.get('oldText'),input.get('newText')
            if not isinstance(old,str) or not old or not isinstance(new,str) or current.count(old)!=1:raise ValueError('Edit must match exactly one source occurrence')
            code=current.replace(old,new,1)
        else:raise ValueError('Unknown workspace operation')
        if not isinstance(code,str) or not code.strip() or len(code.encode())>200000:raise ValueError('Asset script must contain at most 200 KB of Python')
        return {'file':'asset.py','sha256':save_script(dest,code),'saved':True,'needsBuild':True}


@mcp.custom_route('/workspace',methods=['POST'])
async def workspace_http(request):
    # Native Eve tools call this fixed runner directly, outside the MCP protocol.
    if request.headers.get('origin') or not request.headers.get('content-type','').startswith('application/json'):
        return JSONResponse({'error':'Use the authorized workspace tools'},status_code=403)
    try:
        body=await request.body()
        if len(body)>1000000:raise ValueError('Workspace request is too large')
        input=json.loads(body)
        if not isinstance(input,dict):raise ValueError('Invalid workspace request')
        return JSONResponse(await asset_workspace(input))
    except (ValueError,FileNotFoundError) as error:
        return JSONResponse({'error':str(error)},status_code=400)
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

if __name__=='__main__':mcp.run(transport='streamable-http',host='127.0.0.1',port=int(os.environ.get('BLENDER_MCP_PORT','33442')),stateless_http=True)
