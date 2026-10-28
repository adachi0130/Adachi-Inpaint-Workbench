"""Portable inline inpainting nodes for ComfyUI (MIT licensed).

All image and crop operations below are original implementations. No code from
AUTOMATIC1111, Forge or their AGPL components is included.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import math
from pathlib import Path
import re
import tempfile
import warnings

import numpy as np
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError
import torch
import torch.nn.functional as F

if __package__:
    from .preview_store import PREVIEWS
else:  # Standalone CPU tests load this module directly.
    from preview_store import PREVIEWS


CATEGORY = "Adachi-Inpaint-Workbench"
MAX_IMAGE_PIXELS = 32_000_000
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_DATA_URL_CHARS = 4 * ((MAX_IMAGE_BYTES + 2) // 3) + 128


def _read_raster(stream):
    """Decode one bounded raster, with EXIF orientation applied consistently."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(stream) as opened:
                if opened.width * opened.height > MAX_IMAGE_PIXELS or max(opened.size) > 16384:
                    raise ValueError("Image exceeds the 32 megapixel / 16384 pixel side safety limit.")
                if opened.format not in {"PNG", "JPEG", "WEBP", "BMP", "TIFF", "GIF"}:
                    raise ValueError("Use a PNG, JPEG, WebP, BMP, TIFF or GIF image.")
                opened.seek(0)
                return ImageOps.exif_transpose(opened).copy()
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("Image is too large to decode safely.") from exc
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("The image cannot be decoded. Upload a valid raster image.") from exc


