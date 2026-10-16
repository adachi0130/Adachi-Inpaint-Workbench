# Changelog

## 0.5.4

- Prevent the inline Fit button click from bubbling into ComfyUI node selection / bring-to-front handlers, which can remeasure a saved node's DOM editor.
- Keep node and editor dimensions unchanged when fitting the image. Fit still resets only image zoom and pan.
- Version the inline editor module and stylesheet URLs to refresh imported assets on upgrades; update an existing shared stylesheet link as well.
- Verify actual clicks on saved workflow node geometry in frontend 1.42.11 and 1.52.7, with classic nodes and Nodes 2.0.

## 0.5.3

- Move the image Fit button from the inpaint painting controls to the inline mask, immediately after Load image.
- Keep viewport reset and mask/history behavior unchanged. Includes the 0.5.2 single-frame 5D VAE compatibility fix.

## 0.5.2

- Support still-image inpainting with both 4D `[B,C,H,W]` and single-frame 5D `[B,C,1,H,W]` VAE latents, including the Wan-derived VAE used by Anima/Qwen-image pipelines.
- Preserve the independent image/variant batch axis when a video-derived VAE would otherwise interpret the batch as frames.
- Match noise/fill masks to latent rank and convert single-frame decoded images back to ordinary IMAGE batches before compositing.
- Keep native inpaint conditioning and its batch/mask metadata compatible with single-frame 5D latents.
- Add regression coverage and verify actual ComfyUI Wan VAE encode/decode and native mask preparation with tiny random test weights; no real Anima checkpoint was available locally.

## 0.5.1

- Add Auto Exclusive Switch: two generic lazy inputs, no manual switch control, and exactly one enabled branch required.
- Respect muted/bypassed input branches, including bypassed transform nodes that normally pass through data; branch changes also invalidate execution caches.
- Widen the group preset list from 32% to 40% of its panel.
- Keep the new nodes English-only as well: backend error messages and the group preset node description no longer carry inline Chinese, and the two new example workflows use English note text and group names. The group preset node keeps no saved title override, so it shows its locale-aware name in any language.

## 0.5.0

- Preserve the painted mask, undo/redo history and viewport when adopting a comparison result as the source; an ordinary image upload still starts a new mask.
- Add Group Bypass Presets: a connection-free controller with a preset list, per-group enabled/bypassed/unmanaged states, and a right-click preset menu.
- Store presets in the workflow with stable group IDs, support renamed and nested groups, and leave newly added/unmanaged groups untouched.
- Add a model-free example workflow for group presets.

## 0.4.2

- Make every user-facing string English by default: node display names, category, descriptions, tooltips and the canvas/panel labels.
- Keep node class IDs, parameter identifiers and enum values unchanged, so existing workflows stay compatible.
- Add `locales/en` and `locales/zh` and follow the ComfyUI language setting, so a Chinese ComfyUI shows Chinese labels while English stays the built-in default. Any missing translation falls back to English.
- Document how this pack differs from ComfyUI's built-in modal mask editor and `Painter` node.

## 0.4.1

- Rename the public node pack to **Adachi-Inpaint-Workbench**; keep existing node class IDs compatible with saved workflows.
- Show an eraser cursor and a distinct dashed brush outline while Alt is held or the eraser tool is selected; restore the brush cursor on release.
- Add Comfy Registry metadata, dependency declarations, a Manager registration entry, CPU CI and a manual Registry publishing workflow.

## 0.4.0

- Move the original live editor controls and sampling controls into the WebUI Inpaint node.
- Keep the inline node focused on the image and a small upload button.
- Move comparison controls below the picture and remove the top toolbar band.

## 0.3.0

- Add WebUI-style sliders, separate width/height rows and a source-size button.
- Use result-left/original-right comparison and show the full result when the pointer leaves.
- Route toolbar wheel events to the workflow and keep image wheel gestures separate.

## 0.2.0

- Add temporary Alt erase, image comparison and result adoption.
