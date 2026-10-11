import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from blender import build_artifacts as builds


class PublicationTests(unittest.TestCase):
    def candidate(self, root, value, extra=False):
        folder=root/('candidate-'+value);folder.mkdir()
        (folder/'asset.glb').write_text(value)
        if extra:(folder/'sprites.png').write_bytes(b'old optional sprite')
        builds.receipt(folder,'model','final',value,{'runner':'3'})
        return folder

    def publish(self, source, output):
        return builds.publish_workspace(source,output,[p.name for p in source.iterdir()])

    def test_commit_retains_previous_generation_and_removes_obsolete_aliases(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);output=root/'output'
            old=self.publish(self.candidate(root,'old',True),output)
            new=self.publish(self.candidate(root,'new'),output)
            self.assertEqual((output/'asset.glb').read_text(),'new')
            self.assertFalse((output/'sprites.png').exists())
            self.assertEqual((output/old['directory']/'asset.glb').read_text(),'old')
            self.assertEqual(json.loads((output/'output-current.json').read_text()),new)
            self.assertEqual(new['receiptSha256'],hashlib.sha256((output/new['directory']/'build-receipt.json').read_bytes()).hexdigest())

    def test_failed_commit_rolls_back_every_alias_and_pointer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);output=root/'output'
            old=self.publish(self.candidate(root,'old',True),output)
            original=builds.atomic_json
            def fail_commit(path,value):
                if path.name=='output-current.json':raise OSError('simulated failed commit')
                original(path,value)
            with patch.object(builds,'atomic_json',side_effect=fail_commit):
                with self.assertRaises(OSError):self.publish(self.candidate(root,'new'),output)
            self.assertEqual((output/'asset.glb').read_text(),'old')
            self.assertTrue((output/'sprites.png').exists())
            self.assertEqual(json.loads((output/'output-current.json').read_text()),old)
            self.assertFalse((output/'publication-pending.json').exists())

    def test_restart_recovers_interrupted_alias_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);output=root/'output'
            old=self.publish(self.candidate(root,'old'),output)
            (output/'publication-pending.json').write_text(json.dumps({'members':old['members']+['partial.png'],'previous':old}))
            (output/'asset.glb').write_text('partial')
            (output/'partial.png').write_bytes(b'partial')
            builds.recover_workspace(output)
            self.assertEqual((output/'asset.glb').read_text(),'old')
            self.assertFalse((output/'partial.png').exists())

    def test_corrupt_candidate_never_changes_successful_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);output=root/'output'
            self.publish(self.candidate(root,'old'),output)
            candidate=self.candidate(root,'new');(candidate/'asset.glb').write_text('corrupt')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):self.publish(candidate,output)
            self.assertEqual((output/'asset.glb').read_text(),'old')

if __name__=='__main__':unittest.main()
