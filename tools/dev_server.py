#!/usr/bin/env python3
"""開発用ローカルサーバー: ブラウザキャッシュを無効化して常に最新の index.html を配信する。
使い方: python3 tools/dev_server.py [port]  (デフォルト 8931)
"""
import http.server, os, sys

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    os.chdir(os.path.join(os.path.dirname(__file__), '..'))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8931
    print('serving (no-cache) at http://localhost:%d/' % port)
    http.server.ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
