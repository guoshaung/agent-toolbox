"""Install pinned upstream Hunyuan source and verified fp16 weights locally."""
import hashlib
import json
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REVISION = 'f8db63096c8282cb27354314d896feba5ba6ff8a'
FILES = {
    'model.fp16.safetensors': 'd36f5881bcdc56726b73e517cd444c13c60732431622da7268145355c8d38e9c',
    'config.yaml': '315fd5bf601d1d103130b9fda202f1bd28eda495e68ed1621bc823d5519c5e5b',
}


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    source = ROOT/'vendor/Hunyuan3D-2'
    if not source.exists():
        subprocess.run(['git', 'clone', '--no-checkout', 'https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git', str(source)], check=True)
        subprocess.run(['git', '-C', str(source), 'checkout', '--detach', REVISION], check=True)
    actual = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip()
    if actual != REVISION or dirty:
        raise RuntimeError('已有 Hunyuan 源码与固定版本不同或有本地修改，请保留修改后手工切换版本；安装器不会覆盖。')
    folder = ROOT/'models/Hunyuan3D-2mv/hunyuan3d-dit-v2-mv'
    folder.mkdir(parents=True, exist_ok=True)
    for name, checksum in FILES.items():
        target = folder/name
        if target.exists() and digest(target) == checksum:
            print(f'{name}: verified', flush=True)
            continue
        partial = target.with_suffix(target.suffix+'.download')
        print(f'Downloading {name} (weights approximately 4.9GB)', flush=True)
        urllib.request.urlretrieve(f'https://huggingface.co/tencent/Hunyuan3D-2mv/resolve/main/hunyuan3d-dit-v2-mv/{name}', partial)
        if digest(partial) != checksum:
            raise RuntimeError(f'{name}: checksum mismatch; not installing')
        partial.replace(target)
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError('模型已下载，但 NVIDIA CUDA 不可用；请检查显卡驱动。')
    report = {'engine':'Hunyuan3D-2mv', 'sourceRevision':REVISION, 'files':FILES,
              'torch':torch.__version__, 'device':torch.cuda.get_device_name()}
    (ROOT/'multiview-ready.json').write_text(json.dumps(report, indent=2), 'utf-8')
    print('Hunyuan3D-2mv ready', flush=True)


if __name__ == '__main__':
    main()
