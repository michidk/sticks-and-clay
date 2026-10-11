import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest
from blender.build_runtime import launch

class RuntimeTests(unittest.TestCase):
    def test_supervisor_death_stops_owned_descendants(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);marker=root/'heartbeat'
            child=root/'child.py'
            child.write_text("import pathlib,time\np=pathlib.Path(__file__).with_name('heartbeat')\nwhile True:\n p.write_text(str(time.time()))\n time.sleep(.05)\n")
            parent=root/'parent.py'
            parent.write_text("import subprocess,sys,time,pathlib\nsubprocess.Popen([sys.executable,str(pathlib.Path(__file__).with_name('child.py'))])\ntime.sleep(30)\n")
            proc=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).parent/'build_runtime.py'),'--cwd',directory,'--cpu','--',sys.executable,str(parent)],stdout=subprocess.DEVNULL)
            try:
                deadline=time.monotonic()+5
                while not marker.exists() and time.monotonic()<deadline:time.sleep(.05)
                self.assertTrue(marker.exists())
                proc.kill();proc.wait(timeout=5);time.sleep(.3)
                before=marker.read_bytes();time.sleep(.3)
                self.assertEqual(marker.read_bytes(),before)
            finally:
                if proc.poll() is None:proc.kill();proc.wait()

    def test_exit_and_timeout(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(launch([sys.executable,'-c','raise SystemExit(7)'],root,10,False),7)
            started=time.monotonic()
            with self.assertRaises(TimeoutError):launch([sys.executable,'-c','import time;time.sleep(30)'],root,1,False)
            self.assertLess(time.monotonic()-started,5)

    def test_gate_serializes_separate_processes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            env={**os.environ,'BLENDER_CONCURRENCY':'1','STUDIO_RENDER_SLOT_DIR':str(root/'slots')}
            code="import time;print(time.time(),flush=True);time.sleep(.5);print(time.time(),flush=True)"
            runner=pathlib.Path(__file__).parent/'build_runtime.py'
            command=[sys.executable,str(runner),'--cwd',directory,'--timeout','10','--',sys.executable,'-c',code]
            procs=[subprocess.Popen(command,env=env,stdout=subprocess.PIPE,text=True) for _ in range(2)]
            intervals=[]
            for proc in procs:
                out,_=proc.communicate(timeout=15);self.assertEqual(proc.returncode,0,out)
                lines=out.splitlines();self.assertIn('waitSeconds',json.loads(lines[0]));intervals.append(list(map(float,lines[1:])))
            intervals.sort();self.assertGreaterEqual(intervals[1][0],intervals[0][1])

if __name__=='__main__':unittest.main()
