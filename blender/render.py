"""Fixed runner: python render.py [--mode quick|final] [--blender PATH]."""
import argparse
import os
import pathlib
import runpy
import subprocess
import sys


def main():
    directory = pathlib.Path(__file__).resolve().parent
    try:
        import bpy
    except ImportError:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--mode', choices=['quick', 'final'], default='quick')
        parser.add_argument('--blender', default=os.environ.get('BLENDER_BIN', 'blender'))
        parser.add_argument('--timeout', type=int, default=600)
        args = parser.parse_args()
        if args.timeout < 1: parser.error('Timeout must be positive')
        from build_runtime import launch
        raise SystemExit(launch([args.blender, '-b', '--factory-startup', '--threads', '2', '--python-exit-code', '1', '--python', str(directory / 'render.py'), '--', '--mode', args.mode], str(directory), args.timeout))
    else:
        runpy.run_path(str(directory / 'rebuild.py'), run_name='__main__')


if __name__ == '__main__': main()
