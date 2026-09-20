"""Reconstruct an actual mesh, rig it, then export standard VRM and GLB."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input',required=True); p.add_argument('--output',required=True)
    args = p.parse_args(); output=Path(args.output)
    try:
        subprocess.run([sys.executable,str(ROOT/'reconstruct.py'),'--input',args.input,'--output',str(output)],check=True)
        subprocess.run([sys.executable,str(ROOT/'export_vrm.py'),'--job',str(output)],check=True)
    except subprocess.CalledProcessError as exc:
        output.mkdir(parents=True,exist_ok=True)
        (output/'failure.json').write_text(json.dumps({'ok':False,'stage':Path(exc.cmd[1]).stem,'returncode':exc.returncode}), 'utf-8')
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
