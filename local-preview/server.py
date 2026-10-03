from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import os
from urllib.parse import urlsplit,unquote
ROOT=Path(__file__).resolve().parent.parent
os.chdir(ROOT)
class Handler(SimpleHTTPRequestHandler):
 def do_HEAD(self): self.send_error(405,'Offline preview: HEAD disabled')
 def do_GET(self):
  if self.path.split('?')[0] in ('/','/index.html'):
   data=(ROOT/'index.html').read_text().replace('<head>','<head><script src="/local-preview/adapter.js"></script>',1)
   if 'planLibrary=1' in urlsplit(self.path).query.split('&'):
    data=data.replace('if(COMPARISON_PREVIEW || EDITOR_PANE){','if(!EDITOR_PANE) COMPARISON_PREVIEW=true;\nif(COMPARISON_PREVIEW || EDITOR_PANE){',1)
    before,after=data.rsplit('</body>',1)
    data=before+'<script src="/assets/js/plan-repository-lab.js"></script><script src="/local-preview/plan-library.js"></script></body>'+after
   if 'internalAPI=1' in urlsplit(self.path).query.split('&'):
    before,after=data.rsplit('</body>',1)
    data=before+'<script src="/assets/js/editor-internal-api.js"></script><script src="/local-preview/internal-api.js"></script></body>'+after
   data=data.replace('<link rel="preconnect" href="https://fonts.googleapis.com">','')
   data='\n'.join(x for x in data.split('\n') if not ('fonts.googleapis.com/css2' in x))
   self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; worker-src 'self' blob:");self.end_headers();self.wfile.write(data.encode());return
  if self.path.startswith('/local-preview/'):
   name=self.path.split('?')[0].split('/')[-1]
   if name in ('adapter.js','sample.json','source-reviewed-doors.json','plan-library.js','frozen-page-2.json','internal-api.js'):
    data=(ROOT/'local-preview'/name).read_bytes();self.send_response(200);self.send_header('Content-Type','text/javascript' if name.endswith('.js') else 'application/json');self.end_headers();self.wfile.write(data);return
  if self.path.startswith('/api/'):
   self.send_error(403,'Offline preview: API disabled');return
  request_path=unquote(urlsplit(self.path).path)
  resolved=(ROOT/request_path.lstrip('/')).resolve()
  asset_root=(ROOT/'assets').resolve()
  if request_path.startswith('/assets/') and resolved.is_relative_to(asset_root):
   super().do_GET();return
  if request_path=='/tools/tests/fixtures/madori-3f.pdf':
   super().do_GET();return
  self.send_error(404);return
 def do_POST(self): self.send_error(403,'Offline preview: API disabled')
server=ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('WEBCAD_PREVIEW_PORT','0'))),Handler)
print('LOCAL_PREVIEW_URL=http://127.0.0.1:'+str(server.server_port),flush=True)
server.serve_forever()
