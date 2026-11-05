"""Validate the release changelog and optionally write its GitHub notes."""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = sys.argv[1]
entries = json.loads((root / "changelog.json").read_text())
assert isinstance(entries, list) and entries, "Changelog must be a nonempty array"
previous = None
for entry in entries:
    assert isinstance(entry, dict) and set(entry) == {"version", "summary", "changes"}, "Invalid entry fields"
    assert isinstance(entry["version"], str) and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", entry["version"]), "Invalid version"
    current = tuple(map(int, entry["version"].split(".")))
    assert previous is None or current < previous, "Versions must be unique and newest first"
    previous = current
    assert isinstance(entry["summary"], str) and entry["summary"].strip(), "Missing summary"
    changes = entry["changes"]
    assert isinstance(changes, dict) and changes and set(changes) <= {"features", "fixes"}, "Invalid change groups"
    for items in changes.values():
        assert isinstance(items, list) and items, "Change groups must be nonempty arrays"
        assert all(isinstance(item, str) and item.strip() for item in items), "Changes must be nonempty strings"
assert entries[0]["version"] == version, "Newest changelog entry must match release version"
assert json.loads((root / "update.json").read_text())["version"] == version, "Manifest version mismatch"
if len(sys.argv) > 2:
    entry = entries[0]
    lines = [entry["summary"], ""]
    for category, heading in (("features", "Additions and changes"), ("fixes", "Fixes")):
        if category in entry["changes"]:
            lines.extend(["## " + heading, ""])
            lines.extend("- " + item for item in entry["changes"][category])
            lines.append("")
    output = Path(sys.argv[2])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines))
print(f"Validated {len(entries)} changelog entries for {version}")
