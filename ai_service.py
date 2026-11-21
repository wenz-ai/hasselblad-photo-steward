"""Plan and cache preview-only reviews without changing picks or the removal queue."""
import fcntl
import json
from ai_review import PROMPT, VERSION, BATCH_SIZE, auth_mode, batches, cache_key, review
from library import DATA, database


def active_rows(rows, db):
    removed = {r[0] for r in db.execute("SELECT id FROM removed WHERE kind='photo'")}
    return [r for r in rows.values() if r["id"] not in removed]


def plan(rows, body):
    mode = body["mode"]
    if auth_mode() != mode:
        raise ValueError("所选登录方式与当前 Codex 登录不符。纯订阅请选择 ChatGPT，并用 ChatGPT 登录 Codex。")
    with database() as db:
        active = active_rows(rows, db)
        scope = body["scope"]
        if scope == "one":
            active=[r for r in active if r["id"]==body.get("id")]
            if not active: raise ValueError("照片不可用。")
        elif scope == "pair":
            ids=body.get("pair",[])
            if not isinstance(ids,list) or len(ids)!=2 or len(set(ids))!=2:
                raise ValueError("请选择两张不同的对照片。")
            lookup={r["id"]:r for r in active}
            if not set(ids)<=lookup.keys() or lookup[ids[0]]["group"]!=lookup[ids[1]]["group"]:
                raise ValueError("当前对照片已变化，请重新选择。")
            active=[lookup[i] for i in ids]
        elif scope == "group":
            group = rows[body["id"]]["group"]
            active = [r for r in active if r["group"] == group]
        elif scope not in ("trial","all"):
            raise ValueError("请选择本组、试选或整库。")
        work = [active] if scope=="pair" else batches(active)
        if scope == "trial":
            example = next((g for g in reversed(work) if len(g)>1), work[-1] if work else [])
            work = [example] if example else []
        jobs = []
        cached = 0
        for group in work:
            signature = cache_key(group, mode)
            if db.execute("SELECT 1 FROM ai_batches WHERE signature=?", (signature,)).fetchone(): cached += 1
            jobs.append([r["id"] for r in group])
        return {"jobs":jobs, "cached":cached, "mode":mode,"prompt":PROMPT,"policy":VERSION}


def run_batch(rows, body):
    ids, mode = body["ids"], body["mode"]
    if not isinstance(ids,list) or not 1<=len(ids)<=BATCH_SIZE or len(set(ids))!=len(ids):
        raise ValueError("本批照片数量无效。")
    if mode not in ("subscription","key"): raise ValueError("请选择登录方式。")
    group=[rows[k] for k in ids]
    signature=cache_key(group,mode)
    with (DATA/"ai.lock").open("a") as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError("此片库正在处理另一批照片，请稍后续跑。") from None
        with database() as db:
            active={r["id"] for r in active_rows(rows,db)}
            if not set(ids)<=active: raise ValueError("清单已变化，请重新选择范围。")
            old=db.execute("SELECT result FROM ai_batches WHERE signature=?",(signature,)).fetchone()
        if old:
            result=json.loads(old[0])
        else:
            result,audit=review([DATA/"预览"/(k+".jpg") for k in ids],ids,mode)
            for item in result.values(): item["signature"]=signature
        with database() as db:
            if not old:
                db.execute("INSERT INTO ai_audit VALUES(?,?)",(signature,json.dumps(audit,ensure_ascii=False)))
            db.execute("INSERT OR IGNORE INTO ai_batches VALUES(?,?)",(signature,json.dumps(result,ensure_ascii=False)))
            db.executemany("INSERT OR REPLACE INTO ai_photos VALUES(?,?)",
                           [(k,json.dumps(v,ensure_ascii=False)) for k,v in result.items()])
        return {"ai":result}


def results(db):
    return {r["id"]:json.loads(r["result"]) for r in db.execute("SELECT * FROM ai_photos")}


def audit_for(signature):
    with database() as db:
        hit=db.execute("SELECT details FROM ai_audit WHERE signature=?",(signature,)).fetchone()
    if not hit: raise ValueError("该次评审没有已保存的依据。")
    return json.loads(hit[0])
