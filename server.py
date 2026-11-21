import json
import secrets
import subprocess
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from library import (ROOT,DATA,LIBRARY,writer,database,catalog,snapshots,mobile_list,
                     check_volume,remove_confirmed,removal_plan)

ORIGIN = None
TOKEN=secrets.token_urlsafe(32)
ROWS=catalog()


class Handler(BaseHTTPRequestHandler):
    def log_message(self,fmt,*args):pass

    def send(self,code,body,ctype):
        self.send_response(code)
        self.send_header('Content-Type',ctype)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store' if ctype.startswith('application/json') else 'no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body)

    def output(self,obj,code=200):
        self.send(code,json.dumps(obj,ensure_ascii=False).encode(),'application/json; charset=utf-8')

    def do_GET(self):
        if self.headers.get('Host')!=ORIGIN.split('//')[1]:return self.send_error(403)
        url=urlsplit(self.path).path
        if url=='/api':
            with database() as db:
                self.output(dict(rows=list(ROWS.values()),**snapshots(db),token=TOKEN,library=str(LIBRARY)))
        elif url.startswith('/p/') and url[3:] in ROWS:
            self.send(200,(DATA/'预览'/(url[3:]+'.jpg')).read_bytes(),'image/jpeg')
        elif url in ['/','/app.css','/app.js']:
            path=ROOT/('index.html' if url=='/' else url[1:])
            ctype={'/':'text/html','/app.css':'text/css','/app.js':'application/javascript'}[url]
            self.send(200,path.read_bytes(),ctype+'; charset=utf-8')
        else:self.send_error(404)

    def do_POST(self):
        if self.headers.get('Host')!=ORIGIN.split('//')[1] or self.headers.get('Origin')!=ORIGIN or self.headers.get('X-Review-Token')!=TOKEN:
            return self.send_error(403)
        try:
            size=int(self.headers.get('Content-Length',0))
            if not 0<size<200000:raise ValueError('请求大小异常。')
            data=json.loads(self.rfile.read(size))
            with writer(),database() as db:
                url=self.path
                if db.execute('SELECT 1 FROM moves LIMIT 1').fetchone() and url!='/remove':
                    raise ValueError('上次移除未结束，请重新连接相机，在移除清单继续完成。')
                if url=='/pick':
                    ident=data['id']
                    if ident not in ROWS or db.execute('SELECT 1 FROM removed WHERE id=?',(ident,)).fetchone():
                        raise ValueError('照片不可用。')
                    db.execute('INSERT OR REPLACE INTO picks VALUES(?,?)',(ident,int(bool(data['on']))))
                    if data['on']:db.execute('DELETE FROM queue WHERE id=?',(ident,))
                    mobile_list(ROWS,db)
                elif url=='/queue':
                    kind=data.get('kind')
                    for ident in data['ids']:
                        r=ROWS[ident]
                        if kind is None:db.execute('DELETE FROM queue WHERE id=?',(ident,))
                        else:
                            removal_plan(r,kind,db)
                            db.execute('INSERT OR REPLACE INTO queue VALUES(?,?)',(ident,kind))
                elif url=='/remove' and data.get('confirm')=='移入废纸篓':
                    remove_confirmed(db,ROWS,data['selection'])
                    mobile_list(ROWS,db)
                elif url=='/finder':
                    subprocess.run(['open','-R',str(LIBRARY/'手机选片单.html')],check=True)
                else:raise ValueError('操作无效。')
                db.commit()
                self.output(snapshots(db))
        except Exception as e:
            self.output({'error':str(e)},400)


def serve(open_browser=True):
    global ORIGIN
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        ORIGIN = f"http://127.0.0.1:{server.server_port}"
        print(ORIGIN + "/", flush=True)
        if open_browser:
            webbrowser.open(ORIGIN)
        server.serve_forever()
