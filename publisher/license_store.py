"""Local-only publisher registry and file utilities.

This module never stores a private key, key password or patient information.
Deleting a local grant is NOT a remote revocation mechanism.
"""
import base64
import json
import os
import re
import tempfile
from pathlib import Path


def load_registry(path):
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    if not isinstance(data, list) or any(
        not isinstance(item, dict)
        or not isinstance(item.get("center"), str)
        or not isinstance(item.get("server_id"), str)
        for item in data
    ):
        raise ValueError("Пошкоджений формат реєстру центрів")
    return data


def atomic_json(path, data):
    """Write without truncating the previous registry on failure."""
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix="." + path.name + "-", suffix=".tmp", dir=path.parent)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(data, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def upsert(records, record):
    """Return a new record list; never modify the original on error."""
    server_id = record.get("server_id", "")
    if not re.fullmatch(r"[a-f0-9]{64}", server_id):
        raise ValueError("ID сервера: 64 символи 0–9, a–f")
    if not record.get("center", "").strip():
        raise ValueError("Укажіть назву центру")
    return [r for r in records if r["server_id"] != server_id] + [record]


def remove_record(records, server_id):
    updated = [r for r in records if r.get("server_id") != server_id]
    if len(updated) == len(records):
        raise ValueError("Запис ліцензії не знайдено")
    return updated


def license_matches_record(path, record):
    """Confirm target is a specific issued license before local deletion."""
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.suffix != ".lemvori-license":
        return False
    if path.stat().st_size > 65536:
        return False
    try:
        envelope = json.loads(path.read_text(encoding="utf-8"))
        if envelope.get("format") != "quremed.solvia.license":
            return False
        payload = json.loads(base64.b64decode(envelope["payload"], validate=True))
        return bool(
            record.get("license_id")
            and payload.get("license_id") == record["license_id"]
            and payload.get("server_id") == record.get("server_id")
        )
    except (ValueError, KeyError, OSError, TypeError):
        return False


def save_preferences(path, key_path="", license_dir=""):
    """Paths only. No cryptographic material or password."""
    atomic_json(path, {"key_path": str(key_path), "license_dir": str(license_dir)})


def load_preferences(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Пошкоджені налаштування")
        return {
            "key_path": str(data.get("key_path", "")),
            "license_dir": str(data.get("license_dir", "")),
        }
    except FileNotFoundError:
        return {"key_path": "", "license_dir": ""}
