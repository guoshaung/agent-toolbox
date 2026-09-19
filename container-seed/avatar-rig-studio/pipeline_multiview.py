"""Validate views → Hunyuan shape → reference textures → provisional VRM skin."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--job', type=Path, required=True)
    args = parser.parse_args()
    job = args.job.resolve()
    job.mkdir(parents=True, exist_ok=True)
    stages = ['prepare_multiview_inputs.py', 'reconstruct_multiview.py',
              'prepare_multiview_mesh.py', 'export_vrm.py']
    for stage in stages:
        print(f'STAGE:{stage}', flush=True)
        try:
            subprocess.run([sys.executable, '-u', str(ROOT/stage), '--job', str(job)], check=True)
        except subprocess.CalledProcessError as error:
            (job/'failure.json').write_text(json.dumps({'ok': False, 'stage': stage,
                                                       'returncode': error.returncode}), 'utf-8')
            return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
