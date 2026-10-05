"""验证官网构建在错误模式或地址下拒绝产出静态文件。"""
import os
from pathlib import Path
import subprocess
import unittest


class SiteUrlTest(unittest.TestCase):
    def check(self, mode, url, ip=""):
        env = dict(os.environ, DEPLOY_MODE=mode, NEXT_PUBLIC_APP_URL=url, PUBLIC_IP=ip)
        return subprocess.run(
            ["node", str(Path(__file__).with_name("check-site-url.mjs"))],
            env=env, capture_output=True, timeout=10,
        ).returncode

    def test_accepts_https_and_explicit_ip_modes(self):
        self.assertEqual(self.check("https_domains", "https://app.kleinbottle.top"), 0)
        self.assertEqual(self.check("http_ip", "http://117.72.100.212", "117.72.100.212"), 0)

    def test_default_mode_requires_https_domain(self):
        self.assertEqual(self.check("", "https://app.kleinbottle.top"), 0)
        self.assertNotEqual(self.check("", "http://117.72.100.212", "117.72.100.212"), 0)

    def test_rejects_mode_or_address_mismatch(self):
        for mode, url, ip in [
            ("automatic", "https://app.kleinbottle.top", ""),
            ("http_ip", "http://117.72.100.212", "117.72.100.213"),
            ("http_ip", "http://example.com", "example.com"),
            ("https_domains", "http://app.kleinbottle.top", ""),
            ("https_domains", "https://user:secret@app.kleinbottle.top", ""),
            ("https_domains", "https://app.kleinbottle.top/login", ""),
            ("https_domains", "https://app.kleinbottle.top/?invite=value", ""),
        ]:
            with self.subTest(mode=mode, url=url):
                self.assertNotEqual(self.check(mode, url, ip), 0)


if __name__ == "__main__":
    unittest.main()
