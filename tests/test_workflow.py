"""End-to-end checks using generated images and a disposable recovery directory."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


class Workflow(unittest.TestCase):
    def test_first_run_selection_reopen_and_confirmation(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work).resolve()
            source = root / "photos"
            source.mkdir()
            image = Image.new("RGB", (400, 300), "ivory")
            ImageDraw.Draw(image).polygon([(15, 280), (190, 80), (355, 240)], fill="teal")
            for name in ("frame", "other"):
                image.save(source / f"{name}.JPG")
            subprocess.run(["sips", "-s", "format", "heic", str(source / "frame.JPG"), "--out",
                            str(source / "frame.HEIC")], check=True, capture_output=True)
            (source / "single.HEIC").write_bytes((source / "frame.HEIC").read_bytes())
            (source / "broken.JPG").write_text("invalid image")
            env = dict(os.environ, XDG_DATA_HOME=str(root / "state"))
            def launch(*args):
                proc = subprocess.Popen([sys.executable, str(ROOT/"start.py"), "--no-open", *args],
                                        env=env, stdout=subprocess.PIPE, text=True)
                self.addCleanup(proc.stdout.close)
                self.addCleanup(proc.wait, 10)
                self.addCleanup(proc.terminate)
                for line in proc.stdout:
                    if line.startswith("http://"): return proc, line.strip()
                self.fail("没有启动：" + str(proc.wait()))
            proc, url = launch("--source", str(source))
            def get(path):
                with urllib.request.urlopen(url + path, timeout=15) as result:
                    return result.read()
            state = json.loads(get("api"))
            self.assertEqual(len(state["rows"]), 3)
            pair = next(row for row in state["rows"] if row["name"] == "frame")
            self.assertEqual(len(pair["files"]), 2)
            self.assertGreater(pair["count"], 1)
            for row in state["rows"]:
                self.assertEqual(row["score"], round(max(12, min(98, 51 + sum(row["parts"])))))
            alternative = next(row for row in state["rows"] if row["rank"] > 1)
            self.assertIsNotNone(alternative["comparison"]["match"])
            self.assertNotEqual(alternative["id"], alternative["comparison"]["peer"])
            self.assertTrue(get("p/" + pair["id"]).startswith(bytes.fromhex("ffd8")))
            def post(action, body):
                req = urllib.request.Request(url+action, data=json.dumps(body).encode(),
                    headers={"Origin":url.rstrip("/"),"Content-Type":"application/json","X-Review-Token":state["token"]})
                with urllib.request.urlopen(req, timeout=15) as res:return json.load(res)
            self.assertTrue(post("pick", {"id":pair["id"], "on":True})["picks"][pair["id"]])
            queue = post("queue", {"ids":[pair["id"]], "kind":"photo"})["queue"]
            self.assertTrue((source/"frame.JPG").exists())
            proc.terminate()
            proc.wait()
            proc, url = launch("--last")
            state = json.loads(get("api"))
            self.assertEqual(state["queue"],queue)
            self.assertIn("frame", (Path(state["library"])/"手机选片单.html").read_text())
            # Exercise file moves without touching the actual macOS Trash.
            script = """from pathlib import Path
from unittest.mock import patch
import library as lib
with lib.database() as db, patch.object(lib, 'check_volume',return_value=Path(__import__('sys').argv[1])):
    q=lib.snapshots(db)['queue']
    try:lib.remove_confirmed(db,lib.catalog(),{})
    except ValueError:pass
    else:raise AssertionError('accepted a stale confirmation')
    lib.remove_confirmed(db,lib.catalog(),q)
"""
            subprocess.run([sys.executable,"-c",script,str(root/"trash")],cwd=ROOT,
                           env=dict(env,PHOTO_STEWARD_SESSION=str(Path(state["library"]).parent)),check=True)
            self.assertFalse((source/"frame.JPG").exists())
            self.assertTrue((source/"other.JPG").exists())
            self.assertEqual(len(list((root/"trash").rglob("frame.*"))), 2)


if __name__ == "__main__":
    unittest.main()
