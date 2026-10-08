#!/usr/bin/env python3
"""Transfer Compose images through a checked archive, without production registry access."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile

ARCHIVE = "images.tar.gz"
MANIFEST = "release.json"
PLATFORM = ("linux", "amd64")


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
    parser.add_argument("action", choices=("pack", "load"))
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--compose", type=Path, required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    try:
        refs = compose_images(args.compose, args.tag)
        (pack if args.action == "pack" else load)(args.bundle, refs, args.tag)
    except (ValueError, OSError, KeyError, tarfile.TarError, subprocess.SubprocessError) as error:
        print(f"镜像转运失败：{error}", file=sys.stderr)
        return 1
    print(f"镜像转运 {args.action} 完成：tag={args.tag}，{len(refs)} 个镜像")
    return 0


if __name__ == "__main__":
    sys.exit(main())
