"""Bounded in-memory comparison PNGs. No preview is written to disk."""

from collections import OrderedDict
import hashlib
import os
import secrets
import threading


def _limit():
    try:
        mib = int(os.environ.get("ADACHI_COMPARE_MEMORY_MIB", "512"))
    except ValueError:
        mib = 512
    return max(64, min(4096, mib)) * 1024 * 1024


class PreviewStore:
    def __init__(self, limit=None):
        self.limit = _limit() if limit is None else limit
        self.nonce = secrets.token_hex(12)
        self.epoch = 0
        self.size = 0
        self.groups = OrderedDict()
        self.keys = {}
        self.latest = {}
        self.lock = threading.RLock()

    def fingerprint(self):
        with self.lock:
            return f"{self.nonce}:{self.epoch}"

    def put_batch(self, images, owner):
        """Atomically retain a whole comparison batch, or explicitly reject it."""
        total = sum(len(image) for image in images)
        if total > self.limit:
            raise ValueError("The comparison batch exceeds the in-memory preview limit. Reduce batch size or increase ADACHI_COMPARE_MEMORY_MIB (64–4096 MiB).")
        digest = hashlib.sha256()
        for image in images:
            digest.update(len(image).to_bytes(8, "big")); digest.update(image)
        signature = digest.digest()
        owner = str(owner)
        with self.lock:
            before = self.epoch
            last = self.latest.get(owner)
            # Cache fingerprinting happens before execution. If eviction of an
            # unrelated or older batch caused a rerun but pixels are unchanged,
            # keep the existing descriptors and let the fingerprint stabilise.
            if last and last[1] != before and last[0] in self.groups:
                group = self.groups[last[0]]
                if group["signature"] == signature:
                    self.groups.move_to_end(last[0])
                    self.latest[owner] = (last[0], before)
                    return list(group["descriptors"])
            while self.groups and self.size + total > self.limit:
                group_id, group = self.groups.popitem(last=False)
                self.size -= group["size"]
                for key in group["keys"]:
                    self.keys.pop(key, None)
                if self.latest.get(group["owner"], (None,))[0] == group_id:
                    self.latest.pop(group["owner"], None)
                self.epoch += 1
            group_id = secrets.token_urlsafe(24)
            keys = [secrets.token_urlsafe(24) for _ in images]
            descriptors = [{"type": "adachi_memory", "subfolder": "", "filename": key + ".png"} for key in keys]
            self.groups[group_id] = {"owner": owner, "size": total, "keys": keys, "signature": signature, "descriptors": descriptors}
            for key, image in zip(keys, images):
                self.keys[key] = (group_id, image)
            self.size += total
            self.latest[owner] = (group_id, before)
            return list(descriptors)

    def get(self, key):
        with self.lock:
            found = self.keys.get(key)
            if not found:
                return None
            self.groups.move_to_end(found[0])
            return found[1]


PREVIEWS = PreviewStore()