def _data_image(data):
    if not isinstance(data, str) or len(data) > MAX_DATA_URL_CHARS:
        raise ValueError("Embedded image exceeds the 64 MiB safety limit.")
    match = re.fullmatch(r"data:image/(?:png|jpeg|jpg|webp|bmp|tiff|gif);base64,([A-Za-z0-9+/=\r\n]+)", data)
    if not match:
        raise ValueError("Expected a base64 raster image data URL.")
    try:
        decoded = base64.b64decode(match.group(1).replace("\r", "").replace("\n", ""), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Embedded image contains invalid base64.") from exc
    if len(decoded) > MAX_IMAGE_BYTES:
        raise ValueError("Embedded image exceeds the 64 MiB safety limit.")
    return _read_raster(io.BytesIO(decoded))


def _input_path(filename):
    import folder_paths

    if not isinstance(filename, str) or not filename.strip():
        raise ValueError("Upload or drop an image into the inline editor first.")
    filename = filename.strip()
    if filename.endswith(" [input]"):
        filename = filename[:-8]
    if filename.endswith((" [output]", " [temp]")):
        raise ValueError("Only ComfyUI input-directory images are accepted.")
    relative = Path(filename)
    # Reject drive-qualified and backslash traversal even on non-Windows hosts.
    if relative.is_absolute() or re.match(r"^[A-Za-z]:", filename) or filename.startswith(("\\", "/")):
        raise ValueError("Image must be a relative path inside the ComfyUI input directory.")
    if ".." in filename.replace("\\", "/").split("/"):
        raise ValueError("Image path must stay inside the ComfyUI input directory.")
    root = Path(folder_paths.get_input_directory()).resolve()
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("Image path resolves outside the ComfyUI input directory.") from exc
    if not candidate.is_file():
        raise ValueError(f"Image was not found in ComfyUI input: {filename}")
    if candidate.stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError("Image exceeds the 64 MiB safety limit.")
    return candidate


def _image_tensor(image):
    value = torch.as_tensor(image)
    if value.ndim != 4 or value.shape[-1] not in (3, 4) or min(value.shape[:3]) < 1:
        raise ValueError("IMAGE must have shape [batch, height, width, 3 or 4].")
    return torch.nan_to_num(value[..., :3].float(), nan=0.0, posinf=1.0, neginf=0.0).clamp(0.0, 1.0)


def _mask_tensor(mask, images):
    value = torch.as_tensor(mask, device=images.device, dtype=torch.float32)
    if value.ndim == 2:
        value = value.unsqueeze(0)
    elif value.ndim == 4 and value.shape[1] == 1:
        value = value[:, 0]
    elif value.ndim == 4 and value.shape[-1] == 1:
        value = value[..., 0]
    if value.ndim != 3 or min(value.shape) < 1:
        raise ValueError("MASK must have shape [batch, height, width].")
    if value.shape[0] == 1 and images.shape[0] > 1:
        value = value.expand(images.shape[0], -1, -1)
    if value.shape[0] != images.shape[0]:
        raise ValueError("Mask batch must contain one mask or match the image batch.")
    value = torch.nan_to_num(value, nan=0.0, posinf=1.0, neginf=0.0).clamp(0, 1)
    if value.shape[-2:] != images.shape[1:3]:
        value = F.interpolate(value[:, None], size=images.shape[1:3], mode="bilinear", align_corners=False)[:, 0]
    return value


def _feather(mask, grow, blur):
    """Signed square morphology followed by a Gaussian, independent per image."""
    grow = int(grow)
    if grow:
        radius = abs(grow)
        expanded = F.max_pool2d((mask if grow > 0 else 1 - mask)[:, None], 2 * radius + 1, stride=1, padding=radius)[:, 0]
        mask = expanded if grow > 0 else 1 - expanded
    if blur > 0:
        outputs = []
        for value in mask:
            # Pillow's separable Gaussian is fast on CPU even for a large radius.
            src = Image.fromarray(np.uint8(np.rint(value.detach().cpu().numpy() * 255)), "L")
            result = np.asarray(src.filter(ImageFilter.GaussianBlur(float(blur))), dtype=np.float32).copy() / 255.0
            outputs.append(torch.from_numpy(result))
        mask = torch.stack(outputs).to(device=mask.device, dtype=mask.dtype)
    return mask.clamp(0, 1)


def _bbox(mask, padding, target_ratio):
    height, width = mask.shape
    nonzero = torch.nonzero(mask > 0, as_tuple=False)
    if not len(nonzero):
        return (0, 0, width, height)
    y0, x0 = nonzero.amin(0).tolist()
    y1, x1 = (nonzero.amax(0) + 1).tolist()
    x0, y0 = max(0, x0 - padding), max(0, y0 - padding)
    x1, y1 = min(width, x1 + padding), min(height, y1 + padding)
    crop_width, crop_height = x1 - x0, y1 - y0
    # Expand within the source bounds, without cutting any part of the mask.
    if crop_width / crop_height < target_ratio:
        desired = min(width, max(crop_width, math.ceil(crop_height * target_ratio)))
        x0 = min(max(0, x0 - (desired - crop_width) // 2), width - desired)
        x1 = x0 + desired
    else:
        desired = min(height, max(crop_height, math.ceil(crop_width / target_ratio)))
        y0 = min(max(0, y0 - (desired - crop_height) // 2), height - desired)
        y1 = y0 + desired
    return (x0, y0, x1, y1)


def _resize_image(value, height, width):
    return F.interpolate(value.permute(0, 3, 1, 2), size=(height, width), mode="bicubic", align_corners=False, antialias=True).permute(0, 2, 3, 1).clamp(0, 1)


def _resize_mask(value, height, width):
    return F.interpolate(value[:, None], size=(height, width), mode="bilinear", align_corners=False)[:, 0].clamp(0, 1)


def _transform(image, mask, box, width, height, mode):
    x0, y0, x1, y1 = box
    if mode == "crop":
        source_ratio, target_ratio = (x1 - x0) / (y1 - y0), width / height
        if source_ratio > target_ratio:
            new_width = max(1, round((y1 - y0) * target_ratio))
            x0 += ((x1 - x0) - new_width) // 2
            x1 = x0 + new_width
        else:
            new_height = max(1, round((x1 - x0) / target_ratio))
            y0 += ((y1 - y0) - new_height) // 2
            y1 = y0 + new_height
    image = image[:, y0:y1, x0:x1]
    mask = mask[:, y0:y1, x0:x1]
    if mode == "fill":
        scale = min(width / (x1 - x0), height / (y1 - y0))
        scaled_width = min(width, max(1, round((x1 - x0) * scale)))
        scaled_height = min(height, max(1, round((y1 - y0) * scale)))
        left, top = (width - scaled_width) // 2, (height - scaled_height) // 2
        image = _resize_image(image, scaled_height, scaled_width)
        image = F.pad(image.permute(0, 3, 1, 2), (left, width - scaled_width - left, top, height - scaled_height - top), mode="replicate").permute(0, 2, 3, 1)
        mask = F.pad(_resize_mask(mask, scaled_height, scaled_width), (left, width - scaled_width - left, top, height - scaled_height - top))
        content = (left, top, left + scaled_width, top + scaled_height)
    else:
        image, mask = _resize_image(image, height, width), _resize_mask(mask, height, width)
        content = (0, 0, width, height)
    return image, mask, {"box": (x0, y0, x1, y1), "content": content, "size": (width, height)}


def _fill_pixels(image, mask):
    """Original edge-color fill using normalized multi-radius surrounding colors."""
    output = []
    for pixels, alpha in zip(image, mask):
        rgb = pixels.detach().cpu().numpy()
        known = (1.0 - alpha.detach().cpu().numpy()).clip(0, 1)
        total = known.sum()
        mean = (rgb * known[..., None]).sum((0, 1)) / total if total > 1e-6 else np.full(3, 0.5)
        filled = np.broadcast_to(mean, rgb.shape).copy()
        weighted = Image.fromarray(np.uint8(np.rint(np.clip(rgb * known[..., None], 0, 1) * 255)), "RGB")
        weights = Image.fromarray(np.uint8(np.rint(known * 255)), "L")
        for radius in (256, 64, 16, 4):
            numerator = np.asarray(weighted.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255
            denominator = np.asarray(weights.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255
            available = denominator > 0.01
            filled[available] = (numerator / np.maximum(denominator[..., None], 1 / 255))[available]
        replacement = torch.from_numpy(np.clip(filled, 0, 1)).to(device=pixels.device, dtype=pixels.dtype)
        output.append(pixels * (1 - alpha[..., None]) + replacement * alpha[..., None])
    return torch.stack(output)


def _prepare(image, mask, area="only_masked", width=1024, height=1024, padding=32, mask_blur=4.0, mask_grow=0,
             mask_mode="inside", fill="original", resize_mode="stretch", soft_edge=False, soft_strength=0.5):
    """Prepare sampling canvases; BOTH areas composite back at original dimensions.

    Unlike WebUI's whole-image output sizing, width/height here always describe
    only the sampling canvas. This preserves unmasked original pixels exactly.
    All non-original fill modes first fill the masked pixels with surrounding
    colors before VAE encoding. The all-in-one sampler then replaces the masked
    latent values with noise or zeros for the two latent fill modes, so masked
    source details cannot leak into nearby encoded latent pixels.
    """
    images = _image_tensor(image)
    masks = _mask_tensor(mask, images)
    width, height = int(width), int(height)
    if not (64 <= width <= 8192 and 64 <= height <= 8192 and width % 8 == 0 and height % 8 == 0):
        raise ValueError("Sampling width/height must be multiples of 8 between 64 and 8192.")
    if area not in {"whole_image", "only_masked"} or mask_mode not in {"inside", "outside"}:
        raise ValueError("Unknown inpaint area or mask mode.")
    if fill not in {"original", "fill", "latent_noise", "latent_nothing"} or resize_mode not in {"stretch", "crop", "fill"}:
        raise ValueError("Unknown fill or resize mode.")
    if not (0 <= int(padding) <= 2048 and -128 <= int(mask_grow) <= 128 and 0 <= float(mask_blur) <= 128):
        raise ValueError("Padding, mask growth or blur is outside its supported range.")
    if not 0 <= float(soft_strength) <= 1:
        raise ValueError("Soft feather strength must be between 0 and 1.")
    if mask_mode == "outside":
        masks = 1 - masks
    masks = _feather(masks, int(mask_grow), float(mask_blur) + (16 * float(soft_strength) if soft_edge else 0))
    all_pixels, all_masks, records = [], [], []
    for index in range(images.shape[0]):
        box = _bbox(masks[index], int(padding), width / height) if area == "only_masked" else (0, 0, images.shape[2], images.shape[1])
        # Mask-only processing must retain all mask pixels, even at image edges.
        transform_mode = "fill" if area == "only_masked" else resize_mode
        pixels, prepared_mask, record = _transform(images[index:index + 1], masks[index:index + 1], box, width, height, transform_mode)
        all_pixels.append(pixels)
        all_masks.append(prepared_mask)
        records.append(record)
    pixels, prepared_masks = torch.cat(all_pixels), torch.cat(all_masks)
    if fill in {"fill", "latent_noise", "latent_nothing"}:
        pixels = _fill_pixels(pixels, prepared_masks)
    context = {"version": 1, "original": images.clone(), "mask": masks, "records": records, "fill": fill,
               "empty": not bool(torch.any(masks > 0).item())}
    return pixels, prepared_masks, context


def _composite(generated, context):
    generated = _image_tensor(generated)
    if not isinstance(context, dict) or context.get("version") != 1:
        raise ValueError("Connect the context output from Adachi Inpaint Prepare.")
    originals, masks, records = context["original"], context["mask"], context["records"]
    if generated.shape[0] % originals.shape[0] != 0:
        raise ValueError("Generated batch must be a multiple of the prepared image batch.")
    repetitions = generated.shape[0] // originals.shape[0]
    outputs = []
    for index, result in enumerate(generated):
        original_index = index // repetitions
        record = records[original_index]
        original = originals[original_index:original_index + 1]
        result = result[None].to(device=original.device, dtype=original.dtype)
        width, height = record["size"]
        if result.shape[1:3] != (height, width):
            result = _resize_image(result, height, width)
        left, top, right, bottom = record["content"]
        x0, y0, x1, y1 = record["box"]
        patch = _resize_image(result[:, top:bottom, left:right], y1 - y0, x1 - x0)
        alpha = masks[original_index:original_index + 1, y0:y1, x0:x1, None]
        source = original[:, y0:y1, x0:x1]
        blended = torch.where(alpha > 0, source * (1 - alpha) + patch * alpha, source)
        output = original.clone()
        output[:, y0:y1, x0:x1] = blended
        outputs.append(output)
    return torch.cat(outputs)


def _prepare_inputs():
    return {
        "image": ("IMAGE", {"tooltip": "Original image; output is restored to this exact size."}),
        "mask": ("MASK", {"tooltip": "White repaints; black preserves."}),
        "area": (["whole_image", "only_masked"], {"default": "only_masked", "tooltip": "Whole image or mask bounding-box inpainting."}),
        "width": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8, "tooltip": "Sampling canvas width, independent of final image size."}),
        "height": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8, "tooltip": "Sampling canvas height."}),
        "padding": ("INT", {"default": 32, "min": 0, "max": 2048, "step": 1, "tooltip": "Mask-only context padding in original pixels."}),
        "mask_blur": ("FLOAT", {"default": 4.0, "min": 0.0, "max": 128.0, "step": 0.5, "tooltip": "Gaussian mask feathering in original pixels."}),
        "mask_grow": ("INT", {"default": 0, "min": -128, "max": 128, "step": 1, "tooltip": "Positive dilates; negative erodes the mask."}),
        "mask_mode": (["inside", "outside"], {"default": "inside", "tooltip": "Repaint inside or invert the mask."}),
        "fill": (["original", "fill", "latent_noise", "latent_nothing"], {"default": "original", "tooltip": "Original, surrounding-color fill, latent noise, or zero latent. Latent modes require the all-in-one sampler."}),
        "resize_mode": (["stretch", "crop", "fill"], {"default": "stretch", "tooltip": "Whole-image resize mode; mask-only mode always retains the entire mask."}),
    }


class AdachiInlineMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("STRING", {"default": "", "tooltip": "Input image path populated by inline upload."}),
            "mask_data": ("STRING", {"default": "", "multiline": False, "tooltip": "Editor mask PNG data URL; white repaints."}),
            "source_data": ("STRING", {"default": "", "multiline": False, "tooltip": "Embedded source image for portable workflows."}),
        }, "optional": {
            "edit_mode": (["mask", "crop"], {"default": "mask"}),
            "crop_state": ("STRING", {"default": "{}"}),
            "blend_data": ("STRING", {"default": ""}),
            "layer_image": ("STRING", {"default": ""}),
        }}

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE")
    RETURN_NAMES = ("image", "mask", "full_image")
    FUNCTION = "load"
    CATEGORY = CATEGORY
    DESCRIPTION = "Paint an inpaint mask directly in the workflow."
    SEARCH_ALIASES = ["inline mask", "webui inpaint", "局部重绘", "安达", "adachi"]

    @classmethod
    def IS_CHANGED(cls, image="", mask_data="", source_data="", **kwargs):
        digest = hashlib.sha256()
        for value in (image, mask_data, source_data, json.dumps(kwargs, sort_keys=True, default=str)):
            digest.update(str(value).encode("utf-8"))
            digest.update(b"\x00")
        if not source_data:
            # The source is a stable input file; hashing its size and mtime is
            # enough to detect a replacement and avoids reading a full high-res
            # PNG on every change/execution. Content-hash the bytes only when
            # the metadata cannot be read (the loader will then raise anyway).
            try:
                stat = _input_path(image).stat()
                digest.update(f"{stat.st_size}:{stat.st_mtime_ns}".encode("utf-8"))
            except (ValueError, OSError):
                return float("nan")
        return digest.hexdigest()

    def load(self, image="", mask_data="", source_data="", edit_mode="mask", crop_state="{}", blend_data="", layer_image="", result=None):
        raster = _data_image(source_data) if source_data else _read_raster(_input_path(image))
        rgba = raster.convert("RGBA")
        pixels = torch.from_numpy(np.asarray(rgba.convert("RGB"), dtype=np.float32).copy() / 255.0)[None]
        if mask_data:
            mask_image = _data_image(mask_data).convert("L")
            if mask_image.size != rgba.size:
                mask_image = mask_image.resize(rgba.size, Image.Resampling.BILINEAR)
            mask = np.asarray(mask_image, dtype=np.float32).copy() / 255.0
        else:
            mask = 1.0 - np.asarray(rgba.getchannel("A"), dtype=np.float32).copy() / 255.0
        mask = torch.from_numpy(mask)[None]
        if edit_mode == "crop":
            state = _crop_state(crop_state)
            if state.get("locked"):
                x, y, width, height = _crop_box(state, pixels.shape[2], pixels.shape[1])
                composite = _blend_layer(pixels, _load_layer(layer_image), blend_data, state)
                return composite[:, y:y+height, x:x+width].clone(), mask[:, y:y+height, x:x+width].clone(), composite
        return pixels, mask, pixels


class AdachiInpaintPrepare:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": _prepare_inputs(), "optional": {
            "soft_edge": ("BOOLEAN", {"default": False, "tooltip": "Extra feathering, not AUTOMATIC1111's Soft Inpainting algorithm."}),
            "soft_strength": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05, "tooltip": "Adds 0–16 pixels of Gaussian feathering."}),
        }}

    RETURN_TYPES = ("IMAGE", "MASK", "ADACHI_INPAINT_CONTEXT")
    RETURN_NAMES = ("pixels", "mask", "context")
    FUNCTION = "prepare"
    CATEGORY = CATEGORY
    DESCRIPTION = "Crop and prepare masks with exact compositing context; use the all-in-one sampler for latent fill modes."
    SEARCH_ALIASES = ["inpaint crop", "局部重绘预处理", "webui", "adachi"]

    def prepare(self, image, mask, **kwargs):
        return _prepare(image, mask, **kwargs)


