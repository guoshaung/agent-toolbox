$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (!(Test-Path -LiteralPath '.venv-mv/Scripts/python.exe')) {
    uv venv --python 3.12 .venv-mv
    if ($LASTEXITCODE -ne 0) { throw '创建多视图环境失败' }
}
uv pip install --python .venv-mv/Scripts/python.exe torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
if ($LASTEXITCODE -ne 0) { throw '安装 CUDA PyTorch 失败' }
uv pip install --python .venv-mv/Scripts/python.exe -r requirements-multiview.txt
if ($LASTEXITCODE -ne 0) { throw '安装多视图依赖失败' }
& .venv-mv/Scripts/python.exe setup_multiview.py
if ($LASTEXITCODE -ne 0) { throw '下载或验证多视图模型失败' }
Write-Output '多视图环境就绪。返回工具箱，选择正面、左侧和背面图片。'
