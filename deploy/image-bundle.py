#!/usr/bin/env python3
"""Transfer Compose images through a checked archive, without production registry access."""
import argparse
import gzip
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

ARCHIVE = "images.tar.gz"
MANIFEST = "release.json"
PLATFORM = ("linux", "amd64")
DOWNLOAD = "download.json"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Keep the GitHub token on api.github.com; only the signed URL reaches production."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def link(bundle: Path, artifact_id: int, digest: str, proxy: str) -> None:
    """Create private, short-lived download metadata on the runner, never exporting its token."""
    if artifact_id <= 0 or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("构建产物 ID 或 SHA256 不合法")
    repository = os.environ["GITHUB_REPOSITORY"]
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("GitHub 仓库名不合法")
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/actions/artifacts/{artifact_id}/zip",
        headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"],
                 "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
    )
    try:
        urllib.request.build_opener(NoRedirect()).open(request, timeout=30)
    except urllib.error.HTTPError as error:
        if error.code != 302:
            raise ValueError(f"获取构建产物下载地址失败：HTTP {error.code}") from None
        url = error.headers["Location"]
    else:
        raise ValueError("GitHub 未返回构建产物下载跳转")
    validate_download_url(url)
    print(f"::add-mask::{url}", flush=True)
    descriptor = os.open(bundle / DOWNLOAD, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump({"url": url, "sha256": digest, "proxy": proxy}, output)


def validate_download_url(url: str) -> None:
    """Only accept HTTPS artifact storage URLs; credentials are not logged or passed to a shell."""
    if not isinstance(url, str) or any(c.isspace() for c in url):
        raise ValueError("构建产物下载地址不合法")
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname or ""
    if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment
            or not host.endswith((".blob.core.windows.net", ".actions.githubusercontent.com"))):
        raise ValueError("构建产物下载地址必须来自 GitHub Actions 的 HTTPS 存储")


