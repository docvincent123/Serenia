"""Focused publisher persistence and file-safety regression tests."""
import base64
import hashlib
import json
import time
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cryptography.hazmat.primitives import serialization
from license_core import (
    LICENSE_PRESETS, create_keys, issue_first_admin, issue_license, publisher_public_key,
    read_center_request, resolve_modules, validate_private_key_file, write_new,
)
from license_store import (
    atomic_json, license_matches_record, load_preferences, load_registry,
    remove_record, save_preferences, upsert,
)


class LicenseRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.registry = self.root / "registry" / "centers.json"
        self.server = "a" * 64

    def test_atomic_registry_and_draft_lifecycle(self):
        self.assertEqual(load_registry(self.registry), [])
        draft = {"server_id": self.server, "center": "Test center", "status": "draft"}
        records = upsert([], draft)
        atomic_json(self.registry, records)
        self.assertEqual(load_registry(self.registry), [draft])
        amended = {**draft, "center": "Updated center"}
        atomic_json(self.registry, upsert(records, amended))
        self.assertEqual(len(load_registry(self.registry)), 1)
        updated = remove_record(load_registry(self.registry), self.server)
        atomic_json(self.registry, updated)
        self.assertEqual(load_registry(self.registry), [])

    def test_corrupted_registry_is_not_overwritten_on_load(self):
        self.registry.parent.mkdir(parents=True)
        self.registry.write_text('{"broken": true}', encoding="utf-8")
        with self.assertRaises(ValueError):
            load_registry(self.registry)
        self.assertEqual(self.registry.read_text(encoding="utf-8"), '{"broken": true}')

    def test_preferences_persist_paths_only(self):
        file = self.root / "settings.json"
        save_preferences(file, "/tmp/private.pem", "/tmp/licenses")
        self.assertEqual(load_preferences(file)["key_path"], "/tmp/private.pem")
        data = json.loads(file.read_text(encoding="utf-8"))
        self.assertEqual(set(data), {"key_path", "license_dir"})
        self.assertNotIn("password", data)

    def test_cannot_upsert_invalid_server_id(self):
        with self.assertRaises(ValueError):
            upsert([], {"center": "Bad", "server_id": "abc"})

    def test_issuing_uses_private_pem_not_public_or_directory(self):
        private, public = create_keys("long-local-test-password")
        signing = self.root / "publisher-private.pem"
        public_file = self.root / "publisher-public.pem"
        write_new(signing, private, private=True)
        write_new(public_file, public)
        self.assertEqual(validate_private_key_file(signing), signing)
        for invalid in [self.root, public_file, self.root / "missing.pem"]:
            with self.assertRaises(ValueError):
                validate_private_key_file(invalid)

    def test_signed_grant_file_matches_only_its_own_record(self):
        private, public = create_keys("long-local-test-password")
        envelope, grant = issue_license(
            private, "long-local-test-password", server_id=self.server,
            center="Center", modules=["patients"],
        )
        file = self.root / "my-center.lemvori-license"
        write_new(file, json.dumps(envelope).encode("utf-8"), private=True)
        self.assertTrue(license_matches_record(file, grant))
        self.assertFalse(license_matches_record(file, {**grant, "license_id": "wrong"}))
        self.assertFalse(license_matches_record(file, {**grant, "server_id": "b" * 64}))
        self.assertFalse(license_matches_record(self.root / "absent.lemvori-license", grant))
        self.assertTrue(public.startswith(b"-----BEGIN PUBLIC KEY-----"))

    def test_replacement_with_same_license_id_fails_digest_check(self):
        private, _ = create_keys("publisher-test-password")
        envelope, grant = issue_license(
            private, "publisher-test-password", server_id=self.server, center="Center", modules=[],
        )
        file = self.root / "test.lemvori-license"
        content = json.dumps(envelope).encode("utf-8")
        file.write_bytes(content)
        record = {**grant, "license_sha256": hashlib.sha256(content).hexdigest()}
        self.assertTrue(license_matches_record(file, record))
        file.write_text(json.dumps({**envelope, "signature": ""}), encoding="utf-8")
        self.assertFalse(license_matches_record(file, record))
        file.write_text("[]", encoding="utf-8")
        self.assertFalse(license_matches_record(file, grant))

    def test_symlink_or_mismatched_file_is_never_deleted(self):
        private, _ = create_keys("another-long-test-password")
        envelope, grant = issue_license(
            private, "another-long-test-password", server_id=self.server,
            center="Center", modules=["patients"],
        )
        actual = self.root / "actual.lemvori-license"
        write_new(actual, json.dumps(envelope).encode("utf-8"), private=True)
        link = self.root / "link.lemvori-license"
        try:
            link.symlink_to(actual)
        except (NotImplementedError, OSError):
            pass  # Windows without developer-mode symlink permissions
        else:
            self.assertFalse(license_matches_record(link, grant))
        fake = self.root / "fake.lemvori-license"
        fake.write_text("not a license", encoding="utf-8")
        self.assertFalse(license_matches_record(fake, grant))


class PublisherCompatibilityTests(unittest.TestCase):
    def test_center_request_and_presets(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "request.json"
            request = {"format": "lemvori.center-request", "version": 1, "server_id": "a"*64,
                       "center": "Лікарня", "requested_modules": ["clinical"]}
            path.write_text(json.dumps(request), encoding="utf-8")
            self.assertEqual(read_center_request(path), ("a"*64, "Лікарня", resolve_modules(["clinical"])))
            for bad_value in (["nonexistent"], [{}], "clinical"):
                path.write_text(json.dumps({**request, "requested_modules": bad_value}), encoding="utf-8")
                with self.assertRaises(ValueError):
                    read_center_request(path)
        clinic = set(resolve_modules(LICENSE_PRESETS["Психологічна служба"]))
        self.assertTrue({"patients","documents","consents","appointments","clinical"} <= clinic)
        self.assertNotIn("clinical", resolve_modules(LICENSE_PRESETS["Реєстратура"]))
        self.assertTrue({"rehabilitation","clinical"} <= set(resolve_modules(LICENSE_PRESETS["Реабілітація"])))

    def test_public_key_and_first_admin_are_compatible_with_server(self):
        private, original_public = create_keys("local-publisher-test-password")
        public, fingerprint = publisher_public_key(private, "local-publisher-test-password")
        key = serialization.load_pem_public_key(public)
        der = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        self.assertEqual(public, original_public)
        self.assertEqual(fingerprint, hashlib.sha256(der).hexdigest())
        with self.assertRaises(ValueError):
            publisher_public_key(private, "incorrect-password")

        password = "synthetic-admin-password"
        envelope = issue_first_admin(private, "local-publisher-test-password", server_id="a"*64,
                                     name="Тестовий адміністратор", login="clinic.admin", password=password)
        self.assertEqual(envelope["format"], "lemvori.admin-setup")
        encoded = base64.b64decode(envelope["payload"])
        key.verify(base64.b64decode(envelope["signature"]), encoded)
        self.assertNotIn(password.encode(), encoded)
        grant = json.loads(encoded)
        self.assertEqual(grant["server_id"], "a"*64)
        self.assertEqual(grant["login"], "clinic.admin")
        self.assertIn(grant["expires_at"] - int(time.time()), range(86395, 86401))
        salt, digest = grant["password_hash"].split(":")
        self.assertEqual(digest, hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600_000).hex())


if __name__ == "__main__":
    unittest.main()
