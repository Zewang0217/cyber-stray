"""Check transfer integrity and release binding without Docker, network or databases."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

spec = importlib.util.spec_from_file_location("image_bundle", Path(__file__).with_name("image-bundle.py"))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)
TAG = "a" * 40
REFS = [f"ghcr.io/zewang0217/cyber-stray-app:{TAG}", "nginx:1.27-alpine"]


class ImageBundleTest(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parent.parent / "scratch" / "tmp"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.archive = self.path / bundle.ARCHIVE
        self.write_archive(REFS)
        self.manifest = {"version": 1, "tag": TAG, "images": REFS,
                         "sha256": bundle.sha256(self.archive)}
        self.write_manifest()

    def write_archive(self, refs):
        content = json.dumps([{"RepoTags": refs}]).encode()
        with tarfile.open(self.archive, "w:gz") as output:
            member = tarfile.TarInfo("manifest.json")
            member.size = len(content)
            output.addfile(member, io.BytesIO(content))

    def write_manifest(self):
        (self.path / bundle.MANIFEST).write_text(json.dumps(self.manifest))

    def docker(self, args, **kwargs):
        if args[:3] == ["docker", "image", "inspect"]:
            return subprocess.CompletedProcess(args, 0, json.dumps([{"Os": "linux", "Architecture": "amd64"}]))
        return subprocess.CompletedProcess(args, 0, "")

    def test_valid_bundle_loads_and_checks_every_expected_image(self):
        with patch.object(bundle.subprocess, "run", side_effect=self.docker) as run:
            bundle.load(self.path, REFS, TAG)
        self.assertEqual([call.args[0] for call in run.call_args_list], [
            ["docker", "image", "load", "--input", str(self.archive)],
            *[["docker", "image", "inspect", ref] for ref in REFS],
        ])

    def test_corrupt_archive_never_calls_docker(self):
        with self.archive.open("ab") as out:
            out.write(b"interrupted or modified transfer")
        with patch.object(bundle.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "SHA256"):
                bundle.load(self.path, REFS, TAG)
            run.assert_not_called()

    def test_wrong_tag_inventory_version_and_digest_are_rejected_before_load(self):
        for key, value in (("tag", "b" * 40), ("images", REFS[:-1]),
                           ("version", 2), ("sha256", "bad")):
            with self.subTest(key=key):
                original = self.manifest[key]
                self.manifest[key] = value
                self.write_manifest()
                with patch.object(bundle.subprocess, "run") as run, self.assertRaises(ValueError):
                    bundle.load(self.path, REFS, TAG)
                run.assert_not_called()
                self.manifest[key] = original

    def test_archive_missing_extra_or_duplicate_tags_are_rejected(self):
        for tags in (REFS[:-1], [*REFS, "unexpected:tag"], [*REFS, REFS[0]]):
            with self.subTest(tags=tags):
                self.write_archive(tags)
                self.manifest["sha256"] = bundle.sha256(self.archive)
                self.write_manifest()
                with patch.object(bundle.subprocess, "run") as run, self.assertRaisesRegex(ValueError, "tag"):
                    bundle.load(self.path, REFS, TAG)
                run.assert_not_called()

    def test_load_failure_is_not_hidden_by_existing_images(self):
        with patch.object(bundle.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "docker")):
            with self.assertRaises(subprocess.CalledProcessError):
                bundle.load(self.path, REFS, TAG)

    def test_wrong_architecture_is_rejected(self):
        response = subprocess.CompletedProcess([], 0, '[{"Os":"linux","Architecture":"arm64"}]')
        with patch.object(bundle.subprocess, "run", return_value=response):
            with self.assertRaisesRegex(ValueError, "linux/amd64"):
                bundle.check_platform(REFS)

    def test_compose_inventory_uses_tag_and_never_resolves_secret_env_file(self):
        response = subprocess.CompletedProcess([], 0, "\n".join(reversed(REFS)) + "\n")
        with patch.object(bundle.subprocess, "run", return_value=response) as run:
            self.assertEqual(bundle.compose_images(self.path / "compose.yaml", TAG), REFS)
        self.assertIn("--no-env-resolution", run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs["env"]["IMAGE_TAG"], TAG)
        for tag in ("", "sha", "x' ; command", "a" * 65):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                bundle.compose_images(self.path / "compose.yaml", tag)

    def artifact(self, names=(bundle.ARCHIVE, bundle.MANIFEST)):
        value = io.BytesIO()
        with zipfile.ZipFile(value, "w") as archive:
            for name in names:
                archive.writestr(name, b"fixture")
        data = value.getvalue()
        metadata = {"url": "https://example.blob.core.windows.net/artifact?sig=fixture",
                    "sha256": bundle.hashlib.sha256(data).hexdigest(), "proxy": ""}
        (self.path / bundle.DOWNLOAD).write_text(json.dumps(metadata))
        return data

    def artifact_response(self, data):
        def response(request, **kwargs):
            if request.get_method() == "HEAD":
                result = io.BytesIO()
                result.headers = {"Content-Length": str(len(data))}
                return result
            first, last = map(int, request.get_header("Range").removeprefix("bytes=").split("-"))
            result = io.BytesIO(data[first:last + 1])
            result.status = 206
            result.headers = {"Content-Range": f"bytes {first}-{last}/{len(data)}"}
            return result
        return response

    def test_download_verifies_zip_before_copying_only_expected_files_and_removes_secrets(self):
        data = self.artifact()
        with patch.object(bundle.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = self.artifact_response(data)
            bundle.download(self.path)
        self.assertEqual((self.path / bundle.ARCHIVE).read_bytes(), b"fixture")
        self.assertFalse((self.path / bundle.DOWNLOAD).exists())
        self.assertFalse((self.path / "artifact.zip").exists())

    def test_download_rejects_corruption_or_unexpected_files_and_cleans_partial_zip(self):
        for names, corrupt in (((bundle.ARCHIVE, bundle.MANIFEST), True),
                               ((bundle.ARCHIVE, "../../escape"), False)):
            with self.subTest(names=names, corrupt=corrupt):
                data = self.artifact(names)
                with patch.object(bundle.urllib.request, "build_opener") as opener:
                    opener.return_value.open.side_effect = self.artifact_response(data + b"changed" if corrupt else data)
                    with self.assertRaises(ValueError):
                        bundle.download(self.path)
                self.assertFalse((self.path / bundle.DOWNLOAD).exists())
                self.assertFalse((self.path / "artifact.zip").exists())

    def test_interrupted_range_resumes_at_last_written_byte(self):
        requests = []
        def response(request, **kwargs):
            first, last = map(int, request.get_header("Range").removeprefix("bytes=").split("-"))
            requests.append((first, last))
            result = io.BytesIO(b"abc" if first == 0 else b"def")
            result.status = 206
            result.headers = {"Content-Range": f"bytes {first}-{last}/6"}
            return result
        part = self.path / "part"
        with patch.object(bundle.urllib.request, "build_opener") as opener, patch.object(bundle.time, "sleep"):
            opener.return_value.open.side_effect = response
            bundle.download_part("https://example.blob.core.windows.net/a", "", 0, 5, part, float("inf"))
        self.assertEqual(requests, [(0, 5), (3, 5)])
        self.assertEqual(part.read_bytes(), b"abcdef")

    def test_range_retry_is_bounded_and_authorization_failures_are_not_retried(self):
        with patch.object(bundle.urllib.request, "build_opener") as opener, patch.object(bundle.time, "sleep"):
            opener.return_value.open.side_effect = TimeoutError()
            with self.assertRaisesRegex(ValueError, "5 次"):
                bundle.download_part("https://example.blob.core.windows.net/a", "", 0, 5,
                                     self.path / "part", float("inf"))
            self.assertEqual(opener.return_value.open.call_count, 5)
            opener.return_value.open.reset_mock()
            opener.return_value.open.side_effect = urllib.error.HTTPError("private-url", 403, "expired", {}, None)
            with self.assertRaises(urllib.error.HTTPError):
                bundle.download_part("https://example.blob.core.windows.net/a", "", 0, 5,
                                     self.path / "part", float("inf"))
            self.assertEqual(opener.return_value.open.call_count, 1)

    def test_link_keeps_github_token_on_runner_and_metadata_private(self):
        url = "https://example.blob.core.windows.net/artifact?sig=fixture"
        error = urllib.error.HTTPError("https://api.github.com", 302, "Found", {"Location": url}, None)
        with patch.dict(bundle.os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "runner-only"}):
            with patch.object(bundle.urllib.request, "build_opener") as opener:
                opener.return_value.open.side_effect = error
                bundle.link(self.path, 123, "a" * 64, "")
        metadata = self.path / bundle.DOWNLOAD
        self.assertEqual(metadata.stat().st_mode & 0o777, 0o600)
        self.assertNotIn("runner-only", metadata.read_text())

    def test_download_url_rejects_http_credentials_and_unexpected_hosts(self):
        for url in ("http://example.blob.core.windows.net/a", "https://evil.example/a",
                    "https://user:secret@example.blob.core.windows.net/a", "https://blob.core.windows.net.evil/a"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                bundle.validate_download_url(url)


if __name__ == "__main__":
    unittest.main()
