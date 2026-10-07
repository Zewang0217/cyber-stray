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
        temporary_root = Path(__file__).resolve().parent.parent / "scratch" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="cyber-stray-tls-", dir=temporary_root)
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

    def test_explicit_http_ip_acceptance_requires_no_certificate(self):
        self.http_env()
        preflight.validate(self.env, self.root, mode="http_ip", public_ip="117.72.100.212")

    def http_env(self):
        self.env.write_text("CP_WEB_ORIGIN=http://117.72.100.212\n"
                            "CASDOOR_ISSUER=http://117.72.100.212:8000\n"
                            "CASDOOR_REDIRECT_URI=http://117.72.100.212/api/auth/callback\n")

    def test_http_ip_never_activates_implicitly(self):
        self.http_env()
        with self.assertRaisesRegex(ValueError, "CP_WEB_ORIGIN"):
            preflight.validate(self.env, self.root)

    def test_rejects_unknown_mode_or_ip_in_https_mode(self):
        for mode, public_ip in (("auto", None), ("https_domains", "117.72.100.212")):
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                preflight.validate(self.env, self.root, mode=mode, public_ip=public_ip)

    def test_ip_mode_requires_canonical_public_ipv4(self):
        self.http_env()
        for value in (None, "", "localhost", "127.0.0.1", "10.0.0.1", "100.64.0.1",
                      "169.254.169.254", "192.0.2.1", "224.0.0.1", "240.0.0.1",
                      "::1", "117.72.100.212:80", "117.072.100.212"):
            with self.subTest(public_ip=value), self.assertRaisesRegex(ValueError, "公网 IPv4"):
                preflight.validate(self.env, self.root, mode="http_ip", public_ip=value)

    def test_ip_mode_rejects_each_mismatched_public_url(self):
        mismatches = {
            "CP_WEB_ORIGIN": ("https://117.72.100.212", "http://117.72.100.212:80",
                              "http://117.72.100.212/", "http://user@117.72.100.212"),
            "CASDOOR_ISSUER": ("https://auth.kleinbottle.top", "http://117.72.100.212:8001"),
            "CASDOOR_REDIRECT_URI": ("http://117.72.100.213/api/auth/callback",
                                     "http://117.72.100.212/api/auth/callback?next=/"),
        }
        for key, values in mismatches.items():
            for value in values:
                self.http_env()
                lines = self.env.read_text().splitlines()
                self.env.write_text("\n".join(f"{key}={value}" if line.startswith(f"{key}=")
                                              else line for line in lines))
                with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, key):
                    preflight.validate(self.env, self.root, mode="http_ip", public_ip="117.72.100.212")

    def test_ip_mode_still_rejects_bun_proxy(self):
        self.http_env()
        with self.env.open("a") as out:
            out.write("ALL_PROXY=http://secret@proxy.example\n")
        with self.assertRaisesRegex(ValueError, "Bun") as caught:
            preflight.validate(self.env, self.root, mode="http_ip", public_ip="117.72.100.212")
        self.assertNotIn("secret", str(caught.exception))

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
