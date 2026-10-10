# Sync the backend in this repo to the Hugging Face Space that hosts the API.
# Usage (PowerShell, from the repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\sync-hf-space.ps1
# Requires: git, and a Hugging Face access token with write permission
# (git will ask for username = your HF username, password = the token).

param(
  [string]$SpaceUrl = "https://huggingface.co/spaces/danghoang2605/mediflow-ai",
  [string]$SpaceDir = "$PSScriptRoot\..\..\mediflow-ai-space"
)
$ErrorActionPreference = "Stop"
$Repo = Resolve-Path "$PSScriptRoot\.."

if (-not (Test-Path $SpaceDir)) { git clone $SpaceUrl $SpaceDir }
Set-Location $SpaceDir
git pull

# Backend code + the Space's Dockerfile and metadata (deploy/huggingface/).
$files = "main.py","report_merge.py","cloud_store.py","clinical_rules.py","document_extract.py","ecg_engine.py","requirements.txt"
foreach ($f in $files) { Copy-Item "$Repo\$f" -Destination . -Force }
Copy-Item "$Repo\deploy\huggingface\Dockerfile" -Destination . -Force
Copy-Item "$Repo\deploy\huggingface\README.md" -Destination . -Force
New-Item -ItemType Directory -Force -Path cde | Out-Null
Copy-Item "$Repo\cde\*.py" -Destination cde -Force

# Modules removed from the product (login, server-side storage, third-party APIs).
$old = "auth.py","db.py","database.py","vnpt_client.py","supabase_security_patch.sql","supabaseClient.js","App.jsx","api.js","mount.js","index.html","package.json"
foreach ($f in $old) { if (Test-Path $f) { git rm -q $f } }

git add -A
git commit -m "Sync backend: stateless API, no login, bilingual output"
git push
Write-Host "Pushed. The Space rebuilds automatically; check its Logs tab, then open /health and /docs."
