"""Exercise release preflight using temporary certificates, without any DB."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "check_production", Path(__file__).with_name("check-production.py"))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class ProductionPreflightTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cyber-stray-tls-", dir="/tmp")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = self.root / ".env"
        self.env.write_text("\n".join(f"{k}={v}" for k, v in preflight.EXPECTED_URLS.items()))

    def certificate(self, domains):
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(self.root / "privkey.pem"),
            "-out", str(self.root / "fullchain.pem"), "-days", "2",
            "-subj", "/CN=kleinbottle.top", "-addext",
            "subjectAltName=" + ",".join("DNS:" + domain for domain in domains),
        ], check=True, capture_output=True, timeout=10)

    def test_accepts_consistent_https_configuration(self):
        self.certificate(preflight.HOSTS)
        preflight.validate(self.env, self.root, ca_file=self.root / "fullchain.pem")

    def test_rejects_untrusted_self_signed_certificate(self):
        self.certificate(preflight.HOSTS)
        with self.assertRaises(subprocess.CalledProcessError):
            preflight.validate(self.env, self.root)

    def test_rejects_bun_proxy_without_revealing_credentials(self):
        with self.env.open("a") as out:
            out.write("\nhttp_proxy=https://secret-credential@proxy.example\n")
        with self.assertRaisesRegex(ValueError, "Bun") as caught:
            preflight.validate(self.env, self.root)
        self.assertNotIn("secret-credential", str(caught.exception))

    def test_rejects_certificate_missing_auth_domain(self):
        self.certificate(preflight.HOSTS[:2])
        with self.assertRaisesRegex(ValueError, "auth.kleinbottle.top"):
            preflight.validate(self.env, self.root)

    def test_rejects_http_before_reading_certificates(self):
        self.env.write_text(self.env.read_text().replace("https:", "http:"))
        with self.assertRaisesRegex(ValueError, "CP_WEB_ORIGIN"):
            preflight.validate(self.env, self.root)

    def test_rejects_duplicate_url_setting(self):
        with self.env.open("a") as out:
            out.write("\nCP_WEB_ORIGIN=https://app.kleinbottle.top\n")
        with self.assertRaisesRegex(ValueError, "重复环境变量"):
            preflight.validate(self.env, self.root)


if __name__ == "__main__":
    unittest.main()
