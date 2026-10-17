# Changelog

## 0.8.0

- Restructure adoption in Crop & Blend: after "Adopt this result" the layer is baked into the source at full quality and the editor returns to the repaint mask immediately, so you can generate again right away. The ◐ button now enters layer blending explicitly instead of auto-entering after adoption.
- Remove the ✓ merge step entirely: right-click (or Escape) now releases the selected region and flattens any remaining layer in one action, so there is no intermediate commit button between adopting a result and picking the next region.
- Speed up inline mask change detection: the source image is fingerprinted by size and mtime instead of hashing its full high-resolution bytes on every change/execution.

## 0.7.2

- Adopting a result no longer decodes the full-size image a second time: the already-decoded image is reused for the crop layer, cutting one download/decode round trip.
- Show a visible message when adoption is skipped because the preview is still loading, no target is selected, or the crop/layer state changed, instead of failing silently.
- Bump the asset versions for the crop, comparison and result-adoption modules.

## 0.7.1

- Uploading a new source image now keeps the painted mask, undo/redo history and viewport, the same way adopting a result does; only the source pixels change. A first upload still starts with an empty mask.
- When the new image has a different size the mask cannot be kept, so the image loads fresh and a notice explains that the mask was reset instead of failing the upload.

## 0.7.0

- Add a download button next to the inline upload button: it saves the current source image as a PNG at its own resolution. It stays disabled until an image is loaded.
- Change the pin toggle so it freezes the view exactly as it is drawn instead of re-fitting the image: panning and zooming stay available while pinned, and the pinned view survives canvas resizes.
- Keep routing the plain wheel to the workflow canvas while pinned, as before.

## 0.6.9

- Place the Clear button directly after the swap width/height control in Crop & Blend; in Mask mode it is the only visible button of that bar and stays at the bottom left of the canvas.

## 0.6.8

- Add a Clear button to the bottom-left canvas bar: one click empties the mask of the active target, in both Mask and Crop & Blend modes, and it stays disabled until an image is loaded.
- Move the selected-region painting help onto the repaint mask button, and remove hover text from the painting canvas entirely: hovering the image no longer shows any hint in any mode. The bottom controls and their button tooltips keep the instructions.
- Remove the now-unused canvas and repaint mask hint entries from the locale dictionary.
- Bump the inline crop module's asset version so the updated file is fetched instead of a cached copy.

## 0.6.7

- Before merging an adopted crop layer, hold the right mouse button to preview the original; release, pointer cancellation or window blur restores the workspace. Preview changes display only. After merge, right-click again releases the crop selection.
- Add English/Chinese hover instructions for bottom controls and state-specific canvas gestures, including size/hardness shortcuts, masks, adoption, merging and Undo.

## 0.6.6

- Right-click releases a locked crop without painting; the next plain click selects a new region. Adopted layer effects are merged before reselection. Right-click no longer paints or erases in either mode; Alt remains the temporary eraser.
- Remove the redundant reselect button. Move the existing mask Undo button from the inpaint controls to the inline toolbar, immediately after Merge, using a return-arrow icon. Undo also remains accessible in ordinary mask mode.

## 0.6.5

- Keep crop size presets, width/height swap and custom dimensions available after locking a region. Changing dimensions automatically unlocks it for a new selection.
- Merge an adopted layer before changing the region, and retain the old selection if merging fails.

## 0.6.4

- Use a pure black dashed crop outline and automatically synchronize connected inpaint resolution when locking a crop. Linked resolution inputs remain under their upstream node's control.
- Remove the Inline Mask result socket and obsolete feedback connections. Both modes now receive results exclusively through Image Compare adoption.
- Crop adoption keeps the full source, crop location and repaint mask; the accepted patch remains a separate editable blend layer. Generation alone does not update it. Tag comparison previews with their originating crop to reject stale adoption.

## 0.6.3

- Check oversized embedded sources before workflow configuration, so the first autosave cannot disable browser draft storage before the mode-change guard runs. Upload exact source bytes before changing the file reference, including sources in subgraph definitions.
- Keep the array and optional named widget snapshots synchronized when serializing Inline Mask; stale embedded copies no longer survive in the named snapshot. Keep repaint masks, fusion masks and layer references unchanged.
- Apply the source-capacity check after uploading/replacing an embedded image too. Respect disabled browser persistence and retain embedded data if upload fails.
- A page that already encountered the native draft quota error needs one reload to reset ComfyUI's disabled-storage flag: save the workflow with Ctrl+S first, then use Ctrl+F5. No browser drafts are cleared by the plugin.

## 0.6.2

- Remove magic wand and quick selection, including their toolbar menu and background workers.
- Locking a crop dims the outside and starts an empty repaint mask, ready for manual painting. Brush, shape and mask actions stay inside the locked crop.
- Reduce presets to six sizes with 64-aligned dimensions from 512 through 2048; retain the width/height swap button. Custom sizing steps by 64 pixels.

## 0.6.1

- Add a collapsed painting-tools/mask-settings section in WebUI Inpaint and Inpaint Prepare. Keep the complete Undo/Redo/Invert/Fill/Clear/Import/Export row visible, and save the fold state in the workflow.
- Reproduce browser draft quota failures with a large embedded source. Before a mode change or enabling embedding, probe available draft capacity using a temporary plugin-owned key; credit the existing current draft and preserve all other browser storage.
- If the embedded source does not fit, upload an exact PNG copy first, then use the input-file reference without reloading pixels or clearing repaint masks, fusion masks, layers or undo commands. A failed upload retains the original embedded data and mode. Small embeddings remain embedded.
- Share in-flight recovery across embedding/mode changes, respect disabled ComfyUI browser persistence, and keep the recovery notice above the crop toolbar.

