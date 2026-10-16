"""Regression coverage for image models using single-frame video-derived VAEs."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

import torch
import torch.nn.functional as F

spec = importlib.util.spec_from_file_location("vae_format_backend", Path(__file__).resolve().parents[1] / "backend.py")
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class VideoDerivedVAE:
    latent_dim = 3
    downscale_ratio = (lambda t: (t + 3) // 4, 8, 8)

    def __init__(self):
        self.encoded_batches = []

    def spacial_compression_encode(self):
        return 8

    def encode(self, pixels):
        self.encoded_batches.append(pixels.shape[0])
        # Like Wan/Qwen VAE, an IMAGE batch would otherwise become time.
        frames = F.interpolate(pixels.mean(-1)[:, None], scale_factor=1 / 8, mode="bilinear", align_corners=False)
        return frames.permute(1, 0, 2, 3)[None].repeat(1, 16, 1, 1, 1)

    def decode(self, samples):
        image = F.interpolate(samples[:, :1, 0], scale_factor=8, mode="nearest")
        return image.repeat(1, 3, 1, 1).permute(0, 2, 3, 1)[:, None]


class ImageVAEFormatTests(unittest.TestCase):
    def inputs(self):
        image = torch.stack([torch.full((64, 64, 3), .2), torch.full((64, 64, 3), .8)])
        masks = torch.zeros(2, 64, 64)
        masks[0, :, :32] = 1
        masks[1, :, 32:] = 1
        return image, masks

    def test_5d_latents_preserve_batch_masks_compositing_and_variants(self):
        for area in ("whole_image", "only_masked"):
            with self.subTest(area=area):
                image, masks = self.inputs()
                vae, captured = VideoDerivedVAE(), []
                def sample(*args, **kwargs):
                    captured.append(args[8])
                    return (args[8],)
                with patch.dict(sys.modules, {"nodes": types.SimpleNamespace(common_ksampler=sample)}):
                    result, crop, mask = backend.AdachiWebUIInpaint().sample(None, [], [], vae, image, masks,
                        width=64, height=64, area=area, mask_blur=0, batch_size=2)
                self.assertEqual(vae.encoded_batches, [1, 1, 1, 1])
                self.assertEqual(captured[0]["samples"].shape, (4, 16, 1, 8, 8))
                self.assertEqual(captured[0]["noise_mask"].shape, (4, 1, 1, 8, 8))
                self.assertTrue(torch.allclose(captured[0]["samples"].mean((1, 2, 3, 4)), torch.tensor([.2, .2, .8, .8])))
                originals, masks = image.repeat_interleave(2, 0), masks.repeat_interleave(2, 0)
                self.assertEqual(result.shape, originals.shape)
                self.assertEqual(crop.shape, (4, 64, 64, 3))
                self.assertEqual(mask.shape, (4, 64, 64))
                self.assertTrue(torch.equal(result[masks == 0], originals[masks == 0]))

    def test_5d_noise_and_zero_fill_only_modify_masked_latents(self):
        image, masks = self.inputs()
        captured = []
        def sample(*args, **kwargs):
            captured.append(args[8])
            return (args[8],)
        with patch.dict(sys.modules, {"nodes": types.SimpleNamespace(common_ksampler=sample)}):
            for fill in ("latent_noise", "latent_noise", "latent_nothing"):
                backend.AdachiWebUIInpaint().sample(None, [], [], VideoDerivedVAE(), image, masks,
                    width=64, height=64, area="whole_image", mask_blur=0, fill=fill, seed=42)
        self.assertTrue(torch.equal(captured[0]["samples"], captured[1]["samples"]))
        for latent in captured:
            protected = (latent["noise_mask"] == 0).expand_as(latent["samples"])
            expected = torch.tensor([.2, .8])[:, None, None, None, None].expand_as(latent["samples"])
            self.assertTrue(torch.allclose(latent["samples"][protected], expected[protected]))
        selected = (captured[2]["noise_mask"] == 1).expand_as(captured[2]["samples"])
        self.assertTrue(torch.equal(captured[2]["samples"][selected], torch.zeros_like(captured[2]["samples"][selected])))
        self.assertFalse(torch.equal(captured[0]["samples"][0], captured[0]["samples"][1]))

    def test_unknown_vae_wrapper_recovers_independent_batch(self):
        vae = VideoDerivedVAE()
        wrapper = types.SimpleNamespace(encode=vae.encode)
        samples = backend._encode_still_images(wrapper, self.inputs()[0])
        self.assertEqual(samples.shape, (2, 16, 1, 8, 8))
        self.assertEqual(vae.encoded_batches, [2, 1, 1])

    def test_native_inpaint_conditioning_keeps_5d_batch_axis(self):
        image, masks = self.inputs()
        original_meta = {"marker": "retained"}
        conditioning = [[torch.zeros(1, 2, 3), original_meta]]
        class Native:
            def encode(self, positive, negative, pixels, vae, mask, noise_mask):
                metadata = dict(original_meta, concat_latent_image=vae.encode(pixels), concat_mask=mask[:, None])
                return [[positive[0][0], metadata]], [[negative[0][0], metadata]], {"samples": vae.encode(pixels), "native_field": True}
        def sample(*args, **kwargs):
            self.assertEqual(args[6][0][1]["concat_mask"].shape, (2, 1, 1, 64, 64))
            self.assertEqual(args[6][0][1]["concat_latent_image"].shape, (2, 16, 1, 8, 8))
            self.assertTrue(args[8]["native_field"])
            return (args[8],)
        with patch.dict(sys.modules, {"nodes": types.SimpleNamespace(common_ksampler=sample, InpaintModelConditioning=Native)}):
            backend.AdachiWebUIInpaint().sample(None, conditioning, conditioning, VideoDerivedVAE(), image, masks,
                width=64, height=64, mask_blur=0, inpaint_model=True)
        self.assertEqual(original_meta, {"marker": "retained"})

    def test_refiner_preserves_single_frame_shape(self):
        image, masks = self.inputs()
        calls = []
        def sample(*args, **kwargs):
            calls.append(args[8]["samples"].shape)
            return (args[8],)
        with patch.dict(sys.modules, {"nodes": types.SimpleNamespace(common_ksampler=sample)}):
            backend.AdachiWebUIInpaint().sample(None, [], [], VideoDerivedVAE(), image, masks, refiner_model=object(),
                width=64, height=64, mask_blur=0)
        self.assertEqual(calls, [(2, 16, 1, 8, 8)] * 2)

    def test_actual_video_or_invalid_vae_outputs_fail_explicitly(self):
        for samples in (torch.zeros(1, 16, 2, 8, 8), torch.zeros(1, 8, 8), "bad"):
            with self.subTest(type=type(samples)), self.assertRaises(ValueError):
                backend._check_image_latents(samples, 1)
        with self.assertRaisesRegex(ValueError, "batch"):
            backend._check_image_latents(torch.zeros(1, 4, 8, 8), 2)
        vae = types.SimpleNamespace(decode=lambda latent: torch.zeros(1, 2, 64, 64, 3))
        with self.assertRaisesRegex(ValueError, "multiple frames"):
            backend._decode_still_images(vae, torch.zeros(1, 16, 1, 8, 8), 1)


if __name__ == "__main__":
    unittest.main()
