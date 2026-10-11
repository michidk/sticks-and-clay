"""Shared host render gate and supervised process launcher; no application services."""
import argparse
import contextlib
import ctypes
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time


@contextlib.contextmanager
def render_slot(timeout=900):
    root = pathlib.Path(os.environ.get('STUDIO_RENDER_SLOT_DIR', pathlib.Path(tempfile.gettempdir()) / 'sticks-clay-render-slots'))
    root.mkdir(parents=True, exist_ok=True)
    count = max(1, int(os.environ.get('BLENDER_CONCURRENCY', '2')))
    start = time.monotonic()
    held = None
    files = []
    try:
        for index in range(count):
            f = open(root / f'{index}.lock', 'a+b')
            if f.tell() == 0: f.write(b'0'); f.flush()
            files.append(f)
        while held is None:
            for f in files:
                try:
                    f.seek(0)
                    if os.name == 'nt':
                        import msvcrt
                        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    held = f
                    break
                except (OSError, BlockingIOError): pass
            if held is None:
                if time.monotonic() - start > timeout: raise TimeoutError('Render resource wait exceeded deadline')
                time.sleep(.1)
        yield time.monotonic() - start
    finally:
        for f in files: f.close()  # OS releases locks even when the owner dies.


def windows_job(process):
    """Close-on-parent-exit ownership of the child process tree on Windows."""
    if os.name != 'nt': return None
    from ctypes import wintypes
    class Basic(ctypes.Structure):
        _fields_=[('perProcess',ctypes.c_int64),('perJob',ctypes.c_int64),('flags',wintypes.DWORD),
                  ('minWorking',ctypes.c_size_t),('maxWorking',ctypes.c_size_t),('active',wintypes.DWORD),
                  ('affinity',ctypes.c_size_t),('priority',wintypes.DWORD),('scheduling',wintypes.DWORD)]
    class IO(ctypes.Structure):
        _fields_=[(n,ctypes.c_uint64) for n in ['readOps','writeOps','otherOps','readBytes','writeBytes','otherBytes']]
    class Limits(ctypes.Structure):
        _fields_=[('basic',Basic),('io',IO),('processMemory',ctypes.c_size_t),('jobMemory',ctypes.c_size_t),
                  ('peakProcess',ctypes.c_size_t),('peakJob',ctypes.c_size_t)]
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateJobObjectW.restype=wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes=[wintypes.HANDLE,wintypes.HANDLE]
    kernel.CloseHandle.argtypes=[wintypes.HANDLE]
    kernel.TerminateJobObject.argtypes=[wintypes.HANDLE,wintypes.UINT]
    kernel.QueryInformationJobObject.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD,ctypes.c_void_p]
    handle=kernel.CreateJobObjectW(None,None)
    limits=Limits(); limits.basic.flags=0x2000
    if not handle or not kernel.SetInformationJobObject(handle,9,ctypes.byref(limits),ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(handle,wintypes.HANDLE(int(process._handle))):
        if handle: kernel.CloseHandle(handle)
        process.kill(); process.wait()
        raise OSError('Cannot establish child process ownership')
    ntdll=ctypes.WinDLL('ntdll');ntdll.NtResumeProcess.argtypes=[wintypes.HANDLE]
    if ntdll.NtResumeProcess(wintypes.HANDLE(int(process._handle))) != 0:
        kernel.CloseHandle(handle);process.kill();process.wait();raise OSError('Cannot resume owned process')
    return kernel,handle


def launch(command, cwd, timeout=900, blender=True):
    start=time.monotonic(); proc=None; job=None; watchdog=None; lifetime=None
    previous={}
    def stop(*_):
        if proc and proc.poll() is None:
            if os.name=='nt': proc.kill()
            else:
                with contextlib.suppress(ProcessLookupError): os.killpg(proc.pid,signal.SIGKILL)
        raise KeyboardInterrupt()
    for sig in (signal.SIGTERM,signal.SIGINT): previous[sig]=signal.signal(sig,stop)
    try:
        gate=render_slot(timeout) if blender else contextlib.nullcontext(0.)
        with gate as waited:
            print(json.dumps({'phase':'running','waitSeconds':round(waited,3)}),flush=True)
            remaining=max(1,timeout-(time.monotonic()-start))
            env={k:v for k,v in os.environ.items() if not any(s in k.upper() for s in ['TOKEN','SECRET','PASSWORD','API_KEY','CREDENTIAL'])}
            proc=subprocess.Popen(command,cwd=cwd,env=env,start_new_session=os.name!='nt',creationflags=4 if os.name=='nt' else 0)
            job=windows_job(proc)
            if os.name!='nt':
                # EOF also arrives on supervisor SIGKILL; own only this group.
                reader,lifetime=os.pipe()
                code="import os,sys,signal;os.read(int(sys.argv[1]),1)\ntry:os.killpg(int(sys.argv[2]),signal.SIGKILL)\nexcept ProcessLookupError:pass"
                watchdog=subprocess.Popen([sys.executable,'-c',code,str(reader),str(proc.pid)],pass_fds=(reader,),start_new_session=True)
                os.close(reader)
            try: return proc.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                if os.name=='nt': proc.kill()
                else:
                    with contextlib.suppress(ProcessLookupError): os.killpg(proc.pid,signal.SIGKILL)
                proc.wait(); raise TimeoutError('Build exceeded execution deadline')
    finally:
        if job:
            kernel,handle=job
            kernel.TerminateJobObject(handle,1)
            # A venv launcher may exit before its interpreter. Wait for every
            # owned descendant before callers remove or republish the cwd.
            deadline=time.monotonic()+5
            stats=ctypes.create_string_buffer(48)
            while kernel.QueryInformationJobObject(handle,1,stats,48,None) and ctypes.c_uint32.from_buffer(stats,40).value:
                if time.monotonic()>deadline:break
                time.sleep(.01)
            kernel.CloseHandle(handle)
        if lifetime is not None:os.close(lifetime)
        if watchdog:watchdog.wait(timeout=5)
        if proc and proc.poll() is None: proc.kill(); proc.wait()
        for sig,handler in previous.items(): signal.signal(sig,handler)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--cwd',default='.')
    parser.add_argument('--timeout',type=int,default=900)
    parser.add_argument('--cpu',action='store_true')
    parser.add_argument('command',nargs=argparse.REMAINDER)
    args=parser.parse_args(); command=args.command
    if command and command[0]=='--': command=command[1:]
    if not command: parser.error('A command is required')
    try: sys.exit(launch(command,args.cwd,args.timeout,not args.cpu))
    except KeyboardInterrupt: sys.exit(130)
    except TimeoutError as error: print(str(error),file=sys.stderr); sys.exit(124)
