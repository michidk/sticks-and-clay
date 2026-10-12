"""Script editing, fixed parameters, immutable baseline dependencies and HTTP isolation."""
import json
import pathlib
import tempfile
import unittest
from starlette.testclient import TestClient
from blender import server


class WorkspaceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.previous = server.DATA
        self.temporary = tempfile.TemporaryDirectory()
        server.DATA = pathlib.Path(self.temporary.name)
        self.cap = '12345678-1234-1234-1234-123456789abc'
        (server.DATA / 'capabilities').mkdir()
        self.marker = server.DATA / 'capabilities' / (self.cap + '.json')
        self.marker.write_text(json.dumps({'directory': 'model', 'role': 'builder', 'seed': 7}))

    def tearDown(self):
        server.DATA = self.previous
        self.temporary.cleanup()

    async def call(self, operation, **input):
        return await server.asset_workspace({'capability': self.cap, 'operation': operation, **input})

    async def test_scoped_edits_retain_revisions_and_reject_stale_or_ambiguous_edits(self):
        initial = await self.call('read')
        self.assertEqual(initial['params'], {'seed': 7})
        self.assertEqual(initial['totalLines'], 0)
        first = await self.call('write', code='width = 1\r\nprint(width)\r\n')
        self.assertEqual((server.DATA / 'model/asset.py').read_bytes(), b'width = 1\nprint(width)\n')
        second = await self.call('edit', oldText='width = 1', newText='width = 2', expectedSha256=first['sha256'])
        self.assertNotEqual(first['sha256'], second['sha256'])
        with self.assertRaisesRegex(ValueError, 'changed'):
            await self.call('edit', oldText='width = 2', newText='width = 3', expectedSha256=first['sha256'])
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            await self.call('edit', oldText='width', newText='length')
        result = await self.call('read', offset=2, limit=1)
        self.assertEqual(result['content'], '2: print(width)')
        self.assertFalse(result['state']['ok'])
        self.assertEqual(len(list((server.DATA / 'model/script-revisions').glob('*.py'))), 2)
        self.marker.write_text(json.dumps({'directory': 'model', 'role': 'builder', 'seed': 99}))
        self.assertEqual((await self.call('read'))['params'], {'seed': 7})

    async def test_previous_source_rebases_dependencies_and_retains_seed(self):
        archive = server.DATA / 'versions/fixture'
        (archive / 'inputs').mkdir(parents=True)
        (archive / 'inputs/0.blend').write_bytes(b'baseline')
        (archive / 'asset.py').write_text("BASE='C:/old/source.blend'\nTEX='C:/old/work/textures/paint.png'\n")
        (archive / 'build-config.json').write_text(json.dumps({'params': {'seed': 42}, 'directory': 'C:/old/work', 'relocations': {'C:/old/source.blend': 'inputs/0.blend'}}))
        self.marker.write_text(json.dumps({'directory': 'model', 'role': 'builder', 'sourceScript': 'versions/fixture/asset.py'}))
        result = await self.call('read')
        self.assertEqual(result['params'], {'seed': 42})
        self.assertIn((archive / 'inputs/0.blend').as_posix(), result['content'])
        self.assertIn((server.DATA / 'model/textures/paint.png').as_posix(), result['content'])
        self.assertEqual(json.loads((server.DATA / 'model/work-source.json').read_text())['dependencies'], ['versions/fixture/inputs/0.blend'])

    async def test_photographer_cancelled_and_foreign_paths_are_rejected(self):
        self.marker.write_text(json.dumps({'directory': 'model', 'role': 'photographer'}))
        with self.assertRaisesRegex(ValueError, 'Builder'):
            await self.call('read')
        self.marker.write_text(json.dumps({'directory': '../outside', 'role': 'builder'}))
        with self.assertRaisesRegex(ValueError, 'Invalid workspace'):
            await self.call('read')
        self.marker.write_text(json.dumps({'directory': 'model', 'role': 'builder', 'cancelled': True}))
        with self.assertRaisesRegex(ValueError, 'cancelled'):
            await self.call('write', code='print(1)')

    async def test_http_route_uses_json_and_rejects_browser_origins(self):
        with TestClient(server.mcp.streamable_http_app(stateless_http=True), base_url='http://127.0.0.1') as client:
            body = {'capability': self.cap, 'operation': 'read'}
            response = client.post('/workspace', json=body)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['params'], {'seed': 7})
            self.assertEqual(client.post('/workspace', json=body, headers={'origin': 'https://example.com'}).status_code, 403)
            self.assertEqual(client.post('/workspace', content='not JSON').status_code, 403)
            self.assertEqual(client.post('/workspace', json={'capability': 'invalid', 'operation': 'read'}).status_code, 400)

    async def test_photography_budget_covers_each_full_quality_view(self):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, patch
        glb = server.DATA / 'versions' / 'saved' / 'asset.glb'
        glb.parent.mkdir(parents=True)
        glb.write_bytes(b'fixture')
        for views, expected in [(['front', 'rear', 'detail'], 1800), (['front', 'rear', 'detail', 'left', 'right', 'top', 'bottom'], 4200)]:
            self.marker.write_text(json.dumps({'directory': 'photo', 'role': 'photographer', 'glb': 'versions/saved/asset.glb', 'views': views}))
            proc = SimpleNamespace(returncode=1, communicate=AsyncMock(return_value=(b'fixture failure', None)))
            with patch('blender.server.build_timeout_seconds', return_value=600), patch('asyncio.create_subprocess_exec', new_callable=AsyncMock, return_value=proc) as launch:
                result = await server.photograph_asset(self.cap)
                command = launch.call_args.args
                self.assertEqual(command[command.index('--timeout') + 1], str(expected))
                self.assertFalse(result['ok'])
                self.assertFalse((server.DATA / 'photo' / 'photography.json').exists())


if __name__ == '__main__': unittest.main()
