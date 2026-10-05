#!/usr/bin/env python3
"""Read-only production checks. Never source .env or print secret values."""
import argparse
from ipaddress import IPv4Address
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
DEPLOY_MODES = ("https_domains", "http_ip")


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
            result[key] = plain_value
    return result


def openssl(*args: str) -> bytes:
    """Run a bounded check without echoing certificate/key content."""
    return subprocess.run(
        ["openssl", *args], check=True, capture_output=True, timeout=10
    ).stdout


def expected_urls(mode: str, public_ip: str | None) -> dict[str, str]:
    """HTTP acceptance is opt-in and bound to one canonical public IPv4 address."""
    if mode not in DEPLOY_MODES:
        raise ValueError("未知发布模式；仅支持 https_domains / http_ip")
    if mode == "https_domains":
        if public_ip is not None:
            raise ValueError("https_domains 模式不能传 --public-ip")
        return EXPECTED_URLS
    try:
        address = IPv4Address(public_ip or "")
    except ValueError as error:
        raise ValueError("http_ip 模式必须指定合法的公网 IPv4 --public-ip") from error
    if not address.is_global or address.is_multicast or address.is_reserved:
        raise ValueError("http_ip 模式必须指定合法的公网 IPv4 --public-ip")
    origin = f"http://{address}"
    return {
        "CP_WEB_ORIGIN": origin,
        "CASDOOR_ISSUER": f"{origin}:8000",
        "CASDOOR_REDIRECT_URI": f"{origin}/api/auth/callback",
    }


def validate(env_file: Path, cert_dir: Path, ca_file: Path | None = None,
             *, mode: str = "https_domains", public_ip: str | None = None) -> None:
    """Require exact public URLs; only the explicit IP mode skips TLS checks."""
    expected = expected_urls(mode, public_ip)
    urls = read_urls(env_file)
    for key, value in expected.items():
        if urls.get(key) != value:
            raise ValueError(f"{key} 必须配置为 {value}")
    if mode == "http_ip":
        return
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
    parser.add_argument("--mode", choices=DEPLOY_MODES, default="https_domains")
    parser.add_argument("--public-ip", help="仅用于显式 http_ip 验收模式的公网 IPv4")
    args = parser.parse_args()
    try:
        validate(args.env, args.cert_dir, mode=args.mode, public_ip=args.public_ip)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        detail = str(error) if isinstance(error, ValueError) else "文件不可读或证书校验失败"
        print(f"发布预检失败：{detail}。参见 deploy/README.md。", file=sys.stderr)
        return 1
    if args.mode == "http_ip":
        print("发布预检通过：http_ip 显式验收模式 / 公网 IPv4 / HTTP URL 一致")
    else:
        print("发布预检通过：HTTPS URL / 证书域名 / 有效期 / 密钥匹配")
    return 0


if __name__ == "__main__":
    sys.exit(main())
