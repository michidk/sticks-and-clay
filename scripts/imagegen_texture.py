"""Invoke the installed Codex imagegen CLI unchanged, retaining its response usage.
Asset Studio's tool wrapper adds audit output; generation stays in the skill CLI.
"""
import importlib.util,json,os,pathlib,sys,types
skill=pathlib.Path(os.environ.get('STUDIO_IMAGEGEN_SKILL',str(pathlib.Path.home()/'.codex/skills/.system/imagegen')))
spec=importlib.util.spec_from_file_location('codex_imagegen',skill/'scripts/image_gen.py')
cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)
create_client=cli._create_client
usage_path=pathlib.Path(sys.argv[1]);sys.argv=[str(skill/'scripts/image_gen.py'),*sys.argv[2:]]
def tracked_client():
    client=create_client().with_options(max_retries=0)
    def generate(**kwargs):
        result=client.images.generate(**kwargs)
        usage=getattr(result,'usage',None)
        usage_path.write_text(json.dumps(usage.model_dump() if usage else None))
        return result
    return types.SimpleNamespace(images=types.SimpleNamespace(generate=generate))
cli._create_client=tracked_client
cli.main()