class AdachiInpaintComposite:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "generated": ("IMAGE", {"tooltip": "Generated sampling canvas."}),
            "context": ("ADACHI_INPAINT_CONTEXT", {"tooltip": "Context from Adachi Inpaint Prepare."}),
        }}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "composite"
    CATEGORY = CATEGORY
    DESCRIPTION = "Restore original size and preserve pixels outside the effective mask exactly."
    SEARCH_ALIASES = ["inpaint paste", "局部重绘回贴", "adachi"]

    def composite(self, generated, context):
        return (_composite(generated, context),)


def _vae_ratio(vae):
    method = getattr(vae, "spacial_compression_encode", None)
    if callable(method):
        ratio = method()
        if isinstance(ratio, (int, float)) and ratio >= 1:
            return int(ratio)
    ratio = getattr(vae, "downscale_ratio", 8)
    return int(ratio) if isinstance(ratio, (int, float)) and ratio >= 1 else 8


def _check_image_latents(samples, batch):
    if not isinstance(samples, torch.Tensor) or samples.ndim not in (4, 5) or min(samples.shape) < 1:
        raise ValueError("Image VAE must return [B,C,H,W] or [B,C,1,H,W] latents.")
    if samples.shape[0] != batch:
        raise ValueError("VAE latent batch must match the number of independent input images.")
    if samples.ndim == 5 and samples.shape[2] != 1:
        raise ValueError("Still-image inpainting requires one latent frame per image (T=1); multi-frame video is not supported.")
    return samples


