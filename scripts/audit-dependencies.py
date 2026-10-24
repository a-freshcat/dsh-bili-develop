"""Read installed public package metadata; optional OSV audit sends names/versions only."""
import argparse
import datetime
import importlib.metadata as metadata
import json
from pathlib import Path
import urllib.request
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--online', action='store_true')
args = parser.parse_args()
queue = [('bilibili-api-python', ''), ('qrcode', 'pil'), ('httpx', ''), ('brotli', ''), ('faster-whisper', '')]
seen, packages, missing = set(), {}, []
while queue:
    name, extra = queue.pop(); key = canonicalize_name(name)
    if (key, extra) in seen:
        continue
    seen.add((key, extra))
    try:
        distribution = metadata.distribution(name)
    except metadata.PackageNotFoundError:
        missing.append(key); continue
    packages[key] = {'name': distribution.metadata['Name'], 'version': distribution.version}
    for raw in distribution.requires or []:
        requirement = Requirement(raw)
        if requirement.marker and not requirement.marker.evaluate({'extra': extra}):
            continue
        queue.extend((requirement.name, e) for e in (requirement.extras or ['']))
rows = sorted(packages.values(), key=lambda v: v['name'].lower())
report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'installed dependency closure for this platform, including optional local transcription',
          'packages': rows, 'missing': sorted(set(missing)), 'online': args.online}
if args.online:
    payload = {'queries': [{'package': {'ecosystem': 'PyPI', 'name': row['name']}, 'version': row['version']} for row in rows]}
    request = urllib.request.Request('https://api.osv.dev/v1/querybatch', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=45) as response:
        results = json.load(response)['results']
    if len(results) != len(rows):
        raise ValueError('Incomplete OSV result')
    report['findings'] = [{'package': row, 'vulnerabilities': value.get('vulns', []), 'nextPageToken': value.get('next_page_token')} for row, value in zip(rows, results) if value.get('vulns') or value.get('next_page_token')]
Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps({'packages': len(rows), 'missing': report['missing'], 'online': args.online, 'findings': report.get('findings')}, ensure_ascii=False))
