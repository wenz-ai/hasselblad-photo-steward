"""Local archive and recoverable review operations for this camera import."""
import contextlib
import datetime
import fcntl
import json
import os
import sqlite3
import uuid
from pathlib import Path

from PIL import Image

from settings import BASE, ROOT, disk, session

DATA, config = session()
SOURCE = Path(config["source"])
LIBRARY = DATA / "选片"
Image.MAX_IMAGE_PIXELS = 180_000_000


def catalog():
    return {r['id']:r for r in json.loads((DATA/'catalog.json').read_text())}


@contextlib.contextmanager
def database():
    db=sqlite3.connect(DATA/'整理记录.sqlite3',timeout=45)
    db.row_factory=sqlite3.Row
    try:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS ai_audit(signature TEXT PRIMARY KEY, details TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ai_batches(signature TEXT PRIMARY KEY, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ai_photos(id TEXT PRIMARY KEY, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS picks(id TEXT PRIMARY KEY, chosen INTEGER);
        CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY, kind TEXT);
        CREATE TABLE IF NOT EXISTS removed(id TEXT, kind TEXT, stamp TEXT, PRIMARY KEY(id,kind));
        CREATE TABLE IF NOT EXISTS moves(id TEXT, kind TEXT, src TEXT, dst TEXT, PRIMARY KEY(src,dst));
        """)
        yield db
        db.commit()
    finally:db.close()


@contextlib.contextmanager
def writer():
    with (DATA/'写入锁').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        yield


def check_volume():
    volume_id, mount = disk(SOURCE)
    if volume_id != config["volume"]:
        raise ValueError("请连接本次选片使用的来源卷。")
    if SOURCE.stat().st_dev == Path.home().stat().st_dev:
        return Path.home() / ".Trash"
    return mount / ".Trashes" / str(os.getuid())


def file_source(f):
    p = SOURCE / f['rel']
    if p.resolve() != p or not p.is_relative_to(SOURCE) or not p.is_file():
        raise ValueError("原件已移动或路径已变化，请先核对。")
    st=p.stat()
    if st.st_size!=f['size'] or st.st_mtime_ns!=f['mtime']:
        raise ValueError(f'{p.name} 已发生变化，请重新核对原件。')
    return p


def snapshots(db):
    return dict(picks={x['id']:bool(x['chosen']) for x in db.execute('SELECT * FROM picks')},
                queue={x['id']:x['kind'] for x in db.execute('SELECT * FROM queue')},
                removed=[[x['id'],x['kind']] for x in db.execute('SELECT * FROM removed')])


def removal_plan(r,kind,db):
    if kind!='photo':raise ValueError('未知操作。')
    if db.execute('SELECT 1 FROM removed WHERE id=?',(r['id'],)).fetchone():raise ValueError('照片已移除。')
    return [(SOURCE/f['rel'],f['size'],f) for f in r['files']]


def finish_moves(db, rows, catalog, trash):
    # Every destination is journaled before the first move. Resume the exact plan on retry.
    for m in rows:
        src,dst=Path(m['src']),Path(m['dst'])
        originals = catalog[m['id']]['files']
        original = next(f for f in originals if SOURCE / f['rel'] == src)
        if dst.resolve() != dst or not dst.is_relative_to(trash):
            raise ValueError('废纸篓位置已变化，请先核对。')
        if dst.is_file() and not src.exists():
            if dst.stat().st_size != original['size'] or dst.stat().st_mtime_ns != original['mtime']:
                raise ValueError('废纸篓内的文件已变化，请先核对。')
            continue
        file_source(original)
        if not src.exists() or dst.exists():raise ValueError('移除记录与磁盘状态不一致，请在 Finder 核对。')
        dst.parent.mkdir(parents=True,exist_ok=True)
        os.rename(src,dst)
    for ident,kind in {(m['id'],m['kind']) for m in rows}:
        db.execute('INSERT OR REPLACE INTO picks VALUES(?,0)',(ident,))
        db.execute('INSERT OR IGNORE INTO removed VALUES(?,?,?)',(ident,kind,datetime.datetime.now().isoformat()))
        db.execute('DELETE FROM queue WHERE id=?',(ident,))
        db.execute('DELETE FROM moves WHERE id=? AND kind=?',(ident,kind))
    db.commit()


def remove_confirmed(db, catalog, selection):
    trash = check_volume()
    queue={x['id']:x['kind'] for x in db.execute('SELECT * FROM queue')}
    if queue!=selection or not queue:raise ValueError('清单已变化，请刷新后重新核对。')
    pending=db.execute('SELECT * FROM moves').fetchall()
    if pending:return finish_moves(db,pending,catalog,trash)
    batch='PhotoSteward-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6]
    moves=[]
    for ident,kind in queue.items():
        r=catalog[ident]
        for src,size,original in removal_plan(r,kind,db):
            file_source(original)
            dst=trash/batch/'相机'/ident/src.name
            if dst.exists():raise ValueError('废纸篓目标已存在。')
            moves.append((ident,kind,str(src),str(dst)))
    db.executemany('INSERT INTO moves VALUES(?,?,?,?)',moves)
    db.commit()
    finish_moves(db,db.execute('SELECT * FROM moves').fetchall(),catalog,trash)


def mobile_list(rows,db,ai_ids=None):
    import base64
    import html
    import io
    state=snapshots(db); picks=state['picks']; gone={i for i,_ in state['removed']}
    chosen=[r for r in rows.values() if r['id'] not in gone and (r["id"] in ai_ids if ai_ids is not None else picks.get(r['id'],bool(r.get('pick'))))]
    chosen.sort(key=lambda r:r['date'],reverse=True)
    entries=[]
    for r in chosen:
        with Image.open(DATA/'预览'/(r['id']+'.jpg')) as im:
            im.thumbnail((220,220))
            buf=io.BytesIO();im.save(buf,'JPEG',quality=73)
        encoded=base64.b64encode(buf.getvalue()).decode()
        formats=' + '.join(Path(f['rel']).suffix[1:] for f in r['files'])
        entries.append(f'<article><img src="data:image/jpeg;base64,{encoded}"><div><b>{html.escape(r["name"])}</b><br>{r["date"]}<br>{formats}</div></article>')
    template='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>哈苏手机选片单</title><style>body{font:15px/1.6 -apple-system,sans-serif;background:#f2f5ee;color:#24382c;margin:20px auto;max-width:780px;padding:0 12px}article{display:flex;gap:18px;align-items:center;border-bottom:1px solid #c8d4c8;padding:8px 0}img{width:116px;height:90px;object-fit:contain;background:#27342d}b{font-size:18px}h1{margin-bottom:0}</style>'''
    LIBRARY.mkdir(parents=True,exist_ok=True)
    dest=LIBRARY/('AI 精选单.html' if ai_ids is not None else '手机选片单.html')
    tmp=dest.with_suffix('.tmp')
    tmp.write_text(template+f'<h1>哈苏手机选片单</h1><p>{len(chosen)} 张 · 按拍摄时间倒序，在 Phocus Mobile 对照原文件名选取。</p>'+''.join(entries)+'</html>')
    tmp.replace(dest)
    return dest


def ai_preference(mode=None):
    path = (BASE) / "preferences.json"
    if mode is not None:
        if mode not in ("subscription", "key"):
            raise ValueError("请选择 ChatGPT 订阅或已登录的 API Key。")
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix("." + uuid.uuid4().hex + ".tmp")
        temp.write_text(json.dumps({"aiMode":mode}))
        temp.replace(path)
    if not path.exists():
        return "subscription"
    mode = json.loads(path.read_text()).get("aiMode")
    return mode if mode in ("subscription","key") else "subscription"


def set_group_picks(rows, db, group, selected, expected):
    state = snapshots(db)
    gone = {ident for ident,kind in state["removed"] if kind == "photo"}
    members = [r for r in rows.values() if r["group"] == group and r["id"] not in gone]
    ids = {r["id"] for r in members}
    if len(members)<2 or not isinstance(selected,list) or not 1<=len(selected)<=2 or not set(selected)<=ids:
        raise ValueError("请选择同组中可用的一至两张照片。")
    current = {r["id"] for r in members if state["picks"].get(r["id"],bool(r.get("pick")))}
    if current != set(expected):
        raise ValueError("本组选片已在另一窗口修改，请刷新后重新核对。")
    db.executemany("INSERT OR REPLACE INTO picks VALUES(?,?)", [(i,int(i in selected)) for i in ids])
    db.executemany("DELETE FROM queue WHERE id=?", [(i,) for i in selected])
    mobile_list(rows,db)
