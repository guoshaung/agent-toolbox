"""Download and verify the public TripoSR checkpoint; no credentials required."""
import hashlib
import argparse
import urllib.request
from pathlib import Path

PROJECT = Path(__file__).resolve().parent
ROOT = PROJECT / 'models' / 'TripoSR'
ROOT.mkdir(parents=True,exist_ok=True)
EXPECTED = '429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee'

def digest(p):
    with p.open('rb') as f:
        return hashlib.file_digest(f,'sha256').hexdigest()

for name in ['model.ckpt','config.yaml']:
    target = ROOT/name
    if target.exists() and (name!='model.ckpt' or digest(target)==EXPECTED):
        print(f'{name}: already verified',flush=True);continue
    tmp = target.with_suffix(target.suffix+'.download')
    print(f'Downloading {name}',flush=True)
    urllib.request.urlretrieve(f'https://huggingface.co/stabilityai/TripoSR/resolve/main/{name}',tmp)
    if name=='model.ckpt' and digest(tmp)!=EXPECTED:
        raise RuntimeError('Checkpoint checksum mismatch; not installing')
    tmp.replace(target)

parser = argparse.ArgumentParser()
parser.add_argument('--sample', action='store_true', help='Download the official Miku reference for personal local evaluation')
if parser.parse_args().sample:
    urllib.request.urlretrieve('https://piapro.net/images/ch_img_miku.png', PROJECT/'miku-official.png')
