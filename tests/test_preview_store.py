import unittest
from preview_store import PreviewStore


def key(descriptor):
    return descriptor["filename"][:-4]


class PreviewStoreTests(unittest.TestCase):
    def test_whole_batch_lru_and_cache_generation(self):
        store = PreviewStore(10)
        first = store.put_batch([b"aaa", b"bbb"], "1")
        before = store.fingerprint()
        second = store.put_batch([b"ccc", b"ddd"], "2")
        self.assertNotEqual(store.fingerprint(), before)
        self.assertIsNone(store.get(key(first[0])))
        self.assertIsNone(store.get(key(first[1])))
        self.assertEqual(store.get(key(second[0])), b"ccc")
        self.assertEqual(store.get(key(second[1])), b"ddd")
        self.assertNotEqual(store.fingerprint(), PreviewStore(10).fingerprint())

    def test_eviction_rerun_reuses_current_batch_without_continuous_eviction(self):
        store = PreviewStore(10)
        store.put_batch([b"aaa", b"bbb"], "node")
        current = store.put_batch([b"ccc", b"ddd"], "node")
        after_eviction = store.fingerprint()
        reused = store.put_batch([b"ccc", b"ddd"], "node")
        self.assertEqual(reused, current)
        self.assertEqual(store.fingerprint(), after_eviction)
        # A true new execution with no intervening eviction has fresh identity.
        regenerated = store.put_batch([b"ccc", b"ddd"], "node")
        self.assertNotEqual(regenerated, current)
        self.assertNotEqual(store.fingerprint(), after_eviction)

    def test_oversized_batch_never_discards_prior_previews(self):
        store = PreviewStore(6)
        existing = store.put_batch([b"aa", b"bb"], "x")
        generation = store.fingerprint()
        with self.assertRaisesRegex(ValueError, "preview limit"):
            store.put_batch([b"aaa", b"bbbb"], "x")
        self.assertEqual(store.get(key(existing[0])), b"aa")
        self.assertEqual(store.get(key(existing[1])), b"bb")
        self.assertEqual(store.fingerprint(), generation)

    def test_alternating_inputs_invalidates_the_old_cached_descriptors(self):
        store = PreviewStore(6)
        first = store.put_batch([b"aaa", b"bbb"], "node")
        token = store.fingerprint()
        store.put_batch([b"ccc", b"ddd"], "node")
        self.assertNotEqual(token, store.fingerprint())
        self.assertIsNone(store.get(key(first[0])))
        restored = store.put_batch([b"aaa", b"bbb"], "node")
        self.assertEqual(store.get(key(restored[0])), b"aaa")


if __name__ == "__main__":
    unittest.main()
