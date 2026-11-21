"""Build the offline X2D catalog. All camera accesses in this module are read-only."""
import concurrent.futures
import io
import hashlib
import os
import subprocess
import tempfile
import json
import math
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import tifffile
from PIL import Image

from settings import BASE, session
DATA, config = session()
PRE = DATA / "预览"
SOURCE = Path(config["source"])
Image.MAX_IMAGE_PIXELS = 180_000_000
cv2.setNumThreads(1)


def number(x):
    if isinstance(x, tuple):
        return x[0] / x[1] if x[1] else 0
    return float(x or 0)


def read_photo(files):
    path = files[0]
    key = hashlib.sha256(str(path.relative_to(SOURCE).with_suffix("")).encode()).hexdigest()[:32]
    if path.suffix.upper() == ".3FR":
        with tifffile.TiffFile(path) as tf, path.open("rb") as raw:
            page = tf.pages[0]
            exif = page.tags[34665].value
            raw.seek(page.dataoffsets[0])
            image = Image.open(io.BytesIO(raw.read(page.databytecounts[0])))
            ori = page.tags[274].value
            stamp = exif["DateTimeOriginal"]
            lens = exif.get("LensModel", "")
            iso = exif.get("ISOSpeedRatings", 0)
            aperture = number(exif.get("FNumber"))
            shutter = number(exif.get("ExposureTime"))
            xmp = re.search(rb'<xap:Rating>(-?\d+)', page.tags[700].value) if 700 in page.tags else None
            rating = max(int(exif.get("Rating", 0)), int(xmp[1]) if xmp else 0)
    else:
        if path.suffix.upper() in {".HEIC", ".HEIF"}:
            with tempfile.TemporaryDirectory() as work:
                output = Path(work) / "preview.jpg"
                subprocess.run(["/usr/bin/sips", "-Z", "1440", "-s", "format", "jpeg", str(path),
                                "--out", str(output)], capture_output=True, check=True, timeout=90)
                image = Image.open(io.BytesIO(output.read_bytes()))
        else:
            image = Image.open(path)
        tags = image.getexif()
        exif = tags.get_ifd(34665)
        ori = tags.get(274, 1)
        stamp, lens, iso = exif.get(36867) or tags.get(306), exif.get(42036, ""), exif.get(34855, 0)
        aperture, shutter = number(exif.get(33437)), number(exif.get(33434))
        rating = int(tags.get(18246, exif.get(18246, 0)))
    try:
        date = datetime.strptime(stamp, "%Y:%m:%d %H:%M:%S")
    except (ValueError, TypeError):
        date = datetime.fromtimestamp(path.stat().st_mtime)
    with image:
        image.draft("RGB", (1400, 1000))
        image.thumbnail((1440, 1440), Image.Resampling.LANCZOS)
        ops = [None, None, Image.Transpose.FLIP_LEFT_RIGHT, Image.Transpose.ROTATE_180,
               Image.Transpose.FLIP_TOP_BOTTOM, Image.Transpose.TRANSPOSE, Image.Transpose.ROTATE_270,
               Image.Transpose.TRANSVERSE, Image.Transpose.ROTATE_90]
        upright = image.transpose(ops[ori]) if 2 <= ori <= 8 else image
        upright.convert("RGB").save(PRE / (key + ".jpg"), quality=87, optimize=False)
    return dict(id=key, name=path.stem, date=date.isoformat(" "), lens=lens, iso=int(iso),
                aperture=round(aperture, 1), shutter=f"1/{round(1/shutter)}" if 0 < shutter < 1 else f"{shutter:g}",
                rating=rating, files=[dict(rel=str(p.relative_to(SOURCE)), size=p.stat().st_size,
                                           mtime=p.stat().st_mtime_ns) for p in files])


