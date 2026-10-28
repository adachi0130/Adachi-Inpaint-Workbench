"""Expire only this extension's comparison previews in ComfyUI's temp folder."""

import logging
import os
import re
import threading
import time

PREVIEW_MAX_AGE_SECONDS = 24 * 60 * 60
SWEEP_INTERVAL_SECONDS = 60 * 60
_PREVIEW_NAME = re.compile(r"adachi_compare_(?:original|result)_temp_[a-z]{5}_[0-9]{5,}_\.png\Z")
_started = False
_start_lock = threading.Lock()


def cleanup_comparison_previews(directory, *, now=None, max_age=PREVIEW_MAX_AGE_SECONDS):
    """Remove expired, regular preview files, leaving all other files untouched."""
    cutoff = (time.time() if now is None else now) - max_age
    removed = 0
    try:
        with os.scandir(directory) as entries:
            for entry in entries:
                if not _PREVIEW_NAME.fullmatch(entry.name):
                    continue
                try:
                    if not entry.is_file(follow_symlinks=False):
                        continue
                    if entry.stat(follow_symlinks=False).st_mtime >= cutoff:
                        continue
                    os.unlink(entry.path)
                    removed += 1
                except OSError as exc:
                    logging.debug("Could not remove expired comparison preview %s: %s", entry.name, exc)
    except FileNotFoundError:
        pass
    except OSError as exc:
        logging.warning("Could not inspect comparison preview directory: %s", exc)
    return removed


def start_preview_cleanup():
    """Sweep in the background so a long-running ComfyUI does not accumulate previews."""
    global _started
    with _start_lock:
        if _started:
            return
        _started = True

    def run():
        import folder_paths
        while True:
            cleanup_comparison_previews(folder_paths.get_temp_directory())
            time.sleep(SWEEP_INTERVAL_SECONDS)

    threading.Thread(target=run, name="adachi-preview-cleanup", daemon=True).start()
