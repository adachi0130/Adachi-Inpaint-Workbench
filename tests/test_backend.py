"""CPU regression tests; no ComfyUI server, checkpoint or GPU is required.

Run with the Python shipped with ComfyUI:
    python -m unittest discover -s tests -v
"""

import base64
import importlib.util
import io
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
import torch
import torch.nn.functional as F

SPEC = importlib.util.spec_from_file_location("adachi_backend_under_test", Path(__file__).resolve().parents[1] / "backend.py")
backend = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backend)


def data_url(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def source(batch=1, height=96, width=160):
    pixels = torch.linspace(0, 1, batch * height * width * 3).reshape(batch, height, width, 3)
    mask = torch.zeros(batch, height, width)
    mask[:, 30:50, 60:80] = 1
    return pixels, mask


def prepare(image, mask, **options):
    return backend._prepare(image, mask, width=64, height=64, padding=4, mask_blur=0, **options)


class FakeVAE:
    downscale_ratio = 8

    def __init__(self, channels=4):
        self.channels = channels
        self.encodes = 0

    def encode(self, pixels):
        self.encodes += 1
        latent = F.interpolate(pixels.mean(-1)[:, None], scale_factor=1 / self.downscale_ratio, mode="bilinear", align_corners=False)
        return latent.repeat(1, self.channels, 1, 1)

    def decode(self, latent):
        value = F.interpolate(latent[:, :1], scale_factor=self.downscale_ratio, mode="nearest")
        return value.repeat(1, 3, 1, 1).permute(0, 2, 3, 1).clamp(0, 1)


class BackendTests(unittest.TestCase):
    def test_comparison_previews_and_result_passthrough(self):
        image, _ = source()
        result = image.repeat_interleave(3, 0)
        calls = []
        class Preview:
            def save_images(self, images, filename_prefix):
                calls.append((images.clone(), filename_prefix))
                return {"ui": {"images": [{"filename": f"{filename_prefix}_{i}.png", "subfolder": "", "type": "temp"} for i in range(len(images))]}}
        with patch.dict(sys.modules, {"nodes": types.SimpleNamespace(PreviewImage=Preview)}):
            output = backend.AdachiImageCompare().compare(image, result)
        self.assertTrue(torch.equal(output["result"][0], result))
        self.assertEqual(len(output["ui"]["adachi_originals"]), 1)
        self.assertEqual(len(output["ui"]["adachi_results"]), 3)
        self.assertTrue(torch.equal(calls[0][0], image))
        self.assertTrue(torch.equal(calls[1][0], result))

    def test_comparison_rejects_crop_and_incompatible_batch(self):
        image, _ = source(batch=2)
        with patch.dict(sys.modules, {"nodes": types.SimpleNamespace()}):
            with self.assertRaisesRegex(ValueError, "crop"):
                backend.AdachiImageCompare().compare(image, image[:, :32])
            with self.assertRaisesRegex(ValueError, "batch"):
                backend.AdachiImageCompare().compare(image, image[:1])

    def test_original_protected_exactly_in_both_areas(self):
        image, mask = source()
        for area in ("whole_image", "only_masked"):
            with self.subTest(area=area):
                pixels, prepared_mask, context = prepare(image, mask, area=area)
                result = backend._composite(torch.ones_like(pixels), context)
                self.assertEqual(result.shape, image.shape)
                self.assertTrue(torch.equal(result[mask == 0], image[mask == 0]))
                self.assertTrue(torch.allclose(result[mask == 1], torch.ones_like(result[mask == 1]), atol=1e-6))
                self.assertEqual(tuple(prepared_mask.shape), (1, 64, 64))

    def test_empty_mask_and_denoise_zero_skip_vae_and_sampling(self):
        image, mask = source()
        vae = FakeVAE()
        sampler = types.SimpleNamespace(common_ksampler=lambda *a, **k: self.fail("Sampling should be skipped"))
        with patch.dict(sys.modules, {"nodes": sampler}):
            for denoise, tested_mask in ((0, mask), (0.75, torch.zeros_like(mask))):
                output, _, _ = backend.AdachiWebUIInpaint().sample(None, [], [], vae, image, tested_mask,
                    denoise=denoise, batch_size=3, width=64, height=64, padding=4, mask_blur=0)
                self.assertTrue(torch.equal(output, image.repeat_interleave(3, 0)))
        self.assertEqual(vae.encodes, 0)

    def test_invert_repaints_outside(self):
        image, mask = source()
        pixels, _, context = prepare(image, mask, mask_mode="outside", area="whole_image")
        result = backend._composite(torch.zeros_like(pixels), context)
        self.assertTrue(torch.equal(result[mask == 1], image[mask == 1]))
        self.assertTrue(torch.equal(result[mask == 0], torch.zeros_like(result[mask == 0])))

    def test_corner_masks_are_never_cropped_in_mask_only_mode(self):
        image, _ = source()
        for y, x in ((0, 0), (0, 159), (95, 0), (95, 159)):
            for resize_mode in ("stretch", "crop", "fill"):
                mask = torch.zeros(1, 96, 160)
                mask[0, y, x] = 1
                pixels, _, context = prepare(image, mask, resize_mode=resize_mode)
                result = backend._composite(torch.ones_like(pixels), context)
                self.assertTrue(torch.equal(result[0, y, x], torch.ones(3)))
                self.assertTrue(torch.equal(result[mask == 0], image[mask == 0]))

    def test_bbox_padding_and_target_ratio(self):
        image, mask = source(height=200, width=300)
        _, _, context = prepare(image, mask)
        x0, y0, x1, y1 = context["records"][0]["box"]
        self.assertEqual(x1 - x0, y1 - y0)
        self.assertLessEqual(x0, 56)
        self.assertGreaterEqual(x1, 84)
        self.assertLessEqual(y0, 26)
        self.assertGreaterEqual(y1, 54)

    def test_batch_grouping_and_single_mask_broadcast(self):
        image, mask = source(batch=2)
        pixels, _, context = prepare(image, mask[:1])
        variants = torch.stack([torch.full_like(pixels[0], value) for value in (0.1, 0.2, 0.3, 0.4)])
        output = backend._composite(variants, context)
        self.assertEqual(output.shape[0], 4)
        for index in range(4):
            self.assertTrue(torch.equal(output[index][mask[0] == 0], image[index // 2][mask[0] == 0]))
            self.assertTrue(torch.allclose(output[index, 40, 70], torch.full((3,), (index + 1) / 10), atol=1e-6))

    def test_mask_growth_and_feather_have_effective_support(self):
        image, mask = source()
        _, _, context = prepare(image, mask, mask_grow=3)
        self.assertEqual(float(context["mask"][0, 27, 57]), 1)
        _, _, eroded = prepare(image, mask, mask_grow=-3)
        self.assertEqual(float(eroded["mask"][0, 30, 60]), 0)
        _, _, softened = backend._prepare(image, mask, width=64, height=64, mask_blur=2)
        edge = float(softened["mask"][0, 30, 60])
        self.assertGreater(edge, 0)
        self.assertLess(edge, 1)

    def test_fill_uses_surrounding_color_and_preserves_unmasked_pixels(self):
        image = torch.ones(1, 64, 64, 3) * 0.8
        image[:, 20:44, 20:44] = 0.1
        mask = torch.zeros(1, 64, 64)
        mask[:, 20:44, 20:44] = 1
        original, _, _ = prepare(image, mask, area="whole_image", fill="original")
        filled, prepared_mask, _ = prepare(image, mask, area="whole_image", fill="fill")
        self.assertTrue(torch.equal(filled[prepared_mask == 0], original[prepared_mask == 0]))
        self.assertGreater(float(filled[0, 32, 32].mean()), 0.7)

    def test_resize_fill_content_is_removed_during_composite(self):
        image, mask = source()
        mask.fill_(1)
        pixels, _, context = prepare(image, mask, area="whole_image", resize_mode="fill")
        left, top, right, bottom = context["records"][0]["content"]
        self.assertGreater(top, 0)
        generated = torch.zeros_like(pixels)
        generated[:, top:bottom, left:right] = 0.7
        output = backend._composite(generated, context)
        self.assertTrue(torch.allclose(output, torch.full_like(output, 0.7), atol=1e-6))

    def test_embedded_source_and_mask_convention(self):
        rgba = Image.new("RGBA", (8, 4), (10, 20, 30, 255))
        rgba.putpixel((0, 0), (10, 20, 30, 0))
        pixels, alpha_mask = backend.AdachiInlineMask().load(source_data=data_url(rgba))
        self.assertEqual(tuple(pixels.shape), (1, 4, 8, 3))
        self.assertEqual(float(alpha_mask[0, 0, 0]), 1)
        self.assertEqual(float(alpha_mask[0, 1, 1]), 0)
        blackwhite = Image.new("L", (8, 4), 0)
        blackwhite.putpixel((2, 1), 255)
        _, explicit_mask = backend.AdachiInlineMask().load(source_data=data_url(rgba), mask_data=data_url(blackwhite))
        self.assertEqual(float(explicit_mask[0, 1, 2]), 1)
        self.assertEqual(float(explicit_mask[0, 0, 0]), 0)

    def test_reject_invalid_data_dimensions_and_batch(self):
        for data in ("data:image/svg+xml;base64,PHN2Zz4=", "not an image", "data:image/png;base64,!!"):
            with self.assertRaises(ValueError):
                backend._data_image(data)
        image, mask = source()
        for size in (63, 65, 8200):
            with self.assertRaises(ValueError):
                backend._prepare(image, mask, width=size, height=64)
        with self.assertRaises(ValueError):
            prepare(image, mask.repeat(2, 1, 1))

    def test_latent_noise_zero_modes_and_nonfour_channel_vae(self):
        image, mask = source(height=64, width=64)
        mask.fill_(1)
        captured = []
        def sample(*args, **kwargs):
            captured.append({key: value.clone() if isinstance(value, torch.Tensor) else value for key, value in args[8].items()})
            return (args[8],)
        with patch.dict(sys.modules, {"nodes": types.SimpleNamespace(common_ksampler=sample)}):
            node = backend.AdachiWebUIInpaint()
            for fill in ("latent_noise", "latent_noise", "latent_nothing", "original"):
                node.sample(None, [], [], FakeVAE(channels=16), image, mask, fill=fill, seed=42,
                    width=64, height=64, area="whole_image", mask_blur=0, batch_size=2)
        self.assertEqual(tuple(captured[0]["samples"].shape), (2, 16, 8, 8))
        self.assertEqual(tuple(captured[0]["noise_mask"].shape), (2, 1, 8, 8))
        self.assertTrue(torch.equal(captured[0]["samples"], captured[1]["samples"]))
        self.assertFalse(torch.equal(captured[0]["samples"][0], captured[0]["samples"][1]))
        self.assertTrue(torch.equal(captured[2]["samples"], torch.zeros_like(captured[2]["samples"])))
        self.assertGreater(float(captured[3]["samples"].abs().sum()), 0)

    def test_refiner_switch_uses_two_contiguous_sampler_stages(self):
        image, mask = source(height=64, width=64)
        calls = []
        def sample(*args, **kwargs):
            calls.append((args, kwargs))
            return (args[8],)
        base_model, refiner = object(), object()
        with patch.dict(sys.modules, {"nodes": types.SimpleNamespace(common_ksampler=sample)}):
            backend.AdachiWebUIInpaint().sample(base_model, ["base+"], ["base-"], FakeVAE(), image, mask,
                steps=20, refiner_model=refiner, refiner_positive=["ref+"], refiner_negative=["ref-"],
                refiner_switch=0.8, width=64, height=64, mask_blur=0)
        self.assertEqual(len(calls), 2)
        self.assertIs(calls[0][0][0], base_model)
        self.assertIs(calls[1][0][0], refiner)
        self.assertEqual(calls[0][1]["last_step"], 16)
        self.assertEqual(calls[1][1]["start_step"], 16)
        self.assertTrue(calls[1][1]["disable_noise"])
        self.assertEqual(calls[1][0][6], ["ref+"])

    def test_dedicated_inpaint_uses_native_conditioning_and_noise_mask(self):
        image, mask = source(height=64, width=64)
        calls = []
        class NativeConditioning:
            def encode(self, **kwargs):
                calls.append(kwargs)
                return ["native+"], ["native-"], {"samples": kwargs["vae"].encode(kwargs["pixels"]), "native_field": "preserved"}
        def sample(*args, **kwargs):
            self.assertEqual(args[6], ["native+"])
            self.assertEqual(args[7], ["native-"])
            self.assertEqual(args[8]["native_field"], "preserved")
            self.assertEqual(tuple(args[8]["noise_mask"].shape), (1, 1, 8, 8))
            return (args[8],)
        fake_nodes = types.SimpleNamespace(common_ksampler=sample, InpaintModelConditioning=NativeConditioning)
        with patch.dict(sys.modules, {"nodes": fake_nodes}):
            backend.AdachiWebUIInpaint().sample(None, [], [], FakeVAE(), image, mask,
                inpaint_model=True, width=64, height=64, mask_blur=0)
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0]["noise_mask"])

    def test_vae_compression_alignment_restores_original_dimensions(self):
        image, mask = source()
        vae = FakeVAE()
        vae.downscale_ratio = 16
        captured = []
        def sample(*args, **kwargs):
            captured.append(tuple(args[8]["samples"].shape))
            return (args[8],)
        with patch.dict(sys.modules, {"nodes": types.SimpleNamespace(common_ksampler=sample)}):
            output, crop, prepared_mask = backend.AdachiWebUIInpaint().sample(None, [], [], vae, image, mask,
                width=72, height=88, mask_blur=0)
        self.assertEqual(captured, [(1, 4, 6, 5)])
        self.assertEqual(tuple(crop.shape), (1, 96, 80, 3))
        self.assertEqual(tuple(prepared_mask.shape), (1, 96, 80))
        self.assertEqual(output.shape, image.shape)
        self.assertTrue(torch.equal(output[mask == 0], image[mask == 0]))

    def test_incompatible_refiner_latent_format_is_rejected(self):
        def model(channels):
            return types.SimpleNamespace(model=types.SimpleNamespace(latent_format=types.SimpleNamespace(latent_channels=channels)))
        with self.assertRaisesRegex(ValueError, "incompatible"):
            backend._check_refiner(model(4), model(16))


if __name__ == "__main__":
    unittest.main()
