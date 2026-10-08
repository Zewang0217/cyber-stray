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


if __name__ == "__main__":
    unittest.main()
