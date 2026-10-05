"""Exercise mode selection in a temporary host tree; never contact Docker or production."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

DEPLOY = Path(__file__).parent
PUBLIC_IP = "117.72.100.212"


class ContainerUpdateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cyber-stray-update-", dir="/tmp")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.deploy = self.root / "deploy"
        self.deploy.mkdir()
        for name in ("container-update.sh", "check-production.py", "compose.yaml", "compose.http-ip.yaml"):
            self.copy(DEPLOY / name, self.deploy / name)
        for source in ("casdoor/app.conf", "casdoor/app.http-ip.conf",
                       "nginx/cyber-stray.conf", "nginx/cyber-stray.http-ip.conf"):
            self.copy(DEPLOY / source, self.deploy / Path(source).name)
        self.env_file = self.root / ".env"
        self.env_file.write_text(f"CP_WEB_ORIGIN=http://{PUBLIC_IP}\n"
                                 f"CASDOOR_ISSUER=http://{PUBLIC_IP}:8000\n"
                                 f"CASDOOR_REDIRECT_URI=http://{PUBLIC_IP}/api/auth/callback\n")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "commands.jsonl"
        fake = """#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['TEST_COMMAND_LOG'], 'a') as out:
    out.write(json.dumps([name, *args]) + '\\n')
if 'version' in args:
    print('2.24.4')
if 'config' in args and os.environ.get('TEST_REJECT_COMPOSE'):
    sys.exit(1)
if 'ps' in args:
    print('healthy' if '{{.Health}}' in args else 'cyber-stray-nginx')
"""
        for name in ("docker", "curl"):
            path = self.bin / name
            path.write_text(fake)
            path.chmod(0o755)
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}",
                    "TEST_COMMAND_LOG": str(self.log), "OPS_ALERT_WEBHOOK_URL": ""}

    def copy(self, source, destination):
        destination.write_text(source.read_text().replace("/opt/cyber-stray", str(self.root)))

    def update(self, *args, env=None):
        return subprocess.run(["bash", str(self.deploy / "container-update.sh"), "--tag", "test-tag", *args],
                              env=env or self.env, text=True, capture_output=True, timeout=15)

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_http_ip_selects_override_and_renders_before_start_without_env_write(self):
        before = self.env_file.read_bytes()
        result = self.update("--mode", "http_ip", "--public-ip", PUBLIC_IP)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(self.env_file.read_bytes(), before)
        casdoor = (self.root / "casdoor/conf/app.conf").read_text()
        nginx = (self.deploy / "nginx-http-ip/cyber-stray.conf").read_text()
        self.assertIn(f"origin = http://{PUBLIC_IP}:8000", casdoor)
        self.assertIn(f"server_name {PUBLIC_IP};", nginx)
        self.assertNotIn("__PUBLIC_IP__", casdoor + nginx)
        self.assertFalse((self.deploy / "nginx/cyber-stray.conf").exists())
        for command in self.commands():
            if command[:2] == ["docker", "compose"] and "version" not in command:
                self.assertEqual(command[2:6], ["-f", str(self.deploy / "compose.yaml"),
                                                "-f", str(self.deploy / "compose.http-ip.yaml")])
            if command[0] == "curl":
                self.assertFalse(any("https://" in value for value in command))
        self.assertIn(["curl", "-fsS", "-H", f"Host: {PUBLIC_IP}", "http://127.0.0.1/login"], self.commands())
        self.assertEqual(list(self.deploy.glob(".render.*")), [])

    def test_repeated_update_preserves_nginx_bind_inode_and_reloads_changed_content(self):
        args = ("--mode", "http_ip", "--public-ip", PUBLIC_IP)
        first = self.update(*args)
        self.assertEqual(first.returncode, 0, first.stderr)
        active = self.deploy / "nginx-http-ip/cyber-stray.conf"
        inode = active.stat().st_ino
        with (self.deploy / "cyber-stray.http-ip.conf").open("a") as output:
            output.write("\n# 配置内容变更样例\n")
        second = self.update(*args)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(active.stat().st_ino, inode)
        self.assertIn("配置内容变更样例", active.read_text())
        reloads = [command for command in self.commands() if command[-3:] == ["nginx", "-s", "reload"]]
        self.assertEqual(len(reloads), 2)

    def test_early_failure_does_not_delete_inherited_render_directory(self):
        sentinel = self.root / "caller-owned"
        sentinel.mkdir()
        result = self.update("--mode", "auto", env={**self.env, "RENDER_DIR": str(sentinel)})
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(sentinel.is_dir())

    def test_default_unknown_mismatch_and_unsupported_compose_leave_config_untouched(self):
        cases = [([], self.env), (["--mode", "auto"], self.env),
                 (["--mode", "http_ip", "--public-ip", "117.72.100.213"], self.env),
                 (["--mode", "http_ip", "--public-ip", PUBLIC_IP],
                  {**self.env, "TEST_REJECT_COMPOSE": "1"})]
        for args, env in cases:
            with self.subTest(args=args, compose_reject=env.get("TEST_REJECT_COMPOSE")):
                result = self.update(*args, env=env)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / "casdoor").exists())
                self.assertFalse((self.deploy / "nginx-http-ip").exists())
                self.assertFalse(any("pull" in command or "up" in command for command in self.commands()))

    @unittest.skipUnless(shutil.which("docker"), "Docker Compose parser unavailable")
    def test_real_compose_merge_replaces_tls_ports_and_mounts(self):
        result = subprocess.run(["docker", "compose", "-f", str(self.deploy / "compose.yaml"),
                                 "-f", str(self.deploy / "compose.http-ip.yaml"), "config", "--format", "json"],
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        services = json.loads(result.stdout)["services"]
        self.assertEqual([port["published"] for port in services["nginx"]["ports"]], ["80"])
        self.assertEqual(len(services["nginx"]["volumes"]), 1)
        self.assertEqual(services["nginx"]["volumes"][0]["source"],
                         str(self.deploy / "nginx-http-ip/cyber-stray.conf"))
        self.assertEqual(services["casdoor"]["ports"], [{"mode": "ingress", "target": 8000,
                                                        "published": "8000", "protocol": "tcp"}])
        base = subprocess.run(["docker", "compose", "-f", str(self.deploy / "compose.yaml"),
                               "config", "--format", "json"], text=True, capture_output=True, timeout=15)
        self.assertEqual(base.returncode, 0, base.stderr)
        base_services = json.loads(base.stdout)["services"]
        self.assertEqual([port["published"] for port in base_services["nginx"]["ports"]], ["80", "443"])
        self.assertIn("/etc/letsencrypt", [volume["source"] for volume in base_services["nginx"]["volumes"]])
        self.assertEqual(base_services["casdoor"]["ports"][0]["host_ip"], "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