def measure(row):
    im = cv2.imread(str(PRE / (row['id']+'.jpg')))
    h,w = im.shape[:2]
    small = cv2.resize(im, (round(w*560/max(w,h)), round(h*560/max(w,h))), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
    # Smooth isolated grain before measuring detail across local patches.
    smooth = cv2.GaussianBlur(gray,(3,3),0.6)
    lap = cv2.Laplacian(smooth,cv2.CV_32F)
    tiles=[float(np.std(t)) for a in np.array_split(lap,6) for t in np.array_split(a,6,axis=1)]
    detail=float(np.percentile(tiles,80))
    clip=float((gray<6).mean()+(gray>249).mean())
    spread=float(np.percentile(gray,95)-np.percentile(gray,5))
    detail_points = 10 * math.log2(max(1, detail) / 4)
    tone_points = 8 * min(1, spread / 150)
    clipping_points = -35 * max(0, clip - .06)
    score = round(float(np.clip(51 + detail_points + tone_points + clipping_points, 12, 98)))
    row.update(score=score, detail=round(detail, 1), clip=round(clip, 4), spread=round(spread, 1),
               parts=[round(detail_points, 3), round(tone_points, 3), round(clipping_points, 3)])
    tiny=cv2.resize(gray,(32,32),interpolation=cv2.INTER_AREA).astype('float32')
    dct=cv2.dct(tiny)[:8,:8].ravel()[1:]
    hsv=cv2.cvtColor(small,cv2.COLOR_BGR2HSV)
    hist=cv2.calcHist([hsv],[0,1],None,[18,6],[0,180,0,256])
    hist=cv2.normalize(hist,None,alpha=1,norm_type=cv2.NORM_L1)
    feat=cv2.SIFT_create(nfeatures=320)
    kp,desc=feat.detectAndCompute(gray,None)
    return (dct>np.median(dct),hist,tiny,np.float32([k.pt for k in kp]),desc,w/h)


def match_evidence(a,b,sec):
    ha,ca,ta,ka,da,ra=a
    hb,cb,tb,kb,db,rb=b
    if abs(math.log(ra/rb))>.13:return None
    hd=np.count_nonzero(ha!=hb)
    cd=cv2.compareHist(ca,cb,cv2.HISTCMP_BHATTACHARYYA)
    diff=float(np.mean(np.abs(ta-tb)))
    if hd<=8 and cd<.30 and diff<18:
        return {"method":"layout", "hashDistance":int(hd), "brightnessDiff":round(diff,1), "colorDistance":round(cd,3)}
    if sec>180 or cd>.48 or hd>30 or da is None or db is None or min(len(da),len(db))<10:return None
    matches=cv2.BFMatcher().knnMatch(da,db,k=2)
    good=[m for m,n in matches if m.distance<.73*n.distance]
    if len(good)<14:return None
    pa=np.float32([ka[m.queryIdx] for m in good]); pb=np.float32([kb[m.trainIdx] for m in good])
    mat, mask=cv2.estimateAffinePartial2D(pa,pb,ransacReprojThreshold=3)
    if mat is None:return None
    support=int(mask.sum())
    area=cv2.contourArea(cv2.convexHull(pa[mask.ravel().astype(bool)]))
    matches_scene = support>=16 and support>=len(good)*.62 and area>4500 and .75<np.linalg.norm(mat[0,:2])<1.32 and np.linalg.norm(mat[:,2])<155 and (hd<23 or diff<28)
    if matches_scene:
        return {"method":"features", "inliers":support, "matches":len(good)}
    return None


def explain_groups(rows, features):
    """Compare directly to the recommended frame, even when a group was built from other anchors."""
    leaders = {r["group"]:i for i,r in enumerate(rows) if r["rank"] == 1}
    for i,row in enumerate(rows):
        if row["count"] < 2 or row["rank"] == 1:
            continue
        index = leaders[row["group"]]
        leader = rows[index]
        elapsed = abs((datetime.fromisoformat(row["date"]) - datetime.fromisoformat(leader["date"])).total_seconds())
        evidence = match_evidence(features[index], features[i], elapsed) if elapsed <= 600 else None
        row["comparison"] = {"peer":leader["id"], "seconds":int(elapsed), "match":evidence}

def main():
    PRE.mkdir(parents=True,exist_ok=True)
    sets=defaultdict(list)
    priority = {".3FR":0, ".JPG":1, ".JPEG":1, ".HEIC":2, ".HEIF":2}
    for root, dirs, names in os.walk(SOURCE):
        folder = Path(root)
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and not (folder/d).is_symlink()
                         and (folder/d).resolve() != BASE.resolve())
        for name in sorted(names):
            p = folder / name
            if not name.startswith(".") and p.suffix.upper() in priority and not p.is_symlink() and p.is_file():
                sets[p.with_suffix("")].append(p)
    for files in sets.values():
        files.sort(key=lambda p:(priority[p.suffix.upper()],p.name))
    if not sets:raise RuntimeError("找不到相机照片")
    rows=[]
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        jobs = {pool.submit(read_photo, files):files for files in sets.values()}
        errors = []
        for i, job in enumerate(concurrent.futures.as_completed(jobs),1):
            try:
                rows.append(job.result())
            except Exception as exc:
                errors.append({"file":str(jobs[job][0].relative_to(SOURCE)), "problem":str(exc)})
            if i%100==0:print("预览",i,flush=True)
    (DATA/"skipped.json").write_text(json.dumps(errors, ensure_ascii=False, indent=2))
    if errors: print(f"跳过 {len(errors)} 个无法解码的拍摄组，详见 {DATA/'skipped.json'}", flush=True)
    if not rows: raise ValueError(f"所有预览均未能读取，详见 {DATA/'skipped.json'}")
    rows.sort(key=lambda r:(r['date'],r['id']))
    with concurrent.futures.ThreadPoolExecutor(4) as pool: feats=list(pool.map(measure,rows))
    print("画面分析完成",flush=True)
    times=[datetime.fromisoformat(r['date']).timestamp() for r in rows]
    groups=[]
    for i,r in enumerate(rows):
        found=False
        for g in reversed(groups):
            if times[i]-times[g[0]]>600:break
            if match_evidence(feats[g[0]],feats[i],times[i]-times[g[0]]) and (len(g)==1 or match_evidence(feats[g[-1]],feats[i],times[i]-times[g[-1]])):
                g.append(i); found=True; break
        if not found:groups.append([i])
    for group in groups:
        rank=sorted(group,key=lambda i:(rows[i]['rating'],rows[i]['score']),reverse=True)
        quota=2 if len(group)>=5 else 1
        for pos,i in enumerate(rank):
            r=rows[i]; r.update(group=rows[group[0]]['id'],rank=pos+1,count=len(rank))
            if len(rank)>1 and pos>=quota:r['reason']='相似备选'
            elif len(rank)==1 and r['rating']<=0 and (r['score']<50 or r['clip']>.54):r['reason']='画质待核'
            elif len(rank)>1:r['reason']='组内优选'
            else:r['reason']='独立画面'
    finalists = sorted((r for r in rows if r["reason"] in {"组内优选", "独立画面"}),
                       key=lambda r:(r["rating"], r["score"]), reverse=True)
    for rank, row in enumerate(finalists[:min(40, max(1, math.ceil(len(rows)*0.07)))], 1):
        row["pick"] = rank
    explain_groups(rows, feats)
    (DATA/'catalog.tmp').write_text(json.dumps(rows,ensure_ascii=False))
    (DATA/'catalog.tmp').replace(DATA/'catalog.json')
    from collections import Counter
    print(Counter(r['reason'] for r in rows),Counter(r['rating'] for r in rows),flush=True)

if __name__=="__main__":main()
