"""Local read-only 3D viewer. Serves only viewer assets and job artifacts."""
import argparse
import json
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

ROOT = Path(__file__).resolve().parent

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        route = unquote(urlparse(self.path).path)
        if route == '/health':
            data = json.dumps({'service':'avatar-rig-studio','version':2}).encode()
            self.send_response(200); self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
            return
        if route == '/':
            jobs = sorted((ROOT/'jobs').glob('*/avatar.vrm'), key=lambda x:x.stat().st_mtime, reverse=True)
            job = jobs[0].parent.name if jobs else 'miku-reconstructed'
            self.send_response(302); self.send_header('Location', f'/viewer.html?job={job}'); self.end_headers()
            return
        target = (ROOT / route.lstrip('/')).resolve()
        if not target.is_relative_to(ROOT) or not target.is_file() or not (
            route in ['/viewer.html','/viewer.js','/viewer.css'] or route.startswith('/web/') or route.startswith('/jobs/')
        ):
            self.send_error(404); return
        super().do_GET()

    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Cache-Control','no-store')
        super().end_headers()

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--no-browser', action='store_true'); p.add_argument('--port',type=int,default=18765)
    args = p.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1',args.port), Handler)
    print(f'Avatar Rig Studio: http://127.0.0.1:{args.port}', flush=True)
    if not args.no_browser: webbrowser.open(f'http://127.0.0.1:{args.port}/')
    server.serve_forever()
