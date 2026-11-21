"""Session locations are private to the macOS user, outside the source checkout."""
import json
import os
import plistlib
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = Path(os.environ.get("XDG_DATA_HOME", Path.home() / "Library/Application Support")) / "PhotoSteward"


def disk(path):
    # diskutil accepts a device or mount point; an arbitrary folder may be inside an APFS firmlink.
    line = subprocess.check_output(["/bin/df", "-P", str(path)], text=True).splitlines()[-1]
    device = line.split()[0]
    info = plistlib.loads(subprocess.check_output(["/usr/sbin/diskutil", "info", "-plist", device]))
    if not info.get("VolumeUUID"):
        raise ValueError("无法辨认来源卷。请选择本机磁盘、相机卷或读卡器上的文件夹。")
    return info["VolumeUUID"], Path(info["MountPoint"])


def session():
    folder = Path(os.environ["PHOTO_STEWARD_SESSION"])
    return folder, json.loads((folder / "source.json").read_text())
