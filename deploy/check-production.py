#!/usr/bin/env python3
"""Read-only production checks. Never source .env or print secret values."""
import argparse
from pathlib import Path
import re
import subprocess
import sys

EXPECTED_URLS = {
    "CP_WEB_ORIGIN": "https://app.kleinbottle.top",
    "CASDOOR_ISSUER": "https://auth.kleinbottle.top",
    "CASDOOR_REDIRECT_URI": "https://app.kleinbottle.top/api/auth/callback",
}
HOSTS = ("kleinbottle.top", "app.kleinbottle.top", "auth.kleinbottle.top")


def read_urls(path: Path) -> dict[str, str]:
    """Read only the three public URL settings; duplicate keys are errors."""
    result = {}
    for line in path.read_text().splitlines():
        key, sep, value = line.strip().partition("=")
        plain_value = value.split(" #", 1)[0].strip().strip("\"'")
        if sep and re.fullmatch(r"(https?|all)_proxy", key, re.IGNORECASE) and plain_value:
            raise ValueError("Bun 出站安全传输不支持代理环境变量；请移除 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY")
        if sep and key in EXPECTED_URLS:
            if key in result:
                raise ValueError(f"重复环境变量：{key}")
            result[key] = plain_value.rstrip("/")
    return result


def openssl(*args: str) -> bytes:
    """Run a bounded check without echoing certificate/key content."""
    return subprocess.run(
        ["openssl", *args], check=True, capture_output=True, timeout=10
    ).stdout


def validate(env_file: Path, cert_dir: Path, ca_file: Path | None = None) -> None:
    """Require consistent HTTPS domains and a matching, current certificate."""
    urls = read_urls(env_file)
    for key, expected in EXPECTED_URLS.items():
        if urls.get(key) != expected:
            raise ValueError(f"{key} 必须配置为 {expected}")
    cert, key = cert_dir / "fullchain.pem", cert_dir / "privkey.pem"
    if not cert.is_file() or not key.is_file():
        raise ValueError("三域名 HTTPS 证书或私钥缺失；先完成证书签发")
    for host in HOSTS:
        # x509 -checkhost returns exit code 0 even for a hostname mismatch.
        result = openssl("x509", "-in", str(cert), "-noout", "-checkhost", host)
        if result.decode().strip() != f"Hostname {host} does match certificate":
            raise ValueError(f"HTTPS 证书未覆盖 {host}")
    openssl("x509", "-in", str(cert), "-noout", "-checkend", "86400")
    # System trust by default; tests inject a temporary CA. verify also checks NotBefore.
    trust_args = ("-CAfile", str(ca_file)) if ca_file else ()
    openssl("verify", "-purpose", "sslserver", "-untrusted", str(cert), *trust_args, str(cert))
    public_cert = openssl("x509", "-in", str(cert), "-noout", "-pubkey")
    public_key = openssl("pkey", "-in", str(key), "-pubout")
    if public_cert != public_key:
        raise ValueError("HTTPS 证书与私钥不匹配")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", type=Path, default=Path("/opt/cyber-stray/.env"))
    parser.add_argument("--cert-dir", type=Path,
                        default=Path("/etc/letsencrypt/live/kleinbottle.top"))
    args = parser.parse_args()
    try:
        validate(args.env, args.cert_dir)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        detail = str(error) if isinstance(error, ValueError) else "文件不可读或证书校验失败"
        print(f"发布预检失败：{detail}。参见 deploy/README.md。", file=sys.stderr)
        return 1
    print("发布预检通过：HTTPS URL / 证书域名 / 有效期 / 密钥匹配")
    return 0


if __name__ == "__main__":
    sys.exit(main())