def _encode_still_images(vae, pixels):
    # Video-derived VAEs can interpret a 4D IMAGE batch as consecutive frames.
    # Encode those VAEs one image at a time so sources/variants remain independent.
    if getattr(vae, "latent_dim", None) == 3 and pixels.shape[0] > 1:
        samples = torch.cat([_check_image_latents(vae.encode(frame[None]), 1) for frame in pixels], dim=0)
    else:
        samples = vae.encode(pixels)
        # Also support third-party VAE wrappers without a latent_dim attribute.
        if isinstance(samples, torch.Tensor) and samples.ndim == 5 and pixels.shape[0] > 1:
            if samples.shape[0] != pixels.shape[0] or samples.shape[2] != 1:
                samples = torch.cat([_check_image_latents(vae.encode(frame[None]), 1) for frame in pixels], dim=0)
    return _check_image_latents(samples, pixels.shape[0])


class _StillImageVAE:
    """Keep native inpaint conditioning while making its VAE encodes batch-safe."""

    def __init__(self, vae):
        self.vae = vae

    def __getattr__(self, name):
        return getattr(self.vae, name)

    def encode(self, pixels):
        return _encode_still_images(self.vae, pixels)


def _decode_still_images(vae, samples, batch):
    _check_image_latents(samples, batch)
    decoded = vae.decode(samples)
    if isinstance(decoded, tuple):
        decoded = decoded[0]
    if isinstance(decoded, torch.Tensor) and decoded.ndim == 5:
        if decoded.shape[1] != 1:
            raise ValueError("VAE decoded multiple frames for a still image; expected [B,1,H,W,C].")
        decoded = decoded[:, 0]
    decoded = _image_tensor(decoded)
    if decoded.shape[0] != batch:
        raise ValueError("VAE decoded image batch does not match the input image batch.")
    return decoded


def _check_refiner(model, refiner):
    """Reject known incompatible latent formats while allowing SDXL base/refiner."""
    first = getattr(getattr(model, "model", None), "latent_format", None)
    second = getattr(getattr(refiner, "model", None), "latent_format", None)
    if first is None or second is None:
        return
    for field in ("latent_channels", "latent_dimensions", "scale_factor", "shift_factor"):
        left, right = getattr(first, field, None), getattr(second, field, None)
        if left is not None and right is not None and left != right:
            raise ValueError(f"Base/refiner latent formats are incompatible ({field}: {left} vs {right}). Use matching model families and the base VAE.")


def _check_refiner_schedule(model, refiner, steps, denoise, sampler_name, scheduler):
    """A step index is transferable only when both models produce equal sigmas."""
    if not all(callable(getattr(candidate, "get_model_object", None)) for candidate in (model, refiner)):
        return
    import comfy.samplers

    schedules = [comfy.samplers.KSampler(candidate, steps=int(steps), device="cpu", sampler=sampler_name,
                                       scheduler=scheduler, denoise=float(denoise)).sigmas
                 for candidate in (model, refiner)]
    first, second = (schedule.detach().cpu().float() for schedule in schedules)
    if first.shape != second.shape or not torch.allclose(first, second, rtol=1e-5, atol=1e-6):
        raise ValueError("Base/refiner noise schedules are incompatible. Use a compatible refiner with matching model-sampling settings; different sigma schedules cannot share a sampling step boundary.")


