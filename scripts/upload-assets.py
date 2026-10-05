"""Upload built assets with a short-lived, asset-only Cloudflare upload JWT."""
import base64
import json
import mimetypes
from pathlib import Path
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[1]
data = json.loads((root / '.deploy-assets-session.json').read_text())
session = data['session']
token = session['jwt']
completion = token if not session['buckets'] else None
for number, bucket in enumerate(session['buckets']):
    boundary = 'TrafficOptimizerAssetBoundary'
    parts = []
    for digest in bucket:
        path = next(path for path, meta in data['manifest'].items() if meta['hash'] == digest)
        file = root / 'dist' / path.lstrip('/')
        mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        parts += [('--' + boundary + '\r\nContent-Disposition: form-data; name="' + digest + '"; filename="' + digest + '"\r\nContent-Type: ' + mime + '\r\n\r\n').encode(), base64.b64encode(file.read_bytes()), b'\r\n']
    parts.append(('--' + boundary + '--\r\n').encode())
    req = urllib.request.Request(
        'https://api.cloudflare.com/client/v4/accounts/' + data['account'] + '/workers/assets/upload?base64=true',
        data=b''.join(parts), method='POST',
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'multipart/form-data; boundary=' + boundary},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            result = json.load(response)
            if result.get('result', {}).get('jwt'):
                completion = result['result']['jwt']
            print(json.dumps({'bucket': number + 1, 'status': response.status, 'success': result.get('success')}), flush=True)
    except urllib.error.HTTPError as e:
        print(json.dumps({'bucket': number + 1, 'status': e.code, 'error': 'Cloudflare upload rejected'}), flush=True)
        raise SystemExit(1)
    except Exception as e:
        print(json.dumps({'bucket': number + 1, 'error': type(e).__name__}), flush=True)
        raise SystemExit(1)
if not completion:
    raise SystemExit('Cloudflare did not return an asset completion token.')
output = root / '.deploy-assets-complete.json'
output.write_text(json.dumps({'jwt': completion}))
output.chmod(0o600)
print('Asset upload completed.', flush=True)
