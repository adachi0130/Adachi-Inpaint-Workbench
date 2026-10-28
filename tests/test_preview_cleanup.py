"""Regression checks for comparison preview cleanup boundaries."""

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("preview_cleanup_under_test", Path(__file__).resolve().parents[1] / "preview_cleanup.py")
cleanup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cleanup)


class PreviewCleanupTests(unittest.TestCase):
    def test_only_expired_comparison_previews_in_temp_are_removed(self):
        now = 2_000_000
        with tempfile.TemporaryDirectory() as root:
            temp = Path(root) / "temp"
            inputs = Path(root) / "input"
            temp.mkdir()
            inputs.mkdir()
            old_original = temp / "adachi_compare_original_temp_abcde_00001_.png"
            old_result = temp / "adachi_compare_result_temp_abcde_00002_.png"
            recent = temp / "adachi_compare_result_temp_abcde_00003_.png"
            unrelated = temp / "ComfyUI_temp_abcde_00001_.png"
            wrong_name = temp / "adachi_compare_result_mine.png"
            adopted = inputs / old_original.name
            nested = temp / "nested"
            nested.mkdir()
            nested_preview = nested / old_original.name
            for path in (old_original, old_result, recent, unrelated, wrong_name, adopted, nested_preview):
                path.write_bytes(b"test")
                os.utime(path, (now - 100_000, now - 100_000))
            os.utime(recent, (now - 60, now - 60))
            removed = cleanup.cleanup_comparison_previews(temp, now=now)
            self.assertEqual(removed, 2)
            for path in (old_original, old_result):
                self.assertFalse(path.exists())
            for path in (recent, unrelated, wrong_name, adopted, nested_preview):
                self.assertTrue(path.exists())

    def test_missing_directory_is_harmless(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(cleanup.cleanup_comparison_previews(Path(root) / "missing"), 0)


if __name__ == "__main__":
    unittest.main()