## 0.6.0

- Merge rectangular cropping and two-layer blending into Inline Mask, with a compact mode selector; ordinary mask mode ignores the result input.
- Add 32-aligned crop presets, pointer-following selection, fixed-region repeat generation, exact full-image stitching and a third full_image output. Feedback wiring is split into an acyclic execution graph before validation.
- Replace the proposed crop version history with original/result layers and a separate editable fusion mask. Brush reveals the new layer; Alt erases back to the original. Reselecting merges visible layers first.
- Add a compact selection-tool menu: contiguous magic wand (W), brush-guided color quick selection (Q), tolerance and selection brush size. Alt subtracts, and both tools support undo/redo in either mode. Selection calculations run in a Web Worker.
- Use arrow/fit/pin icons, Ctrl+wheel for size and Shift+wheel for hardness. Use source size follows the locked crop in crop mode.
- Retain existing image/mask output indices, old workflows, comparison adoption and mask preservation. Restart ComfyUI and hard-refresh after updating.

## 0.5.13

- Restore a missing enabled execution input by resolving its saved workflow route through Get/Set, reroutes and subgraph output slots to an existing flattened execution node.
- Fix the captured remote failure where the selected positive branch existed in a tag subgraph but its input link was absent from the submitted exclusive node. Never invent missing backend nodes or connect a different node type.
- Include node ID, frontend/workflow flags and submitted-connection flags in selection errors to distinguish an ignored branch from lost execution wiring.
- Validate three actual failed remote request snapshots locally and two lightweight CPU queue probes with the same missing-link/subgraph mapping. Restart ComfyUI after this backend update.

## 0.5.12

- Trace enabled Get nodes back through their named Set and encoder in saved workflow metadata; ignored Sets disable their branch even when both Gets remain enabled and both execution links survive.
- Normalize exclusive branch flags and remove only ignored execution inputs before ComfyUI validation/cache lookup. Keep all original workflow wires and normal cache reuse.
- Repeat the workflow check during lazy selection, support scoped subgraph IDs and both serialized link formats, and retain raw-API behavior without workflow metadata.
- Validate the supplied remote workflow's routing states using lightweight real image queues, including reverse switching, cache reuse and strict invalid states. A full ComfyUI restart is required after updating.

## 0.5.11

- Resolve exclusive selection against the actual submitted prompt connections, overriding stale frontend flags when only one branch survives Get/Set, mute or bypass resolution.
- Support dynamically expanded subgraph node IDs through ComfyUI's dynamic prompt, while retaining explicit branch flags for bypassed transforms that keep both physical connections.
- Keep both-enabled/both-absent errors and include the received branch state in their diagnostic message. Restart ComfyUI after updating this backend change.

## 0.5.10

- Add a pin toggle beside Fit in Inline Mask: keep the image fitted, route plain wheel to the workflow, retain Ctrl+wheel brush sizing and save the toggle with the workflow.
- Shorten the inline load button to Upload (上传).
- Bound inline preview bitmap allocation to source detail and an 8 Mi-pixel budget; cache the source/mask composite during cursor movement. Full-resolution mask data remains unchanged.
- Successful adoption resets comparison history to the accepted image as 1/1. The next generation starts a fresh result list; failed adoption preserves history.

## 0.5.9

- Bound comparison bitmap resolution to source detail, 8192 pixels per edge and a 16 Mi-pixel allocation budget, avoiding quadratic bitmap growth at large workflow zoom.
- Redraw only the strip swept by the comparison divider during pointer movement; redraw fully after image, size or hover changes.
- Draw the divider as a separate overlay so it remains one screen pixel wide even when magnifying the workflow.

## 0.5.8

- Count each comparison preview file once, even when cached execution notifications replay it; keep the selected result on replay.
- Remove duplicate preview entries when reloading older saved comparison histories.

## 0.5.7

- Accumulate comparison results across runs, select the newest result and preserve each result's matching original, including after workflow reload.
- Keep comparison images permanently fitted and centered in the canvas; remove independent wheel zoom and middle/Space image panning.
- Route wheel events over the full comparison node, including the picture, to ComfyUI workflow navigation.
- Preserve hover comparison, the full-result view on pointer leave, batch selection and adoption with mask/history retention.

## 0.5.6

- Follow KJNodes Get/Set routes and reroutes when deciding which exclusive input is enabled, including the setter's and real source node's bypass/mute states.
- Support virtual routers using the current resolveVirtualOutput API, and safely reject routing cycles or missing setters.
- Exclude inactive inputs from detached execution DTOs before frontend link resolution, avoiding missing-input errors when a virtual Get itself is bypassed; retain all editable/saved workflow wires.
- Add dependency-free routing regression checks to CI and validate actual KJ Get/Set workflows with real CPU queue output pixels in both supported frontend versions/renderers.

## 0.5.5

- Bind the inline canvas, inpaint parameter panel and comparison widget width directly to the node's logical graph width. Cached screen-space measurements cannot shrink the widgets a second time at reduced graph zoom.
- Keep native widget margins and vertical sizing; horizontal and vertical node resizing remain available.
- Calculate source-image automatic canvas height from untransformed client dimensions rather than dividing screen measurements by graph zoom.
- Verify stale-width fault injection, horizontal/vertical resize, zoom, Fit/mask preservation and workflow reload on frontend 1.42.11 and 1.52.7 in both renderers.

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
