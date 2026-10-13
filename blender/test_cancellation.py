"""Cancellation contract for isolated Blender subprocesses (no Blender required)."""
import asyncio
import json
import pathlib
import sys
import tempfile
import unittest
from blender import server

class CancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_marker_stops_active_process_and_blocks_new_work(self):
        previous = server.DATA
        capability = '12345678-1234-1234-1234-123456789abc'
        with tempfile.TemporaryDirectory() as directory:
            server.DATA = pathlib.Path(directory)
            (server.DATA / 'capabilities').mkdir()
            marker = server.DATA / 'capabilities' / (capability + '.json')
            marker.write_text(json.dumps({'directory': 'model', 'cancelled': True}))
            proc = await asyncio.create_subprocess_exec(sys.executable, '-c', 'import time; time.sleep(30)')
            try:
                await asyncio.wait_for(server.watch_cancellation(capability, proc), 3)
                await asyncio.wait_for(proc.wait(), 3)
                self.assertNotEqual(proc.returncode, 0)
                with self.assertRaisesRegex(ValueError, 'cancelled'):
                    server.workspace(capability)
            finally:
                if proc.returncode is None:
                    proc.kill()
                    await proc.wait()
                server.DATA = previous
