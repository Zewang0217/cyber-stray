"""Exercise the release scripts against a temporary host tree.

Nothing here touches the real /srv, OSS, Docker or SQLite: the scripts are copied
with their absolute roots rewritten into a scratch tree, and PATH shims stand in
for the outside world (ossutil, docker, curl, sqlite3) so the tests only assert
what a script does to files and which commands it issues. The `zstd` shim is
installed only when the host has no zstd, so on a machine that has one the real
format is exercised.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

DEPLOY = Path(__file__).parent
TAG = "c0ffee" * 6 + "beef"  # 40 lowercase hex chars
APP_IMAGE = "ghcr.io/zewang0217/cyber-stray-app"
WEB_IMAGE = "ghcr.io/zewang0217/cyber-stray-web"
CADDY_IMAGE = "ghcr.io/zewang0217/cyber-stray-caddy"
BUCKET = "bucket-under-test"

OSSUTIL_SHIM = '''#!/usr/bin/env python3
"""Fake ossutil: objects live as files under $TEST_OSS_ROOT/<bucket>/<key>."""
import os, pathlib, shutil, sys

root = pathlib.Path(os.environ["TEST_OSS_ROOT"])
log = os.environ.get("TEST_COMMAND_LOG")
args = sys.argv[1:]
if log:
    with open(log, "a") as out:
        out.write("ossutil " + " ".join(args) + "\\n")


def local(key):
    path = root / key
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def strip(uri):
    return uri[len("oss://"):]

if "cp" in args:
    index = args.index("cp")
    source, dest = args[index + 1], args[index + 2]
    if source.startswith("oss://"):
        shutil.copyfile(local(strip(source)), dest)
    else:
        shutil.copyfile(source, local(strip(dest)))
elif "ls" in args:
    prefix = strip([a for a in args if a.startswith("oss://")][0]).rstrip("/") + "/"
    directory = root / prefix
    for path in sorted(directory.rglob("*")) if directory.is_dir() else []:
        if path.is_file():
            print(f"{path.stat().st_size:>10}   2026-10-13 00:00:00   oss://{prefix}{path.relative_to(directory)}")
'''

SQLITE3_SHIM = '''#!/usr/bin/env python3
"""Fake sqlite3: `.backup` is a file copy, which is the whole observable contract."""
import shutil, sys

args = sys.argv[1:]
if len(args) >= 2 and args[1].startswith(".backup"):
    destination = args[1].split(".backup", 1)[1].strip().strip("'").strip('"')
    shutil.copyfile(args[0], destination)
'''

DOCKER_SHIM = '''#!/usr/bin/env python3
"""Fake docker: records invocations, never runs a container."""
import os, sys

args = sys.argv[1:]
log = os.environ.get("TEST_COMMAND_LOG")
if log:
    with open(log, "a") as out:
        # The IMAGE_TAG prefix the shell sets and the working directory are the two
        # things argv does not carry, so record them alongside the command.
        out.write("docker " + " ".join(args)
                  + f" [IMAGE_TAG={os.environ.get('IMAGE_TAG', '')}] [cwd={os.getcwd()}]\\n")
if args[:2] == ["compose", "version"]:
    print("Docker Compose version v2.29.0")
if args[:1] == ["load"] and "-i" in args:
    source = args[args.index("-i") + 1]
    if not os.path.isfile(source):
        sys.exit("docker shim: load input does not exist: " + source)
'''

CURL_SHIM = '''#!/usr/bin/env python3
import os, sys

log = os.environ.get("TEST_COMMAND_LOG")
if log:
    with open(log, "a") as out:
        out.write("curl " + " ".join(sys.argv[1:]) + "\\n")
'''

ZSTD_SHIM = '''#!/usr/bin/env python3
"""Fake zstd for hosts without one: same interface, gzip inside the container."""
import gzip, shutil, sys

args = sys.argv[1:]
files = [a for a in args if not a.startswith("-")]
if "-o" in args:
    with open(args[args.index("-o") + 1], "wb") as destination:
        with gzip.GzipFile(fileobj=destination, mode="wb") as archive:
            shutil.copyfileobj(sys.stdin.buffer, archive)
else:
    with gzip.open(files[0], "rb") as source:
        if "-t" in args:
            while source.read(1 << 20):
                pass
        else:
            shutil.copyfileobj(source, sys.stdout.buffer)
'''


class DeployScriptsTest(unittest.TestCase):
    def setUp(self):
        scratch = DEPLOY.resolve().parent / "scratch" / "tmp"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="cyber-stray-deploy-", dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.oss = self.root / "oss"
        self.oss.mkdir()
        self.log = self.root / "commands.log"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.srv = self.root / "srv"

        shims = [("ossutil", OSSUTIL_SHIM), ("sqlite3", SQLITE3_SHIM),
                 ("docker", DOCKER_SHIM), ("curl", CURL_SHIM)]
        if not shutil.which("zstd"):
            shims.append(("zstd", ZSTD_SHIM))
        for name, content in shims:
            shim = self.bin / name
            shim.write_text(content)
            shim.chmod(0o755)

        self.scripts = self.root / "scripts"
        self.scripts.mkdir()
        for name in ("deploy.sh", "backup.sh", "restore.sh"):
            # Absolute roots are rewritten into the scratch tree so a test run can
            # never touch the real deployment layout.
            (self.scripts / name).write_text(
                (DEPLOY / name).read_text().replace("/srv/", f"{self.srv.as_posix()}/"))

        self.layout()
        self.fixture()
        self.env = {**os.environ, "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
                    "TEST_OSS_ROOT": str(self.oss), "TEST_COMMAND_LOG": str(self.log),
                    "TMPDIR": str(self.root), "TMP": str(self.root), "TEMP": str(self.root)}

    # --- host tree ---------------------------------------------------------
    def layout(self):
        shared = self.srv / "cyber-stray"
        (shared / "prod" / "data").mkdir(parents=True)
        (shared / "staging" / "data").mkdir(parents=True)
        (shared / "infra").mkdir()
        (self.srv / "casdoor" / "casdoor").mkdir(parents=True)
        (shared / ".env").write_text("\n".join([
            "OSS_BUCKET=" + BUCKET,
            "OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com",
            "OSS_REGION=cn-hangzhou",
            "OSS_SRV_ACCESS_KEY_ID=test-id",
            "OSS_SRV_ACCESS_KEY_SECRET=test-secret",
        ]) + "\n")
        for environment, web_port in (("prod", "3000"), ("staging", "3001")):
            (shared / environment / ".env").write_text(f"CP_PORT=8787\nWEB_PORT={web_port}\n")
            (shared / environment / "compose.yaml").write_text("services: {}\n")
        (shared / "infra" / "compose.yaml").write_text("services: {}\n")
        (shared / "infra" / ".env").write_text("STAGING_AUTH_USER=ops\nSTAGING_AUTH_HASH=$2a$hash\n")
        (self.srv / "casdoor" / "compose.yaml").write_text("services: {}\n")
        (self.srv / "casdoor" / "casdoor" / "casdoor.db").write_bytes(b"casdoor accounts v1\n")

    def fixture(self):
        """The prod data tree a backup is expected to round-trip."""
        self.data = self.srv / "cyber-stray" / "prod" / "data"
        (self.data / "tenants" / "t1").mkdir(parents=True)
        (self.data / "tenants" / "t1" / "pet.md").write_text("# pet\nreal tenant data\n")
        (self.data / "master.key").write_text("0" * 64 + "\n")
        (self.data / "logs").mkdir()
        (self.data / "logs" / "app.log").write_text("rotated noise\n")
        (self.data / "control.db").write_bytes(b"control database v1\n")
        (self.data / "control.db-wal").write_bytes(b"wal\n")
        (self.data / "control.db-shm").write_bytes(b"shm\n")

    def tree(self):
        """Every file under data/ that a backup is expected to preserve."""
        return {path.relative_to(self.data).as_posix(): path.read_bytes()
                for path in sorted(self.data.rglob("*")) if path.is_file()
                and "logs" not in path.relative_to(self.data).parts
                and not path.name.startswith("control.db")}

    def backup_objects(self, environment="prod"):
        return sorted((self.oss / BUCKET / "backups" / environment).glob("*"))

    # --- helpers -----------------------------------------------------------
    # Not named `run`: that is unittest's own entry point on TestCase.
    def invoke(self, script, *args, env=None):
        return subprocess.run(["bash", str(self.scripts / script), *args],
                              env=env or self.env, text=True, capture_output=True, timeout=120)

    def commands(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def bundle(self):
        """Package the images tar and manifest the way the release pipeline does."""
        images = self.root / "images.tar"
        payload = json.dumps([{"RepoTags": [f"{APP_IMAGE}:{TAG}"]},
                              {"RepoTags": [f"{WEB_IMAGE}:{TAG}"]},
                              {"RepoTags": [f"{CADDY_IMAGE}:{TAG}"]}]).encode()
        with tarfile.open(images, "w") as archive:
            member = tarfile.TarInfo("manifest.json")
            member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload))
        release = self.oss / BUCKET / "releases" / TAG
        release.mkdir(parents=True)
        subprocess.run(["zstd", "-q", "-T0", "-o", str(release / "images.tar.zst"), str(images)],
                       check=True, env=self.env)
        manifest = {"version": 1, "tag": TAG,
                    "images": [f"{APP_IMAGE}:{TAG}", f"{WEB_IMAGE}:{TAG}", f"{CADDY_IMAGE}:{TAG}"],
                    "sha256": hashlib.sha256((release / "images.tar.zst").read_bytes()).hexdigest()}
        (release / "release.json").write_text(json.dumps(manifest) + "\n")

    # --- deploy.sh ---------------------------------------------------------
    def test_deploy_rejects_bad_environment_and_bad_tag(self):
        cases = [[], ["prod"], ["test", TAG], ["prod", "sha"], ["prod", TAG.replace("c", "C")],
                 ["prod", TAG + "0"], ["PROD", TAG]]
        for args in cases:
            result = self.invoke("deploy.sh", *args)
            self.assertEqual(result.returncode, 2, f"{args}: {result.stderr}")
            self.assertIn("deploy.sh:", result.stderr)
        self.assertEqual(self.commands(), [])

    def test_deploy_loads_images_before_starting_any_stack_and_never_pulls(self):
        self.bundle()
        result = self.invoke("deploy.sh", "prod", TAG)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        commands = self.commands()
        loaded = next(i for i, line in enumerate(commands) if line.startswith("docker load "))
        started = min(i for i, line in enumerate(commands) if "up -d" in line)
        self.assertLess(loaded, started)
        ups = [line for line in commands if line.startswith("docker compose ") and "up -d" in line]
        self.assertEqual(len(ups), 3)
        for line in ups:
            self.assertIn("--pull never", line)
            self.assertIn(f"[IMAGE_TAG={TAG}]", line)
        # Infra first, then the shared identity service, then the environment being
        # released; each from its own directory.
        srv = self.srv.as_posix()
        self.assertIn(f"[cwd={srv}/cyber-stray/infra]", ups[0])
        self.assertIn(f"[cwd={srv}/casdoor]", ups[1])
        self.assertIn(f"[cwd={srv}/cyber-stray/prod]", ups[2])
        self.assertIn("--wait", ups[0])
        self.assertEqual([line for line in commands if line.startswith("curl ")],
                         ["curl -fsS --max-time 10 http://127.0.0.1:3000/login",
                          "curl -fsS --max-time 10 http://127.0.0.1:8787/healthz",
                          "curl -fsS --max-time 10 http://127.0.0.1/healthz"])
        self.assertEqual((self.srv / "cyber-stray" / "prod" / "CURRENT_TAG").read_text().strip(), TAG)

    def test_deploy_fails_before_touching_the_host_when_the_bundle_is_corrupt(self):
        self.bundle()
        archive = self.oss / BUCKET / "releases" / TAG / "images.tar.zst"
        archive.write_bytes(archive.read_bytes()[:-8] + b"corrupt!")
        result = self.invoke("deploy.sh", "prod", TAG)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sha256 mismatch", result.stderr)
        # Only the tool probe may have run: nothing was loaded and no stack started.
        self.assertEqual([line for line in self.commands()
                          if line.startswith("docker ") and "compose version" not in line], [])
        self.assertFalse((self.srv / "cyber-stray" / "prod" / "CURRENT_TAG").exists())

    # --- backup -> restore round trip --------------------------------------
    def test_backup_then_restore_recovers_the_data_tree(self):
        before = self.tree()
        created = self.invoke("backup.sh", "prod")
        self.assertEqual(created.returncode, 0, created.stderr + created.stdout)
        objects = self.backup_objects()
        archive = [path for path in objects if path.suffix == ".zst"][0]
        manifest = json.loads([path for path in objects if path.suffix == ".json"][0].read_text())
        self.assertEqual(manifest["env"], "prod")
        self.assertIn("data/tenants/t1/pet.md", manifest["files"])
        self.assertIn("db/control.db", manifest["files"])
        self.assertIn("db/casdoor.db", manifest["files"])
        self.assertNotIn("data/control.db", manifest["files"])
        self.assertNotIn("data/logs/app.log", manifest["files"])
        self.assertEqual(manifest["sha256"], hashlib.sha256(archive.read_bytes()).hexdigest())

        # Wreck the live tree the way an operator's mistake would.
        (self.data / "control.db").write_bytes(b"torn\n")
        (self.data / "tenants" / "t1" / "pet.md").unlink()
        (self.data / "junk").mkdir()
        (self.data / "junk" / "stray.txt").write_text("should not survive\n")

        restored = self.invoke("restore.sh", "prod", "--no-restart")
        self.assertEqual(restored.returncode, 0, restored.stderr + restored.stdout)
        self.assertEqual(self.tree(), before)
        self.assertEqual((self.data / "control.db").read_bytes(), b"control database v1\n")
        self.assertFalse((self.data / "junk").exists())
        # The tree replaced by the restore is kept aside, so a bad restore is itself
        # reversible.
        kept = list((self.srv / "cyber-stray" / "prod").glob("data.bak-*"))
        self.assertEqual(len(kept), 1)
        self.assertEqual((kept[0] / "control.db").read_bytes(), b"torn\n")
        self.assertTrue((kept[0] / "junk" / "stray.txt").exists())
        # The account database is shared with the other environment: a data seed
        # must not roll it back.
        self.assertEqual((self.srv / "casdoor" / "casdoor" / "casdoor.db").read_bytes(),
                         b"casdoor accounts v1\n")

    def test_restore_can_replace_the_account_database_on_request(self):
        self.assertEqual(self.invoke("backup.sh", "prod").returncode, 0)
        accounts = self.srv / "casdoor" / "casdoor" / "casdoor.db"
        accounts.write_bytes(b"newer accounts\n")
        result = self.invoke("restore.sh", "prod", "--with-accounts")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(accounts.read_bytes(), b"casdoor accounts v1\n")
        self.assertEqual(len(list((self.srv / "casdoor" / "casdoor").glob("casdoor.db.bak-*"))), 1)
        # Both stacks are stopped before anything is swapped and started after, in
        # the reverse order.
        lines = [line for line in self.commands() if " stop" in line or " start" in line]
        srv = self.srv.as_posix()
        keep = self.srv / "cyber-stray" / "prod"
        self.assertEqual([line.split(" [")[0] for line in lines],
                         [f"docker compose -p cyber-stray-prod -f {keep}/compose.yaml stop",
                          f"docker compose -p cyber-stray-casdoor -f {srv}/casdoor/compose.yaml stop",
                          f"docker compose -p cyber-stray-casdoor -f {srv}/casdoor/compose.yaml start",
                          f"docker compose -p cyber-stray-prod -f {keep}/compose.yaml start"])

    def test_restore_picks_the_newest_backup_of_the_environment_by_default(self):
        self.assertEqual(self.invoke("backup.sh", "prod").returncode, 0)
        current = [path for path in self.backup_objects() if path.suffix == ".zst"][0]
        shutil.copyfile(current, current.with_name("backup-20200101T000000Z.tar.zst"))
        result = self.invoke("restore.sh", "prod", "--no-restart")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertNotIn("backup-20200101T000000Z.tar.zst", result.stdout)

    # --- restore.sh local + argument handling ------------------------------
    def test_restore_local_unpacks_into_the_given_directory_and_touches_no_stack(self):
        self.assertEqual(self.invoke("backup.sh", "prod").returncode, 0)
        destination = self.root / "checkout-data"
        result = self.invoke("restore.sh", "local", "--dir", str(destination))
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(sorted(path.relative_to(destination).as_posix()
                                for path in destination.rglob("*") if path.is_file()),
                         ["control.db", "master.key", "tenants/t1/pet.md"])
        self.assertEqual((destination / "control.db").read_bytes(), b"control database v1\n")
        self.assertEqual([line for line in self.commands() if line.startswith("docker ")], [])

    def test_restore_rejects_invalid_arguments(self):
        cases = [[], ["testing"], ["local"], ["prod", "--dir", str(self.root)],
                 ["prod", "--from"], ["prod", "--unknown"]]
        for args in cases:
            result = self.invoke("restore.sh", *args)
            self.assertEqual(result.returncode, 2, f"{args}: {result.stdout}{result.stderr}")
            self.assertIn("restore.sh:", result.stderr)

    def test_backup_rejects_bad_environment_and_missing_data(self):
        rejected = self.invoke("backup.sh", "test")
        self.assertEqual(rejected.returncode, 2)
        self.assertIn("backup.sh:", rejected.stderr)
        shutil.rmtree(self.data)
        result = self.invoke("backup.sh", "prod")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("backup.sh:", result.stderr)
        self.assertEqual(self.backup_objects(), [])


if __name__ == "__main__":
    unittest.main()