class AdachiWebUIInpaint:
    @classmethod
    def INPUT_TYPES(cls):
        import comfy.samplers

        required = {
            "model": ("MODEL",), "positive": ("CONDITIONING",), "negative": ("CONDITIONING",), "vae": ("VAE",),
            **_prepare_inputs(),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True, "tooltip": "Seed for a reproducible batch of distinct samples."}),
            "steps": ("INT", {"default": 20, "min": 1, "max": 10000}),
            "cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 100.0, "step": 0.1}),
            "sampler_name": (comfy.samplers.KSampler.SAMPLERS,),
            "scheduler": (comfy.samplers.KSampler.SCHEDULERS,),
            "denoise": ("FLOAT", {"default": 0.75, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "Zero returns the original exactly; one fully denoises."}),
            "batch_size": ("INT", {"default": 1, "min": 1, "max": 16, "tooltip": "Number of generated variants per input image."}),
            "refiner_switch": ("FLOAT", {"default": 0.8, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "Fraction of steps on the base model when a refiner is connected."}),
        }
        return {"required": required, "optional": {
            "inpaint_model": ("BOOLEAN", {"default": False, "tooltip": "Enable only for dedicated inpainting models; uses ComfyUI's native InpaintModelConditioning."}),
            "soft_edge": ("BOOLEAN", {"default": False, "tooltip": "Extra feathering, not A1111 Soft Inpainting."}),
            "soft_strength": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05}),
            "refiner_model": ("MODEL", {"tooltip": "Optional compatible refiner model, e.g. SDXL refiner."}),
            "refiner_positive": ("CONDITIONING", {"tooltip": "Encode using the refiner CLIP; defaults to original positive conditioning."}),
            "refiner_negative": ("CONDITIONING", {"tooltip": "Encode using the refiner CLIP; defaults to original negative conditioning."}),
        }}

    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK")
    RETURN_NAMES = ("image", "crop", "mask")
    FUNCTION = "sample"
    CATEGORY = CATEGORY
    DESCRIPTION = "WebUI-style inpainting, crop, latent fill, sampling and original-size compositing."
    SEARCH_ALIASES = ["webui", "img2img", "inpaint", "局部重绘", "安达", "adachi"]

    def sample(self, model, positive, negative, vae, image, mask, seed=0, steps=20, cfg=7.0,
               sampler_name="euler", scheduler="normal", denoise=0.75, batch_size=1, inpaint_model=False,
               refiner_switch=0.8, refiner_model=None, refiner_positive=None, refiner_negative=None,
               **kwargs):
        import nodes

        if not (0 <= float(denoise) <= 1 and 1 <= int(batch_size) <= 16 and 0 <= float(refiner_switch) <= 1):
            raise ValueError("Denoise/refiner switch must be in [0, 1] and batch size in [1, 16].")
        original_positive, original_negative = positive, negative
        pixels, masks, context = _prepare(image, mask, **kwargs)
        batch_size = int(batch_size)
        pixels = pixels.repeat_interleave(batch_size, dim=0)
        masks = masks.repeat_interleave(batch_size, dim=0)
        if denoise == 0 or context["empty"]:
            return context["original"].repeat_interleave(batch_size, dim=0), pixels, masks
        ratio = _vae_ratio(vae)
        target_height = math.ceil(pixels.shape[1] / ratio) * ratio
        target_width = math.ceil(pixels.shape[2] / ratio) * ratio
        if pixels.shape[1:3] != (target_height, target_width):
            pixels = _resize_image(pixels, target_height, target_width)
            masks = _resize_mask(masks, target_height, target_width)
        if inpaint_model:
            positive, negative, latent = nodes.InpaintModelConditioning().encode(
                positive=positive, negative=negative, pixels=pixels, vae=_StillImageVAE(vae), mask=masks, noise_mask=True)
        else:
            latent = {"samples": _encode_still_images(vae, pixels)}
        samples = _check_image_latents(latent["samples"], pixels.shape[0])
        latent_mask = _resize_mask(masks.to(device=samples.device, dtype=samples.dtype), samples.shape[-2], samples.shape[-1])[:, None]
        if samples.ndim == 5:
            latent_mask = latent_mask.unsqueeze(2)
            if inpaint_model:
                # Native conditioning provides a pixel-space [B,1,H,W] mask;
                # retain the independent batch axis for volumetric model inputs.
                def volumetric_conditioning(conditioning):
                    result = []
                    for embedding, metadata in conditioning:
                        metadata = metadata.copy()
                        concat_mask = metadata.get("concat_mask")
                        if isinstance(concat_mask, torch.Tensor) and concat_mask.ndim == 4:
                            metadata["concat_mask"] = concat_mask.unsqueeze(2)
                        result.append([embedding, metadata])
                    return result
                positive, negative = volumetric_conditioning(positive), volumetric_conditioning(negative)
        latent["noise_mask"] = latent_mask
        fill = kwargs.get("fill", "original")
        if fill in {"latent_noise", "latent_nothing"}:
            if fill == "latent_noise":
                generator = torch.Generator(device="cpu").manual_seed(int(seed))
                replacement = torch.randn(samples.shape, generator=generator, device="cpu", dtype=torch.float32).to(device=samples.device, dtype=samples.dtype)
            else:
                replacement = torch.zeros_like(samples)
            latent["samples"] = samples * (1 - latent_mask) + replacement * latent_mask
        use_refiner = refiner_model is not None and float(refiner_switch) < 1.0
        if use_refiner:
            _check_refiner(model, refiner_model)
            _check_refiner_schedule(model, refiner_model, steps, denoise, sampler_name, scheduler)
            switch = min(int(steps) - 1, max(0, int(int(steps) * float(refiner_switch))))
            refined_positive = original_positive if refiner_positive is None else refiner_positive
            refined_negative = original_negative if refiner_negative is None else refiner_negative
            intermediate = latent
            if switch > 0:
                intermediate = nodes.common_ksampler(model, int(seed), int(steps), float(cfg), sampler_name, scheduler,
                                                    positive, negative, latent, denoise=float(denoise),
                                                    last_step=switch, force_full_denoise=False)[0]
            sampled = nodes.common_ksampler(refiner_model, int(seed), int(steps), float(cfg), sampler_name, scheduler,
                                           refined_positive, refined_negative, intermediate, denoise=float(denoise),
                                           start_step=switch, disable_noise=(switch > 0), force_full_denoise=True)[0]
        else:
            sampled = nodes.common_ksampler(model, int(seed), int(steps), float(cfg), sampler_name, scheduler,
                                           positive, negative, latent, denoise=float(denoise))[0]
        decoded = _decode_still_images(vae, sampled["samples"], pixels.shape[0])
        return _composite(decoded, context), decoded, masks


