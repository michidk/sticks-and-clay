"""Offline material runner: python render.py [--mode quick|final]."""
import argparse
import importlib.util
import json
import pathlib
from materialkit import save

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['quick', 'final'], default='final')
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent
    params = json.loads((root / 'params.json').read_text(encoding='utf-8'))
    if args.mode == 'quick': params['size'] = min(params['size'], 128)
    spec = importlib.util.spec_from_file_location('asset', root / 'asset.py')
    asset = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(asset)
    output = root / ('preview' if args.mode == 'quick' else 'output')
    save(asset.build(params), params, output)
    print('Review:', output / 'review.png')
