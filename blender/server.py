"""Loopback MCP adapter. Each capability owns an independent Blender process/workdir."""
import asyncio,json,os,pathlib,re,uuid,shutil,hashlib,sys
from mcp.server.mcpserver import MCPServer
from starlette.responses import JSONResponse
try:
    from .workspace import prepare, save_script
    from .build_artifacts import receipt, publish_workspace, recover_workspace, committed_directory
except ImportError:
    from workspace import prepare, save_script
    from build_artifacts import receipt, publish_workspace, recover_workspace, committed_directory
ROOT=pathlib.Path(__file__).resolve().parent.parent
DATA=pathlib.Path(os.environ.get('STUDIO_DATA_DIR',ROOT/'data')).resolve()
mcp=MCPServer('Asset Studio Blender')
locks={}
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
    dest.mkdir(parents=True,exist_ok=True)
    proc=await asyncio.create_subprocess_exec(sys.executable,str(ROOT/'blender'/'build_runtime.py'),'--cwd',str(dest),'--timeout',str(build_timeout_seconds()),'--',os.environ.get('BLENDER_BIN','blender'),'--version',stdout=asyncio.subprocess.PIPE)
    out,_=await proc.communicate()
    current=committed_directory(dest)
    catalogs={}
    for name,location in [('final',current),('quick',committed_directory(dest/'preview'))]:
        if (location/'build-receipt.json').exists():
            record=json.loads((location/'build-receipt.json').read_text())
            catalogs[name]={'buildId':record['buildId'],'artifacts':record['artifacts']}
    return {'version':next((line for line in out.decode().splitlines() if line.startswith('Blender ')), 'Unavailable'),'directory':str(dest),'metrics':json.loads((current/'metrics.json').read_text()) if (current/'metrics.json').exists() else None,'builds':catalogs,'clean_execution':True}
@mcp.tool()
async def execute_blender_code(capability:str,code:str,preview:bool=False)->dict:
    """Execute a reproducible asset script. assetkit and finish_asset() are provided. preview=True makes cheap draft views; finish with preview=False to publish GLB/source/metrics. Inspect drafts using view_render views preview_front/preview_rear/preview_detail. Final builds retain pivots/hierarchy. No shared scene state."""
    return await run_saved_asset(capability,preview,code)


async def run_saved_asset(capability,preview=False,code=None):
    dest=workspace(capability)
    info=json.loads((DATA/'capabilities'/f'{capability}.json').read_text())
    if info.get('role')=='photographer':raise ValueError('Photographer capabilities cannot execute build code')
    async with locks.setdefault(capability,asyncio.Lock()):
        workspace(capability)
        recover_workspace(dest)
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
        proc=await asyncio.create_subprocess_exec(sys.executable,str(ROOT/'blender'/'build_runtime.py'),'--cwd',str(dest),'--timeout',str(build_timeout_seconds()),'--',os.environ.get('BLENDER_BIN','blender'),'-b','--factory-startup','--threads','2','--python-exit-code','1','--python',str(script),cwd=candidate,env=env,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
        monitor=asyncio.create_task(watch_cancellation(capability,proc))
        timeout=build_timeout_seconds()
        try:out,_=await asyncio.wait_for(proc.communicate(),timeout+5)
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
            if not preview:
                if (dest/'script-revisions').exists():shutil.copytree(dest/'script-revisions',candidate/'script-revisions')
                if (dest/'build-request.json').exists():shutil.copyfile(dest/'build-request.json',candidate/'build-request.json')
            names=required if preview else required+['build-config.json','helpers.py','rebuild.py','render.py','build_runtime.py','build_artifacts.py','params.json','assetkit','inputs','textures']
            names=[name for name in names if (candidate/name).exists()]
            for pattern in ('frame-*.png','review-*-f*-d*.png','sprite-checks.json','sprites.png','sprites.json','asset-lod-*.glb','lods.json'):
                names.extend(path.name for path in candidate.glob(pattern))
            receipt(candidate,'model','quick' if preview else 'final',state['scriptSha256'],{'runner':str(json.loads((dest/'work-source.json').read_text()).get('runnerProtocol',3))})
            (candidate/'state.json').write_text(json.dumps(state))
            publish_workspace(candidate,output,sorted(set(names+['build-receipt.json','state.json'])))
        (dest/'build-state.json').write_text(json.dumps(state))
        metrics=json.loads((candidate/'metrics.json').read_text()) if ok else None
        shutil.rmtree(candidate)
        return {'ok':ok,'preview':preview,'scriptSha256':state['scriptSha256'],'lastGoodRetained':not ok and all((output/f).is_file() for f in required),'log':out.decode(errors='replace')[-(1200 if ok else 6000):],'metrics':metrics}


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
        recover_workspace(dest)
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
        recover_workspace(dest)
        candidate=dest/('.candidate-'+str(uuid.uuid4()));candidate.mkdir()
        (dest/'build-state.json').write_text(json.dumps({'ok':False,'state':'building'}))
        script=candidate/'photograph.py'
        script.write_text((ROOT/'blender'/'photograph.py').read_text()+'\nphotograph('+','.join(repr(v) for v in [glb,str(candidate),front_azimuth,elevation,framing,exposure,info.get("views")])+')\n')
        env={k:v for k,v in os.environ.items() if not any(s in k.upper() for s in ['TOKEN','SECRET','PASSWORD','API_KEY','CREDENTIAL'])}
        # Photography renders multiple full-quality views in one process.
        timeout=build_timeout_seconds()*(7 if len(info.get('views') or [])>3 else 3)
        proc=await asyncio.create_subprocess_exec(sys.executable,str(ROOT/'blender'/'build_runtime.py'),'--cwd',str(dest),'--timeout',str(timeout),'--',os.environ.get('BLENDER_BIN','blender'),'-b','--threads','2','--python-exit-code','1','--python',str(script),cwd=dest,env=env,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
        monitor=asyncio.create_task(watch_cancellation(capability,proc))
        try:out,_=await asyncio.wait_for(proc.communicate(),timeout+5)
        except (asyncio.TimeoutError,asyncio.CancelledError):
            if proc.returncode is None:proc.kill()
            await proc.wait()
            (dest/'build-state.json').write_text(json.dumps({'ok':False,'state':'failed'}))
            shutil.rmtree(candidate,ignore_errors=True)
            raise
        finally:monitor.cancel()
        (dest/'photography.log').write_bytes(out)
        ok=proc.returncode==0 and (candidate/'photography.json').exists()
        if ok:
            manifest=json.loads((candidate/'photography.json').read_text())
            for view,digest in manifest.get('images',{}).items():
                path=candidate/(view+'.png')
                if not re.fullmatch(r'[a-z]+',view) or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise ValueError('Invalid photograph receipt')
            receipt(candidate,'photography','final',hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest(),{'runner':'2'})
            publish_workspace(candidate,dest,[path.name for path in candidate.iterdir() if path.suffix=='.png']+['photography.json','build-receipt.json'])
        (dest/'build-state.json').write_text(json.dumps({'ok':ok,'state':'done' if ok else 'failed'}))
        shutil.rmtree(candidate)
        return {'ok':ok,'log':out.decode(errors='replace')[-(1200 if ok else 6000):]}

if __name__=='__main__':mcp.run(transport='streamable-http',host='127.0.0.1',port=int(os.environ.get('BLENDER_MCP_PORT','33442')),stateless_http=True)
