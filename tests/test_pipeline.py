#!/usr/bin/env python3
"""Unit tests for msk-go pipeline (fetch_events.py). Standard library only."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


class TestCuratedData(unittest.TestCase):
    def setUp(self):
        self.curated = json.loads((DATA / "curated.json").read_text(encoding="utf-8"))
        self.events = json.loads((DATA / "events.json").read_text(encoding="utf-8"))

    def test_curated_is_valid_json(self):
        self.assertIn("events", self.curated)

    def test_events_is_valid_json(self):
        self.assertIn("events", self.events)
        self.assertIn("past", self.events)
        self.assertIn("generated_at", self.events)

    def test_all_events_have_required_fields(self):
        for ev in self.events["events"]:
            with self.subTest(id=ev.get("id", ev.get("title"))):
                self.assertIn("title", ev)
                self.assertIn("start", ev)
                self.assertIn("category", ev)
                self.assertIn("id", ev)
                self.assertTrue(ev["id"].startswith(("curated-", "kudago-", "timepad-", "tg-")))

    def test_no_kids_events(self):
        for ev in self.events["events"]:
            title = (ev.get("title") or "").lower()
            cat = (ev.get("category") or "").lower()
            if "kids" in cat or "дет" in cat:
                self.fail(f"Kid event slipped through: {ev.get('id')} — {ev.get('title')}")
            if "дет" in title[:30] and "взросл" not in title:
                if ev.get("source") != "curated":
                    self.fail(f"Kids-content event: {ev.get('id')} — {ev.get('title')}")

    def test_no_exhibition_past_events(self):
        for ev in self.events.get("past", []):
            cat = (ev.get("category") or "").lower()
            label = (ev.get("category_label") or "").lower()
            if cat == "exhibition" or "выставк" in label[:30]:
                if ev.get("source") != "curated":
                    self.fail(f"Exhibition in past: {ev.get('id')} — {ev.get('title')}")

    def test_no_duplicate_ids(self):
        ids = [ev["id"] for ev in self.events["events"]]
        seen = set()
        for eid in ids:
            if eid in seen:
                self.fail(f"Duplicate ID: {eid}")
            seen.add(eid)

    def test_no_duplicate_titles_same_day(self):
        seen = set()
        for ev in self.events["events"]:
            key = (ev["title"].strip().lower(), ev["start"][:10])
            if key in seen:
                self.fail(f"Duplicate title+day: {ev['title']} @ {ev['start']}")
            seen.add(key)

    def test_dedup_removed_timepad_dupes(self):
        """Йога день and Йога день от Сенсилис same day/place should be deduped."""
        yoga_events = [
            ev for ev in self.events["events"]
            if "йог" in ev.get("title", "").lower()
               and ev.get("start", "").startswith("2026-06-27")
        ]
        self.assertLessEqual(len(yoga_events), 1,
                             f"Yoga duplicates not deduped: {[e['title'] for e in yoga_events]}")


class TestPipelineCode(unittest.TestCase):
    def test_fetch_events_imports(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "fetch_events", ROOT / "scripts" / "fetch_events.py")
        self.assertIsNotNone(spec, "fetch_events.py has syntax errors")

    def test_fetch_telegram_imports(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "fetch_telegram", ROOT / "scripts" / "fetch_telegram.py")
        self.assertIsNotNone(spec, "fetch_telegram.py has syntax errors")


if __name__ == "__main__":
    unittest.main()
