$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
uv sync
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed' }
& .venv/Scripts/python.exe setup_models.py
if ($LASTEXITCODE -ne 0) { throw 'Model setup failed' }
Write-Output 'Ready: launch app.py for the viewer, pipeline.py for reconstruction.'
