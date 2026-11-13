#!/usr/bin/env python3
"""Restore the exact EmulatorJS 4.2.3 core packs; requires bsdtar on PATH.

Runtime patches and per-core license texts are retained separately. After any
intentional vendoring change regenerate emulator-assets.sha256 and manifest routes.
"""
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.request import urlopen

URL = 'https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.2.3/4.2.3.7z'
SHA256 = '07d451bc06fa3ad04ab30d9b94eb63ac34ad0babee52d60357b002bde8f3850b'
ROOT = Path(__file__).resolve().parents[1] / 'internal/plugin/emulator/data/cores'
with tempfile.TemporaryDirectory() as folder:
    temp = Path(folder)
    archive = temp / 'emulator.7z'
    with urlopen(URL) as source, archive.open('wb') as target:
        shutil.copyfileobj(source, target)
    if hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest() != SHA256:
        raise SystemExit('Upstream archive checksum mismatch')
    extracted = temp / 'source'
    extracted.mkdir()
    subprocess.run(['bsdtar', '-xf', str(archive), '-C', str(extracted)], check=True)
    source = extracted / 'data/cores'
    for file in [*source.glob('*.data'), source / 'ppsspp-assets.zip', source / 'cores.json']:
        shutil.copy2(file, ROOT / file.name)
    shutil.copytree(source / 'reports', ROOT / 'reports', dirs_exist_ok=True)
    print('Restored pinned EmulatorJS core pack.')
