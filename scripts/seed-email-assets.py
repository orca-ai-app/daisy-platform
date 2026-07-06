#!/usr/bin/env python3
"""Seed the email-assets Storage bucket from the exported Kartra images.

One-off for the Kartra email migration (M3 follow-on), rerunnable (upsert).

- Reads every image in ../docs/kartra-images (relative to the daisy-platform
  repo root's parent).
- Cleans the Kartra filename prefixes (upload ids / timestamps / junk chars)
  so the media library shows human names; collisions get a short numeric
  suffix.
- Uploads to the public `email-assets` bucket with the service-role key.
- Also uploads the DFA logo under the canonical name `dfa-logo.png` used by
  the email shell (supabase/functions/_shared/emailBlocks.ts).
- Writes ../docs/kartra-image-mapping.json: original Kartra filename ->
  { clean name, public URL } — used to map <img> URLs in the original Kartra
  emails to bucket URLs.

Usage:  python3 scripts/seed-email-assets.py
Credentials are read from ../docs/credentials.md (SERVICE_ROLE_KEY).
"""

import json
import mimetypes
import re
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
IMAGES_DIR = REPO_ROOT.parent / "docs" / "kartra-images"
CREDENTIALS = REPO_ROOT.parent / "docs" / "credentials.md"
MAPPING_OUT = REPO_ROOT.parent / "docs" / "kartra-image-mapping.json"
PROJECT_REF = "dmvajkreuwknjqxyxmlv"
STORAGE_BASE = f"https://{PROJECT_REF}.supabase.co/storage/v1"
PUBLIC_BASE = f"{STORAGE_BASE}/object/public/email-assets"

# Two images referenced by the live "Time flies" Kartra email belong to the
# older `parentinginmind` Kartra account and now return 403 from S3 (checked
# 2026-07-06) — i.e. they are already broken in the live sequence. The logo has
# an identical jennidunman copy (LOGO_SOURCE below); the "Book your refresher
# class" CTA graphic is replaced by a button block in the rebuilt template.

# The email shell's canonical logo object (see emailBlocks.ts LOGO_URL).
LOGO_SOURCE = "30950731_1680096666UfMDFA_LOGO.png"
LOGO_TARGET = "dfa-logo.png"


def service_role_key() -> str:
    text = CREDENTIALS.read_text()
    m = re.search(r'^SERVICE_ROLE_KEY="([^"]+)"', text, re.M)
    if not m:
        sys.exit("SERVICE_ROLE_KEY not found in docs/credentials.md")
    return m.group(1)


def clean_name(original: str) -> str:
    """Strip Kartra upload prefixes: `NNNNNNNN_<ts13>` / `NNNNNNNN_<ts10>xxx` / bare 12-13 digits."""
    name = original
    name = re.sub(r"^\d{7,9}_\d{13}(?=[A-Za-z])", "", name)
    name = re.sub(r"^\d{7,9}_\d{10}[A-Za-z0-9]{3}(?=[A-Z])", "", name)
    name = re.sub(r"^\d{11,14}(?=[A-Za-z])", "", name)
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-_.")
    return name or original


def upload(key: str, object_name: str, data: bytes, content_type: str) -> None:
    req = urllib.request.Request(
        f"{STORAGE_BASE}/object/email-assets/{object_name}",
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
    )
    with urllib.request.urlopen(req) as res:
        if res.status not in (200, 201):
            raise RuntimeError(f"{object_name}: HTTP {res.status}")


def main() -> None:
    key = service_role_key()

    files = sorted(
        p for p in IMAGES_DIR.iterdir()
        if p.is_file() and not p.name.startswith(".")
    )
    mapping: dict[str, dict[str, str]] = {}
    used: set[str] = set()
    failures = 0

    for path in files:
        name = clean_name(path.name)
        if name.lower() in used:
            stem, dot, ext = name.rpartition(".")
            n = 2
            while f"{stem}-{n}.{ext}".lower() in used:
                n += 1
            name = f"{stem}-{n}.{ext}"
        used.add(name.lower())

        content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        try:
            upload(key, name, path.read_bytes(), content_type)
            mapping[path.name] = {"name": name, "url": f"{PUBLIC_BASE}/{name}"}
            print(f"uploaded: {path.name} -> {name}")
        except Exception as err:  # noqa: BLE001 — report and continue
            failures += 1
            print(f"FAILED:   {path.name}: {err}", file=sys.stderr)

    # Canonical logo for the email shell.
    logo = IMAGES_DIR / LOGO_SOURCE
    upload(key, LOGO_TARGET, logo.read_bytes(), "image/png")
    mapping[LOGO_TARGET] = {"name": LOGO_TARGET, "url": f"{PUBLIC_BASE}/{LOGO_TARGET}"}
    print(f"uploaded: {LOGO_SOURCE} -> {LOGO_TARGET} (canonical logo)")

    MAPPING_OUT.write_text(json.dumps(mapping, indent=2, sort_keys=True) + "\n")
    print(f"\n{len(mapping)} objects in bucket, {failures} failures. Mapping: {MAPPING_OUT}")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
