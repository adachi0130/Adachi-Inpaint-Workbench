"""Image-edge and dense-mask equivalence for the bounded-memory preparation path."""
import unittest
import torch
from test_backend import backend


class MaskBoundaryTests(unittest.TestCase):
    def test_dense_sparse_empty_and_skinny_mask_bounds(self):
        for height, width in [(1, 1), (1, 79), (81, 1), (192, 256)]:
            for kind in ('empty', 'full', 'corners', 'middle'):
                mask = torch.zeros(height, width)
                if kind == 'full': mask.fill_(1)
                elif kind == 'corners': mask[0, 0] = mask[-1, -1] = .01
                elif kind == 'middle': mask[height//2, width//2] = .7
                for padding in (0, 7, 2048):
                    box = backend._bbox(mask, padding, width/height)
                    x0, y0, x1, y1 = box
                    self.assertTrue(0 <= x0 < x1 <= width)
                    self.assertTrue(0 <= y0 < y1 <= height)
                    self.assertEqual(float(mask.sum()), float(mask[y0:y1, x0:x1].sum()))
                    if kind in ('full', 'corners', 'empty'):
                        self.assertEqual(box, (0, 0, width, height))

    def test_sanitizing_never_mutates_upstream_tensors(self):
        image = torch.tensor([float('nan'), float('inf'), -1.0, 2.0]*3).reshape(1, 2, 2, 3)
        original = image.clone()
        output = backend._image_tensor(image)
        self.assertTrue(torch.equal(torch.isnan(original), torch.isnan(image)))
        self.assertTrue(torch.equal(original[~torch.isnan(original)], image[~torch.isnan(image)]))
        self.assertTrue(torch.isfinite(output).all())
        self.assertTrue(((output >= 0) & (output <= 1)).all())
        mask = torch.full((1, 2, 2), 2.0)
        self.assertEqual(float(backend._mask_tensor(mask, output).max()), 1)
        self.assertEqual(float(mask.min()), 2)
