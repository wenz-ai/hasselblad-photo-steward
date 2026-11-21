import argparse
import hashlib
import json
import os
import sys
import uuid
import webbrowser
from pathlib import Path
from settings import BASE, disk


def choose_source(named):
    if named:
        source = Path(named).expanduser().resolve(strict=True)
        if not source.is_dir():
            raise ValueError("请选择照片文件夹。")
        return source
    options = sorted(path for path in Path("/Volumes").glob("*/DCIM") if path.is_dir())
    if len(options) == 1:
        return options[0].resolve()
    listing = "、".join(map(str, options))
    raise ValueError(f"请用 --source 指定照片文件夹。检测到的 DCIM 目录：{listing or '无'}")


def open_session(args):
    if args.last:
        data = BASE / "libraries" / (BASE / "last.txt").read_text().strip()
        if not (data / "catalog.json").is_file():
            raise ValueError("上次片库不可用。")
        return data
    source = choose_source(args.source)
    volume_id, _ = disk(source)
    key = hashlib.sha256(f"{volume_id}/{source}".encode()).hexdigest()[:24]
    directory = BASE / "libraries" / key
    if not args.rescan and (directory / "current.txt").exists():
        data = directory / (directory / "current.txt").read_text().strip()
        if (data / "catalog.json").is_file():
            return data
    data = directory / uuid.uuid4().hex
    data.mkdir(parents=True)
    (data / "source.json").write_text(json.dumps({"source":str(source),"volume":volume_id},ensure_ascii=False))
    os.environ["PHOTO_STEWARD_SESSION"] = str(data)
    import index_photos
    index_photos.main()
    set_pointer(directory / "current.txt", data.name)
    return data


def set_pointer(path, value):
    temp = path.with_suffix("." + uuid.uuid4().hex + ".tmp")
    temp.write_text(str(value))
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser(description="在本机筛照片，生成带缩略图的手机选片单。")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--source", help="DCIM 或任意照片文件夹，支持含空格的路径")
    mode.add_argument("--last", action="store_true", help="离线打开上次的片库")
    parser.add_argument("--rescan", action="store_true", help="新建一次独立选片，旧记录保存在原片库")
    parser.add_argument("--no-open", action="store_true", help="只打印地址，由 Codex 打开审片台")
    args = parser.parse_args()
    if args.last and args.rescan:
        parser.error("--last 与 --rescan 不能同时使用")
    if args.last and not (BASE / "last.txt").is_file():
        parser.error("还没有上次片库，请先导入照片。")
    data = open_session(args)
    os.environ["PHOTO_STEWARD_SESSION"] = str(data)
    set_pointer(BASE / "last.txt", data.relative_to(BASE / "libraries"))
    from library import catalog, database, mobile_list, writer
    from server import serve
    with writer(), database() as db:
        mobile_list(catalog(), db)
    serve(open_browser=not args.no_open)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        sys.exit(str(error))