def download_part(url: str, proxy: str, start: int, end: int, path: Path, deadline: float) -> None:
    """Require a precise byte range; all eight requests start before the signed URL expires."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": proxy} if proxy else {}))
    offset = start
    for attempt in range(5):
        if time.monotonic() > deadline:
            raise ValueError("构建产物下载超过 20 分钟，停止发布")
        request = urllib.request.Request(url, headers={"Range": f"bytes={offset}-{end}"})
        failure = "提前 EOF"
        try:
            with opener.open(request, timeout=30) as source, path.open("ab") as output:
                expected = f"bytes {offset}-{end}"
                if source.status != 206 or source.headers.get("Content-Range", "").split("/", 1)[0] != expected:
                    raise ValueError("构建产物服务器未返回请求的完整分段")
                while chunk := source.read(1024 * 1024):
                    if time.monotonic() > deadline:
                        raise ValueError("构建产物下载超过 20 分钟，停止发布")
                    output.write(chunk)
                    offset += len(chunk)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504):
                raise
            failure = f"HTTP {error.code}"
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as error:
            # Offset counts only bytes written; interrupted reads are requested again.
            failure = type(error).__name__
        if offset == end + 1:
            return
        if offset > end + 1:
            raise ValueError("构建产物分段超过请求长度")
        if attempt < 4:
            print(f"分段 {start}-{end} {failure}：已收 {offset - start} bytes，续传 {attempt + 1}/4", flush=True)
            time.sleep(1)
    raise ValueError(f"构建产物分段 {start}-{end} 在 5 次请求后仍不完整，已收 {offset - start} bytes")


def download(bundle: Path) -> None:
    """Fetch and verify the Actions zip, then copy only the two expected files, without extractall."""
    metadata = json.loads((bundle / DOWNLOAD).read_text())
    if not isinstance(metadata, dict) or set(metadata) != {"url", "sha256", "proxy"}:
        raise ValueError("构建产物下载信息不合法")
    url, digest, proxy = metadata["url"], metadata["sha256"], metadata["proxy"]
    validate_download_url(url)
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("构建产物 SHA256 不合法")
    if not isinstance(proxy, str) or (proxy and urllib.parse.urlsplit(proxy).scheme not in ("http", "https")):
        raise ValueError("构建产物下载代理不合法")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": proxy} if proxy else {}))
    archive = bundle / "artifact.zip"
    start = time.monotonic()
    parts = []
    try:
        with opener.open(urllib.request.Request(url, method="HEAD"), timeout=30) as response:
            size = int(response.headers["Content-Length"])
        if size <= 0:
            raise ValueError("构建产物大小不合法")
        connections = min(8, size)
        block = (size + connections - 1) // connections
        with ThreadPoolExecutor(max_workers=connections) as pool:
            tasks = []
            for index, first in enumerate(range(0, size, block)):
                path = bundle / f"artifact.part-{index}"
                parts.append(path)
                tasks.append(pool.submit(download_part, url, proxy, first, min(first + block, size) - 1,
                                         path, start + 1200))
            for task in tasks:
                task.result()
        with archive.open("wb") as output:
            for part in parts:
                with part.open("rb") as source:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
        if sha256(archive) != digest:
            raise ValueError("构建产物 ZIP SHA256 校验失败")
        with zipfile.ZipFile(archive) as zipped:
            if sorted(zipped.namelist()) != sorted((ARCHIVE, MANIFEST)):
                raise ValueError("构建产物 ZIP 文件清单不合法")
            for name in (ARCHIVE, MANIFEST):
                with zipped.open(name) as source, (bundle / name).open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
        print(f"HTTPS 下载及 ZIP 校验完成：{size} bytes，{time.monotonic() - start:.1f}s", flush=True)
    finally:
        for part in parts:
            part.unlink(missing_ok=True)
        archive.unlink(missing_ok=True)
        (bundle / DOWNLOAD).unlink(missing_ok=True)


def compose_images(compose: Path, tag: str) -> list[str]:
    """Resolve image references from the authoritative Compose file, without reading secrets."""
    if not re.fullmatch(r"[0-9a-f]{7,64}", tag):
        raise ValueError("镜像 tag 必须为 7–64 位小写十六进制 commit sha")
    result = subprocess.run(
        ["docker", "compose", "-f", str(compose), "config", "--no-env-resolution", "--images"],
        env={**os.environ, "IMAGE_TAG": tag}, check=True, capture_output=True, text=True, timeout=30,
    )
    refs = sorted(set(result.stdout.splitlines()))
    if not refs or any(not ref or ref.startswith("-") or any(c.isspace() for c in ref) for ref in refs):
        raise ValueError("Compose 镜像清单为空或不合法")
    return refs


def sha256(path: Path) -> str:
    """Hash the complete archive using bounded memory."""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_archive(path: Path, refs: list[str]) -> None:
    """Require exactly the expected tags; inspect tar metadata without extracting files."""
    with tarfile.open(path, "r:gz") as archive:
        member = archive.getmember("manifest.json")
        if not member.isfile() or member.size > 1024 * 1024:
            raise ValueError("镜像包 manifest.json 不合法")
        with archive.extractfile(member) as source:
            entries = json.load(source)
        if not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries):
            raise ValueError("镜像包清单不合法")
        tags = []
        for entry in entries:
            values = entry.get("RepoTags")
            if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
                raise ValueError("镜像包 RepoTags 不合法")
            tags.extend(values)
        if sorted(tags) != refs:
            raise ValueError("镜像包中的 tag 与本次 Compose 镜像清单不一致")


def check_platform(refs: list[str]) -> None:
    """Confirm every loaded tag is available for the production architecture."""
    for ref in refs:
        result = subprocess.run(["docker", "image", "inspect", ref], check=True,
                                capture_output=True, text=True, timeout=30)
        images = json.loads(result.stdout)
        if (not isinstance(images, list) or len(images) != 1 or not isinstance(images[0], dict)
                or (images[0].get("Os"), images[0].get("Architecture")) != PLATFORM):
            raise ValueError(f"镜像不是 linux/amd64：{ref}")


def pack(bundle: Path, refs: list[str], tag: str) -> None:
    """Pull on the Actions runner and export all service images into one archive."""
    bundle.mkdir(parents=True, exist_ok=False)
    for ref in refs:
        subprocess.run(["docker", "pull", "--platform", "/".join(PLATFORM), ref],
                       check=True, timeout=600)
    check_platform(refs)
    raw = bundle / "images.tar"
    try:
        subprocess.run(["docker", "image", "save", "--output", str(raw), *refs],
                       check=True, timeout=600)
        with raw.open("rb") as source, gzip.open(bundle / ARCHIVE, "wb", compresslevel=1) as output:
            shutil.copyfileobj(source, output, length=1024 * 1024)
    finally:
        raw.unlink(missing_ok=True)
    check_archive(bundle / ARCHIVE, refs)
    manifest = {"version": 1, "tag": tag, "images": refs, "sha256": sha256(bundle / ARCHIVE)}
    (bundle / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"镜像包：{(bundle / ARCHIVE).stat().st_size} bytes，SHA256={manifest['sha256']}", flush=True)


def load(bundle: Path, refs: list[str], tag: str) -> None:
    """Reject wrong releases or corrupt transfers before loading any image or starting services."""
    manifest = json.loads((bundle / MANIFEST).read_text())
    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        raise ValueError("镜像包版本不合法")
    if manifest.get("tag") != tag or manifest.get("images") != refs:
        raise ValueError("镜像包版本/tag/镜像清单与本次发布不一致")
    digest = manifest.get("sha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("镜像包 SHA256 不合法")
    archive = bundle / ARCHIVE
    if sha256(archive) != digest:
        raise ValueError("镜像包 SHA256 校验失败，停止发布")
    check_archive(archive, refs)
    print(f"镜像包 SHA256 及 {len(refs)} 个 tag 校验通过：{digest}", flush=True)
    subprocess.run(["docker", "image", "load", "--input", str(archive)], check=True, timeout=600)
    check_platform(refs)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("pack", "load", "link", "download"))
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--compose", type=Path)
    parser.add_argument("--tag")
    parser.add_argument("--artifact-id", type=int)
    parser.add_argument("--artifact-digest")
    parser.add_argument("--download-proxy", default="")
    args = parser.parse_args()
    try:
        if args.action == "link":
            if args.artifact_id is None or args.artifact_digest is None:
                parser.error("link 必须提供 --artifact-id / --artifact-digest")
            link(args.bundle, args.artifact_id, args.artifact_digest, args.download_proxy)
        elif args.action == "download":
            download(args.bundle)
        else:
            if args.compose is None or args.tag is None:
                parser.error("pack/load 必须提供 --compose / --tag")
            refs = compose_images(args.compose, args.tag)
            (pack if args.action == "pack" else load)(args.bundle, refs, args.tag)
    except (ValueError, OSError, KeyError, tarfile.TarError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        if args.action in ("link", "download"):
            detail = str(error) if isinstance(error, (ValueError, KeyError)) else type(error).__name__
            if isinstance(error, urllib.error.HTTPError):
                detail = f"HTTP {error.code}"
            print(f"构建产物传输失败：{detail}（不记录短期下载凭据）", file=sys.stderr)
            return 1
        print(f"镜像转运失败：{error}", file=sys.stderr)
        return 1
    print(f"镜像转运 {args.action} 完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