class AdachiImageCompare:
    """Hover comparison previews; the selected result may be adopted in the UI."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "original": ("IMAGE", {"tooltip": "Original image shown on the right."}),
            "result": ("IMAGE", {"tooltip": "Full-size generated image shown on the left; use image, not crop."}),
        }, "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID", "dynprompt": "DYNPROMPT"}}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "compare"
    OUTPUT_NODE = True
    CATEGORY = CATEGORY
    DESCRIPTION = "Hover to compare; adopt a result into the upstream inline editor."
    SEARCH_ALIASES = ["compare", "before after", "图像对比", "adachi", "安达工作台"]

    @classmethod
    def IS_CHANGED(cls, original, result, **kwargs):
        # All evictions invalidate old cached UI descriptors; the store also
        # identifies its process so a restarted server cannot replay stale URLs.
        return PREVIEWS.fingerprint()

    def compare(self, original, result, prompt=None, unique_id=None, dynprompt=None):
        original, result = _image_tensor(original), _image_tensor(result)
        if original.shape[1:3] != result.shape[1:3]:
            raise ValueError("Image sizes must match. Connect the final image output, not crop.")
        if result.shape[0] % original.shape[0]:
            raise ValueError("Result batch must be a multiple of the original batch.")
        if original.shape[1] * original.shape[2] > MAX_IMAGE_PIXELS or max(original.shape[1:3]) > 16384:
            raise ValueError("Comparison images exceed the inline editor's 32 megapixel / 16384px limit.")
        images, encoded_size = [], 0
        for batch in (original, result):
            for pixels in batch:
                rgb = np.clip(255.0 * pixels.cpu().numpy(), 0, 255).astype(np.uint8)
                stream = io.BytesIO()
                Image.fromarray(rgb).save(stream, format="PNG", compress_level=1)
                data = stream.getvalue()
                encoded_size += len(data)
                if encoded_size > PREVIEWS.limit:
                    raise ValueError("The comparison batch exceeds the in-memory preview limit. Reduce batch size or increase ADACHI_COMPARE_MEMORY_MIB (64–4096 MiB).")
                images.append(data)
        refs = PREVIEWS.put_batch(images, unique_id)
        before, after = refs[:original.shape[0]], refs[original.shape[0]:]
        origin = _comparison_origin(prompt, unique_id, dynprompt)
        return {"ui": {"adachi_originals": before, "adachi_results": after, "adachi_origin": [origin] if origin else []}, "result": (result,)}


_MISSING_INPUT = object()


def _workflow_exclusive_flags(extra_pnginfo, unique_id):
    """Recover routing states from the editable graph, before virtual links vanish."""
    workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
    if not isinstance(workflow, dict) or unique_id is None:
        return None
    definitions = {str(g.get("id")): g for g in workflow.get("definitions", {}).get("subgraphs", [])}
    graph = workflow
    parts = str(unique_id).split(":")
    for parent_id in parts[:-1]:
        parent = next((n for n in graph.get("nodes", []) if str(n.get("id")) == parent_id), None)
        graph = definitions.get(str(parent.get("type"))) if parent else None
        if graph is None:
            return None
    nodes = {str(n.get("id")): n for n in graph.get("nodes", [])}
    selector = nodes.get(parts[-1])
    if not selector or selector.get("type") != "AdachiExclusiveSwitch":
        return None
    links = {}
    for link in graph.get("links", []):
        if isinstance(link, dict):
            links[str(link["id"])] = (str(link["origin_id"]), link.get("origin_slot", 0))
        else:
            links[str(link[0])] = (str(link[1]), link[2])

    def visit(node_id, slot, seen):
        if node_id in seen:
            return False
        node = nodes.get(node_id)
        if node is None:
            return None  # e.g. a subgraph's external input placeholder
        if node.get("mode", 0) in (2, 4):
            return False
        seen = seen | {node_id}
        kind = node.get("type")
        if kind == "GetNode":
            values = node.get("widgets_values", [])
            name = values[0] if isinstance(values, list) and values else None
            setter = next((n for n in nodes.values() if n.get("type") == "SetNode"
                           and isinstance(n.get("widgets_values"), list)
                           and n["widgets_values"] and n["widgets_values"][0] == name), None) if name else None
            return visit(str(setter["id"]), slot, seen) if setter else False
        if kind in ("SetNode", "Reroute"):
            inputs = node.get("inputs", [])
            if not inputs:
                return False
            source = inputs[slot] if isinstance(slot, int) and 0 <= slot < len(inputs) else inputs[0]
            link = links.get(str(source.get("link")))
            return visit(*link, seen) if link else False
        return True

    flags = 0
    for name, bit in (("input_a", 1), ("input_b", 2)):
        source = next((i for i in selector.get("inputs", []) if i.get("name") == name), {})
        link = links.get(str(source.get("link")))
        enabled = visit(*link, set()) if link else False
        if enabled is None:
            return None
        if enabled:
            flags |= bit
    return flags


def _workflow_exclusive_sources(extra_pnginfo, unique_id, prompt):
    """Resolve saved graph outputs to existing flattened execution nodes only."""
    workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
    if not isinstance(workflow, dict):
        return {}
    definitions = {str(g.get("id")): g for g in workflow.get("definitions", {}).get("subgraphs", [])}

    def index(graph):
        nodes = {str(n.get("id")): n for n in graph.get("nodes", [])}
        links = {}
        for link in graph.get("links", []):
            if isinstance(link, dict):
                links[str(link["id"])] = (str(link["origin_id"]), link.get("origin_slot", 0))
            else:
                links[str(link[0])] = (str(link[1]), link[2])
        return nodes, links

    graph, path = workflow, []
    parts = str(unique_id).split(":")
    for parent_id in parts[:-1]:
        nodes, _ = index(graph)
        parent = nodes.get(parent_id)
        graph = definitions.get(str(parent.get("type"))) if parent else None
        if graph is None:
            return {}
        path.append(parent_id)
    nodes, links = index(graph)
    selector = nodes.get(parts[-1])
    if not selector or selector.get("type") != "AdachiExclusiveSwitch":
        return {}

    def resolve(current, node_id, slot, prefix, seen):
        key = (id(current), node_id, slot)
        if key in seen or len(seen) > 64:
            return None
        seen = seen | {key}
        current_nodes, current_links = index(current)
        node = current_nodes.get(node_id)
        if not node or node.get("mode", 0) in (2, 4):
            return None
        kind = node.get("type")
        if kind == "GetNode":
            values = node.get("widgets_values", [])
            name = values[0] if isinstance(values, list) and values else None
            setter = next((n for n in current_nodes.values() if n.get("type") == "SetNode"
                           and isinstance(n.get("widgets_values"), list)
                           and n["widgets_values"] and n["widgets_values"][0] == name), None) if name else None
            return resolve(current, str(setter["id"]), slot, prefix, seen) if setter else None
        if kind in ("SetNode", "Reroute"):
            inputs = node.get("inputs", [])
            source = inputs[slot] if isinstance(slot, int) and 0 <= slot < len(inputs) else inputs[0] if inputs else {}
            link = current_links.get(str(source.get("link")))
            return resolve(current, *link, prefix, seen) if link else None
        if kind in definitions:
            child = definitions[kind]
            outputs = child.get("outputs", [])
            if not isinstance(slot, int) or not 0 <= slot < len(outputs):
                return None
            _, child_links = index(child)
            output_links = [child_links[str(i)] for i in outputs[slot].get("linkIds", []) if str(i) in child_links]
            if len(output_links) != 1:
                return None
            return resolve(child, *output_links[0], prefix + [node_id], seen)
        execution_id = ":".join(prefix + [node_id])
        execution_node = prompt.get(execution_id)
        if isinstance(execution_node, dict) and execution_node.get("class_type") == kind:
            return [execution_id, slot]
        return None

    result = {}
    for source in selector.get("inputs", []):
        name = source.get("name")
        link = links.get(str(source.get("link")))
        if name in ("input_a", "input_b") and link:
            resolved = resolve(graph, *link, path, set())
            if resolved is not None:
                result[name] = resolved
    return result


def normalize_exclusive_prompt(data):
    """Resolve flags before validation/cache keys, without changing workflow wires."""
    prompt = data.get("prompt", {})
    extra = data.get("extra_data", {}).get("extra_pnginfo")
    if not isinstance(prompt, dict):
        return data
    for node_id, node in prompt.items():
        if not isinstance(node, dict) or node.get("class_type") != "AdachiExclusiveSwitch":
            continue
        flags = _workflow_exclusive_flags(extra, node_id)
        if flags is None:
            continue
        inputs = node.setdefault("inputs", {})
        inputs["active_inputs"] = flags
        sources = _workflow_exclusive_sources(extra, node_id, prompt) if flags in (1, 2) else {}
        for name, bit in (("input_a", 1), ("input_b", 2)):
            if not flags & bit:
                inputs.pop(name, None)
            elif name not in inputs and name in sources:
                inputs[name] = sources[name]
    return normalize_crop_prompt(data)


class AdachiExclusiveSwitch:
    """Forward exactly one enabled branch, without evaluating the ignored branch."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "input_a": ("*", {"lazy": True, "tooltip": "First branch; bypass either this branch or input_b."}),
                "input_b": ("*", {"lazy": True, "tooltip": "Second branch; exactly one branch must remain enabled."}),
                # The frontend computes this from the graph on every serialization.
                # Keeping it in the prompt also makes branch changes invalidate caches,
                # including bypassed transform nodes whose links otherwise pass through.
                "active_inputs": ("INT", {"default": -1, "min": -1, "max": 3}),
            },
            "hidden": {"prompt": "PROMPT", "dynprompt": "DYNPROMPT", "unique_id": "UNIQUE_ID", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("output",)
    FUNCTION = "select"
    CATEGORY = CATEGORY
    DESCRIPTION = "Automatically forwards the only enabled input. Bypass one branch; both enabled or both absent is an error."
    SEARCH_ALIASES = ["exclusive switch", "auto switch", "自动二选一", "互斥", "自动切换", "adachi"]

    @staticmethod
    def _selected_input(input_a, input_b, active_inputs, prompt=None, dynprompt=None, unique_id=None, extra_pnginfo=None):
        frontend_flags, submitted_flags = active_inputs, None
        workflow_flags = _workflow_exclusive_flags(extra_pnginfo, unique_id)
        if workflow_flags is not None:
            active_inputs = workflow_flags
        execution_node = None
        if dynprompt is not None and unique_id is not None:
            try:
                execution_node = dynprompt.get_node(unique_id)
            except KeyError:
                pass
        if execution_node is None and isinstance(prompt, dict) and unique_id is not None:
            execution_node = prompt.get(str(unique_id), prompt.get(unique_id))
        if isinstance(execution_node, dict) and isinstance(execution_node.get("inputs"), dict):
            # Get/Set and mute/bypass resolution may remove a connection after
            # widgets serialize. Trust the actual submitted connections when
            # only one (or none) survives, regardless of stale frontend flags.
            connected = execution_node["inputs"]
            actual = int("input_a" in connected) | (int("input_b" in connected) << 1)
            submitted_flags = actual
            if actual != 3:
                active_inputs = actual if workflow_flags is None else actual & workflow_flags
        if active_inputs == -1:
            # Raw API prompts need no frontend state: simply omit the unused input.
            active_inputs = int(input_a is not _MISSING_INPUT) | (int(input_b is not _MISSING_INPUT) << 1)
        if active_inputs not in (1, 2):
            raise ValueError(
                "Auto Exclusive Switch requires exactly one enabled input. "
                "Bypass one branch or disconnect it; both enabled / both absent are invalid. "
                f"Received enabled-state={active_inputs}. "
                f"node={unique_id}, frontend={frontend_flags}, workflow={workflow_flags}, submitted={submitted_flags}."
            )
        name = "input_a" if active_inputs == 1 else "input_b"
        if (input_a if active_inputs == 1 else input_b) is _MISSING_INPUT:
            raise ValueError(f"The enabled branch {name} has no input.")
        return name

    def check_lazy_status(self, input_a=_MISSING_INPUT, input_b=_MISSING_INPUT, active_inputs=-1, prompt=None, dynprompt=None, unique_id=None, extra_pnginfo=None):
        return [self._selected_input(input_a, input_b, active_inputs, prompt, dynprompt, unique_id, extra_pnginfo)]

    def select(self, input_a=_MISSING_INPUT, input_b=_MISSING_INPUT, active_inputs=-1, prompt=None, dynprompt=None, unique_id=None, extra_pnginfo=None):
        selected = self._selected_input(input_a, input_b, active_inputs, prompt, dynprompt, unique_id, extra_pnginfo)
        value = input_a if selected == "input_a" else input_b
        if value is None:
            raise ValueError(f"The enabled branch {selected} returned no data.")
        return (value,)


def _crop_state(value):
    try:
        state = json.loads(value or "{}")
    except (ValueError, TypeError) as exc:
        raise ValueError("Invalid crop selection data.") from exc
    if not isinstance(state, dict):
        raise ValueError("Invalid crop selection data.")
    return state


def _crop_box(state, image_width, image_height):
    values = [state.get(k) for k in ("x", "y", "width", "height")]
    if any(type(v) is not int for v in values):
        raise ValueError("Crop coordinates and dimensions must be integers.")
    x, y, width, height = values
    if min(width, height) < 32 or width % 32 or height % 32:
        raise ValueError("Crop width and height must be positive multiples of 32.")
    if x < 0 or y < 0 or x + width > image_width or y + height > image_height:
        raise ValueError("The crop must fit entirely inside the source image.")
    return x, y, width, height


def _load_layer(filename):
    if not filename:
        return None
    raster = _read_raster(_input_path(filename)).convert("RGB")
    return torch.from_numpy(np.asarray(raster, dtype=np.float32).copy() / 255)[None]


def _blend_layer(original, generated, blend_data, state):
    if generated is None:
        return original
    x, y, width, height = _crop_box(state, original.shape[2], original.shape[1])
    generated = _image_tensor(generated).to(device=original.device, dtype=original.dtype)
    if generated.shape[1:3] != (height, width):
        raise ValueError(f"Inpaint result must match the selected crop ({width} x {height}); connect the inpaint node's image output.")
    alpha = torch.ones((1, height, width, 1), device=original.device, dtype=original.dtype)
    if blend_data:
        raster = _data_image(blend_data).convert("L")
        if raster.size != (width, height):
            raise ValueError("The layer mask dimensions must match the crop.")
        alpha = torch.from_numpy(np.asarray(raster, dtype=np.float32).copy() / 255)[None, ..., None].to(original)
    composite = original.expand(generated.shape[0], -1, -1, -1).clone()
    old = composite[:, y:y+height, x:x+width]
    composite[:, y:y+height, x:x+width] = old * (1-alpha) + generated * alpha
    return composite


def _store_layer(image):
    import folder_paths
    pixels = (image.detach().cpu().clamp(0, 1).numpy()*255).round().astype(np.uint8)
    name = f"layer-{hashlib.sha256(str(pixels.shape).encode() + pixels.tobytes()).hexdigest()}.png"
    folder = Path(folder_paths.get_input_directory()) / "adachi-inpaint-layers"
    folder.mkdir(parents=True, exist_ok=True)
    if not (folder / name).exists():
        # Readers never see an incomplete PNG when concurrent prompts reuse a layer.
        with tempfile.NamedTemporaryFile(dir=folder, suffix=".png", delete=False) as stream:
            temporary = Path(stream.name)
        try:
            Image.fromarray(pixels).save(temporary)
            temporary.replace(folder / name)
        finally:
            temporary.unlink(missing_ok=True)
    return {"filename": name, "subfolder": "adachi-inpaint-layers", "type": "input"}


class AdachiLayerCommit:
    """Execution-only sink; keeps the visible feedback loop acyclic at runtime."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "result": ("IMAGE",), "image": ("STRING", {"default": ""}),
            "source_data": ("STRING", {"default": ""}), "crop_state": ("STRING", {"default": "{}"}),
            "blend_data": ("STRING", {"default": ""}), "target": ("STRING", {"default": ""}),
        }}
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "compose"
    OUTPUT_NODE = True
    CATEGORY = "_Adachi/internal"
    DESCRIPTION = "Internal layer sink. Use Inline Mask in Crop & Blend mode."

    def compose(self, result, image="", source_data="", crop_state="{}", blend_data="", target=""):
        raster = (_data_image(source_data) if source_data else _read_raster(_input_path(image))).convert("RGB")
        original = torch.from_numpy(np.asarray(raster, dtype=np.float32).copy()/255)[None]
        state = _crop_state(crop_state)
        generated = _image_tensor(result).cpu()
        composite = _blend_layer(original, generated, blend_data, state)
        layer = _store_layer(generated[-1])
        return {"ui": {"adachi_layer": [{"target": target, "job": state.get("job", ""), "image": layer}]}, "result": (composite,)}


def normalize_crop_prompt(data):
    """Ignore obsolete feedback links; adoption now happens only in Image Compare."""
    prompt = data.get("prompt", {})
    if isinstance(prompt, dict):
        for node in prompt.values():
            if isinstance(node, dict) and node.get("class_type") == "AdachiInlineMask":
                node.setdefault("inputs", {}).pop("result", None)
    return data


def _comparison_origin(prompt, unique_id, dynprompt=None):
    """Tag previews with their generating crop, so later adoption cannot hit another region."""
    def get_node(node_id):
        if dynprompt is not None:
            try:
                return dynprompt.get_node(str(node_id))
            except KeyError:
                pass
        return prompt.get(str(node_id), prompt.get(node_id)) if isinstance(prompt, dict) else None
    node = get_node(unique_id)
    link = node.get("inputs", {}).get("original") if isinstance(node, dict) else None
    queue = [str(link[0])] if isinstance(link, list) and len(link) == 2 else []
    seen, sources = set(), {}
    while queue and len(seen) < 256:
        node_id = queue.pop()
        if node_id in seen:
            continue
        seen.add(node_id)
        current = get_node(node_id)
        if not isinstance(current, dict):
            continue
        inputs = current.get("inputs", {})
        if current.get("class_type") == "AdachiInlineMask":
            mode = inputs.get("edit_mode", "mask")
            state = _crop_state(inputs.get("crop_state", "{}")) if mode == "crop" else {}
            sources[node_id] = {"source": node_id, "mode": mode, "job": state.get("job", "")}
            continue
        for value in inputs.values():
            if isinstance(value, list) and len(value) == 2 and type(value[1]) is int:
                queue.append(str(value[0]))
    return next(iter(sources.values())) if len(sources) == 1 else None


NODE_CLASS_MAPPINGS = {
    "AdachiInlineMask": AdachiInlineMask,
    "AdachiInpaintPrepare": AdachiInpaintPrepare,
    "AdachiInpaintComposite": AdachiInpaintComposite,
    "AdachiWebUIInpaint": AdachiWebUIInpaint,
    "AdachiImageCompare": AdachiImageCompare,
    "AdachiExclusiveSwitch": AdachiExclusiveSwitch,
    "AdachiLayerCommit": AdachiLayerCommit,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AdachiInlineMask": "Inline Mask",
    "AdachiInpaintPrepare": "Inpaint Prepare",
    "AdachiInpaintComposite": "Inpaint Composite",
    "AdachiWebUIInpaint": "WebUI Inpaint",
    "AdachiImageCompare": "Image Compare",
    "AdachiExclusiveSwitch": "Auto Exclusive Switch",
    "AdachiLayerCommit": "Internal Layer Commit",
}
