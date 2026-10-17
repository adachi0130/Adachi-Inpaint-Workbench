import { CROP_PRESETS, cropAt } from "./crop_geometry.js?v=0.6.2";
import { T } from "./i18n.js";
import { syncCropDimensions } from "./parameter_bridge.js?v=0.6.4";
import { installResultAdoption } from "./result_adoption.js?v=0.7.2";

const fields = ["mask", "baseMask", "history", "future", "lastMask", "dirty"];
const canvas = (w, h) =>
  Object.assign(document.createElement("canvas"), { width: w, height: h });
const load = async (url) => {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
};
const make = (tag, cls) => {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
};

export class InlineCropController {
  constructor(
    node,
    editor,
    { find, hide, changed, imageUrl, beforeModeChange },
  ) {
    Object.assign(this, { node, editor, changed, imageUrl, beforeModeChange });
    this.widgets = Object.fromEntries(
      ["edit_mode", "crop_state", "blend_data", "layer_image"].map((name) => [
        name,
        find(name),
      ]),
    );
    Object.values(this.widgets).forEach(hide);
    this.contexts = {};
    this.target = "mask";
    this.layer = null;
    this.revision = 0;
    this.acceptVersion = 0;
    this.cropWidth = 1024;
    this.cropHeight = 1536;
    this.patchCanvas = canvas(1, 1);
    this.build();
    installResultAdoption(node, this);
    const originalFlush = editor.flush.bind(editor);
    editor.flush = () => {
      if (this.target !== "blend") return originalFlush();
      if (!editor.ready || !this.region?.locked)
        return this.widgets.blend_data.value;
      if (!editor.dirty && !editor.stroke) return this.widgets.blend_data.value;
      const r = this.region,
        out = canvas(r.width, r.height),
        ctx = out.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, r.width, r.height);
      ctx.drawImage(
        editor.mask,
        r.x,
        r.y,
        r.width,
        r.height,
        0,
        0,
        r.width,
        r.height,
      );
      this.widgets.blend_data.value = out.toDataURL("image/png");
      out.width = out.height = 0;
      editor.dirty = false;
      return this.widgets.blend_data.value;
    };
    editor.options.sceneRevision = () =>
      `${this.mode}:${this.target}:${this.revision}`;
    editor.options.drawSource = (ctx) => this.drawSource(ctx, {preview:this.previewOriginal});
    editor.options.displayView = () => this.previewOriginal ? "image" : editor.view;
    editor.options.showCursor = () => !this.previewOriginal;
    editor.options.showMask = () =>
      this.mode !== "crop" || (this.target === "mask" && this.region?.locked);
    editor.options.drawOverlay = (ctx, d) => this.drawOverlay(ctx, d);
    editor.options.paintBounds = () =>
      this.mode === "crop" && this.region?.locked ? this.region : undefined;
    const down = editor.pointerDown.bind(editor),
      move = editor.pointerMove.bind(editor);
    editor.pointerDown = (e) => {
      if (!editor.ready) return;
      if (this.previewOriginal) { e.preventDefault(); e.stopPropagation(); return; }
      if (this.busy) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (this.mode === "crop" && e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        editor.root.focus({ preventScroll: true });
        if (this.layer && this.region.locked && !editor.stroke && editor.pointerId == null) {
          this.previewOriginal = true;
          this.originalPreviewPointer = e.pointerId;
          editor.canvas.setPointerCapture(e.pointerId);
          editor.cursor = null;
          this.revision++;
          editor.schedule();
        } else if (!this.layer && this.region.locked) this.run(() => this.reselect());
        return;
      }
      if (
        this.mode === "crop" &&
        !this.region?.locked &&
        e.button === 0 &&
        !editor.space
      ) {
        e.preventDefault();
        e.stopPropagation();
        editor.root.focus({ preventScroll: true });
        const p = editor.point(e),
          r = cropAt(
            editor.image.width,
            editor.image.height,
            this.cropWidth,
            this.cropHeight,
            p.x,
            p.y,
          );
        if (r) this.lock(r);
        return;
      }
      down(e);
    };
    editor.pointerMove = (e) => {
      if (this.previewOriginal) { editor.cursor = null; return; }
      if (
        this.mode === "crop" &&
        editor.ready &&
        !this.region?.locked &&
        !editor.drag
      ) {
        const p = editor.point(e);
        this.hover = cropAt(
          editor.image.width,
          editor.image.height,
          this.cropWidth,
          this.cropHeight,
          p.x,
          p.y,
        );
      }
      move(e);
    };
    this.finishPreview = event => {
      if (event.pointerId !== this.originalPreviewPointer) return;
      if (event.type === "pointerup" && (event.buttons & 2)) return;
      event.preventDefault(); event.stopPropagation();
      this.stopOriginalPreview();
    };
    for (const name of ["pointerup", "pointercancel"]) {
      window.addEventListener(name, this.finishPreview, true);
    }
    editor.canvas.addEventListener("lostpointercapture", this.finishPreview, true);
    this.previewBlur = () => this.stopOriginalPreview();
    window.addEventListener("blur", this.previewBlur);
    editor.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      editor.schedule();
    });
    editor.root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.mode === "crop" && !editor.stroke) {
        e.preventDefault();
        e.stopPropagation();
        this.reselect();
      }
    });
  }

  get mode() {
    return this.widgets.edit_mode.value || "mask";
  }
  stopOriginalPreview() {
    if (!this.previewOriginal) return;
    const pointer = this.originalPreviewPointer;
    this.previewOriginal = false;
    this.originalPreviewPointer = null;
    if (pointer != null && this.editor.canvas.hasPointerCapture(pointer)) {
      this.editor.canvas.releasePointerCapture(pointer);
    }
    this.revision++;
    this.editor.schedule();
  }
  get region() {
    try {
      return JSON.parse(this.widgets.crop_state.value || "{}");
    } catch {
      return {};
    }
  }
  state(value) {
    this.widgets.crop_state.value = JSON.stringify(value);
    this.revision++;
  }
  snapshot() {
    return Object.fromEntries(fields.map((k) => [k, this.editor[k]]));
  }
  activate(target) {
    if (this.target === target) return;
    this.editor.flush();
    this.contexts[this.target] = this.snapshot();
    const next = this.contexts[target];
    if (!next) return;
    Object.assign(this.editor, next);
    this.target = target;
    this.editor.maskRevision++;
    this.editor.updateButtons();
    this.editor.schedule();
    this.sync();
  }
  build() {
    const e = this.editor;
    this.modeSelect = make("select", "dd-mode-select");
    this.modeSelect.setAttribute("aria-label", T("Editing mode"));
    this.modeSelect.title = T("Mask: paint the full image. Crop & Blend: select a region, inpaint it, then adopt and blend the result.");
    for (const [value, label] of [
      ["mask", "Mask"],
      ["crop", "Crop & Blend"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = T(label);
      this.modeSelect.append(option);
    }
    this.modeSelect.onchange = () => this.setMode(this.modeSelect.value);
    e.root.append(this.modeSelect);
    this.bar = make("div", "dd-crop-bar");
    this.preset = make("select", "");
    this.preset.setAttribute("aria-label", T("Crop size"));
    this.preset.title = T("Crop resolution presets. Changing size releases the current selection; left-click the image to place a new region. Inpaint dimensions follow when selected.");
    for (const [w, h] of CROP_PRESETS) {
      const o = document.createElement("option");
      o.value = `${w}x${h}`;
      o.textContent = `${w} × ${h}`;
      this.preset.append(o);
    }
    const custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = T("Custom");
    this.preset.append(custom);
    this.preset.onchange = () => this.run(() => {
      const custom = this.preset.value === "custom";
      const [width, height] = custom
        ? [this.cropWidth, this.cropHeight]
        : this.preset.value.split("x").map(Number);
      return this.changeSize(width, height, {custom});
    });
    this.bar.append(this.preset);
    const button = (text, title, action) =>
      e.button(this.bar, text, T(title), () => this.run(action));
    this.swapButton = button("⇄", "Swap width and height, release the current selection, then left-click to place the new region.", () =>
      this.changeSize(this.cropHeight, this.cropWidth),
    );
    // Shown in both modes: one click clears the mask of the active target.
    // It sits right after the swap control in Crop & Blend, and is the only
    // visible button in Mask mode.
    this.clearButton = button("🗑", "Clear the mask", () => e.action({ type: "clear" }));
    this.swapButton.after(this.clearButton);
    this.maskButton = button("◌", "Paint inside the selected region. Right-click releases the selection; left-click places a new one. Alt: erase. Ctrl+wheel: brush size; Shift+wheel: hardness.", () => {
      this.activate("mask");
      this.changed();
    });
    this.blendButton = button(
      "◐",
      "Edit layer blending: brush keeps the new result; Alt restores original pixels. Hold right-click to preview the original, release to return.",
      () =>
        this.run(async () => {
          // Blending is opt-in after adoption: build the blend mask on first
          // use, then switch the editor into the blend layer.
          if (!this.contexts.blend) await this.makeBlend(this.widgets.blend_data.value);
          this.activate("blend");
          this.changed();
        }),
    );
    this.commitButton = button("✓", "Merge the visible result and blend mask into the source image. After merging, right-click releases the selected region.", () =>
      this.flatten(),
    );
    // Move the original live button, retaining its history and disabled state.
    this.undoButton = e.undoButton;
    this.undoButton.textContent = "↶";
    this.undoButton.title = T("Undo the last stroke in the active repaint or blend mask (Ctrl+Z). Redo with Ctrl+Shift+Z.");
    this.commitButton.after(this.undoButton);
    this.custom = make("div", "dd-crop-custom");
    this.custom.hidden = true;
    for (const key of ["cropWidth", "cropHeight"]) {
      const input = make("input", "");
      input.type = "number";
      input.min = 64;
      input.max = 16384;
      input.step = 64;
      input.value = this[key];
      input.setAttribute(
        "aria-label",
        T(key === "cropWidth" ? "Width" : "Height"),
      );
      input.title = T("Custom crop dimension in 64-pixel steps. Changing it releases the selected region.");
      input.onchange = () => this.run(() => {
        const value = Math.max(64, Math.min(16384, Math.round(Number(input.value) / 64) * 64));
        return this.changeSize(key === "cropWidth" ? value : this.cropWidth,
          key === "cropHeight" ? value : this.cropHeight, {custom:true});
      });
      this.custom.append(input);
    }
    this.bar.append(this.custom);
    e.root.append(this.bar);
    this.sync();
  }
  async run(action) {
    if (
      this.busy ||
      this.editor.stroke
    )
      return;
    try {
      await action();
    } catch (error) {
      this.editor.status(error.message, true);
    }
  }
  sync() {
    this.editor.root.classList.toggle("dd-crop-mode", this.mode === "crop");
    this.modeSelect.value = this.mode;
    // No hover text on the painting canvas; the bottom controls carry the hints.
    this.editor.canvas.removeAttribute("title");
    for (const control of [this.preset, this.swapButton, this.maskButton, this.blendButton, this.commitButton]) {
      control.hidden = this.mode !== "crop";
    }
    this.custom.hidden = this.mode !== "crop" || this.preset.value !== "custom";
    this.undoButton.disabled = !!this.busy || !this.editor.history.length;
    this.clearButton.disabled = !!this.busy || !this.editor.ready;
    this.blendButton.disabled = !this.layer;
    this.commitButton.disabled = !this.layer;
    this.maskButton.classList.toggle("dd-active", this.target === "mask");
    this.blendButton.classList.toggle("dd-active", this.target === "blend");
    this.modeSelect.disabled = !!this.busy;
    this.preset.disabled = !!this.busy;
    this.swapButton.disabled = !!this.busy;
    for (const input of this.custom.children)
      input.disabled = !!this.busy;
  }
  setMode(mode) {
    if (
      this.editor.stroke ||
      this.busy
    ) {
      this.sync();
      return;
    }
    if (mode === this.mode) {
      this.sync();
      return;
    }
    const apply = () => {
      this.stopOriginalPreview();
      this.activate("mask");
      this.widgets.edit_mode.value = mode;
      this.state({ ...this.region, job: crypto.randomUUID() });
      this.editor.fit();
      this.sync();
      this.changed();
    };
    const recovery = this.beforeModeChange?.();
    if (!recovery?.then) {
      if (recovery !== false) apply();
      return;
    }
    this.busy = true;
    this.sync();
    return recovery
      .then((ok) => {
        this.busy = false;
        if (ok !== false && !this.editor.destroyed) apply();
        else this.sync();
      })
      .catch((error) => {
        this.busy = false;
        this.sync();
        this.editor.status(error.message, true);
      });
  }
  syncPreset() {
    const value = `${this.cropWidth}x${this.cropHeight}`;
    this.preset.value = [...this.preset.options].some((o) => o.value === value)
      ? value
      : "custom";
    this.custom.hidden = this.preset.value !== "custom";
    [...this.custom.children].forEach(
      (e, i) => (e.value = i ? this.cropHeight : this.cropWidth),
    );
  }
  sizeChanged() {
    this.hover = null;
    this.editor.schedule();
    this.syncPreset();
  }
  async changeSize(width, height, {custom = false} = {}) {
    if (this.busy || this.editor.stroke) { this.syncPreset(); return; }
    try {
      // Use the same merge-before-reselect behavior as the reselect button.
      if (this.region.locked) await this.reselect();
      this.cropWidth = width;
      this.cropHeight = height;
      this.sizeChanged();
      if (custom) { this.preset.value = "custom"; this.custom.hidden = false; }
      this.sync();
      this.changed();
    } catch (error) {
      this.syncPreset();
      throw error;
    }
  }
  reset() {
    this.stopOriginalPreview();
    this.layer = null;
    this.widgets.layer_image.value = "";
    this.widgets.blend_data.value = "";
    this.contexts = {};
    this.target = "mask";
    this.hover = null;
    this.state({ locked: false, job: crypto.randomUUID() });
    const { width, height } = this.editor.image;
    for (const o of this.preset.options)
      if (o.value !== "custom") {
        const [w, h] = o.value.split("x").map(Number);
        o.disabled = w > width || h > height;
      }
    if (this.cropWidth > width || this.cropHeight > height) {
      this.cropWidth = Math.min(1024, Math.floor(width / 64) * 64);
      this.cropHeight = Math.min(1536, Math.floor(height / 64) * 64);
    }
    this.syncPreset();
    this.sync();
    this.editor.schedule();
  }
  lock(region) {
    this.activate("mask");
    this.contexts.blend = null;
    this.layer = null;
    this.widgets.layer_image.value = "";
    this.widgets.blend_data.value = "";
    this.state({ ...region, locked: true, job: crypto.randomUUID() });
    const e = this.editor;
    // A new crop only limits the painting area; the repaint mask starts empty.
    for (const c of [e.mask, e.baseMask])
      c.getContext("2d").clearRect(0, 0, c.width, c.height);
    e.history = [];
    e.future = [];
    e.changed();
    syncCropDimensions(this.node, region.width, region.height);
    this.sync();
    this.changed();
  }
  makeBlend(data = "") {
    const r = this.region,
      e = this.editor,
      mask = canvas(e.image.width, e.image.height),
      baseMask = canvas(e.image.width, e.image.height);
    const ctx = mask.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(r.x, r.y, r.width, r.height);
    baseMask.getContext("2d").drawImage(mask, 0, 0);
    this.contexts.blend = {
      mask,
      baseMask,
      history: [],
      future: [],
      lastMask: "",
      dirty: false,
    };
    if (!data) return Promise.resolve();
    return load(data).then((image) => {
      const out = canvas(r.width, r.height),
        c = out.getContext("2d");
      c.drawImage(image, 0, 0);
      const pixels = c.getImageData(0, 0, r.width, r.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        pixels.data[i + 3] = pixels.data[i];
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      }
      ctx.clearRect(0, 0, mask.width, mask.height);
      ctx.putImageData(pixels, r.x, r.y);
      const base = baseMask.getContext("2d");
      base.clearRect(0, 0, baseMask.width, baseMask.height);
      base.drawImage(mask, 0, 0);
      out.width = out.height = 0;
    });
  }
  async restore() {
    this.stopOriginalPreview();
    this.target = "mask";
    this.contexts = {};
    this.layer = null;
    const r = this.region;
    if (r.locked) {
      this.cropWidth = r.width;
      this.cropHeight = r.height;
      this.syncPreset();
      if (this.widgets.layer_image.value) {
        this.layer = await load(this.imageUrl(this.widgets.layer_image.value));
        await this.makeBlend(this.widgets.blend_data.value);
        // Stay on the repaint mask; the adopted layer is baked into the source,
        // and blending is entered explicitly through the ◐ button.
      }
    }
    this.revision++;
    this.sync();
    this.editor.schedule();
  }
  async accept(record, {allowBusy = false, image = null} = {}) {
    if (
      this.editor.destroyed ||
      this.mode !== "crop" ||
      !this.region.locked ||
      record.job !== this.region.job ||
      (this.busy && !allowBusy)
    )
      return;
    if (this.editor.stroke) {
      this.pendingResult = record;
      clearTimeout(this.resultTimer);
      this.resultTimer = setTimeout(() => {
        const next = this.pendingResult;
        this.pendingResult = null;
        this.accept(next, {allowBusy}).catch((error) =>
          this.editor.status(error.message, true),
        );
      }, 50);
      return;
    }
    const name = record.image.subfolder
      ? `${record.image.subfolder}/${record.image.filename}`
      : record.image.filename;
    if (name === this.widgets.layer_image.value) return;
    const version = ++this.acceptVersion;
    // The adoption path already decoded this image once; reuse it instead of
    // downloading and decoding the full-size result a second time.
    const decoded = image || await load(this.imageUrl(name));
    if (
      this.editor.destroyed ||
      version !== this.acceptVersion ||
      record.job !== this.region.job ||
      this.mode !== "crop"
    )
      return;
    this.layer = decoded;
    this.widgets.layer_image.value = name;
    // Adopt then return: with an empty blend mask the backend hard-composites
    // the whole crop from layer_image, so the result is immediately baked into
    // the source and the repaint mask is reused on the next generation. Blending
    // is no longer entered automatically; the ◐ button opens it on demand.
    this.activate("mask");
    this.revision++;
    this.sync();
    this.editor.schedule();
    this.changed();
  }
  drawSource(ctx, {preview = false} = {}) {
    if (this.mode !== "crop") return false;
    const e = this.editor,
      r = this.region;
    ctx.drawImage(e.image, 0, 0);
    if (!preview && this.layer && r.locked) {
      const key = `${this.revision}:${e.maskRevision}`;
      if (this.patchKey !== key) {
        this.patchCanvas.width = r.width;
        this.patchCanvas.height = r.height;
        const c = this.patchCanvas.getContext("2d");
        c.drawImage(this.layer, 0, 0);
        const mask =
          this.target === "blend" ? e.mask : this.contexts.blend?.mask;
        if (mask) {
          c.globalCompositeOperation = "destination-in";
          c.drawImage(
            mask,
            r.x,
            r.y,
            r.width,
            r.height,
            0,
            0,
            r.width,
            r.height,
          );
          c.globalCompositeOperation = "source-over";
        }
        this.patchKey = key;
      }
      ctx.drawImage(this.patchCanvas, r.x, r.y);
    }
    return true;
  }
  drawOverlay(ctx, d) {
    if (this.mode !== "crop") return;
    const r = this.region.locked ? this.region : this.hover;
    if (!r) return;
    ctx.save();
    if (this.region.locked) {
      ctx.fillStyle = "#0008";
      ctx.beginPath();
      ctx.rect(0, 0, this.editor.image.width, this.editor.image.height);
      ctx.rect(r.x, r.y, r.width, r.height);
      ctx.fill("evenodd");
    }
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1 / d.scale;
    ctx.setLineDash([6 / d.scale, 4 / d.scale]);
    ctx.strokeRect(r.x, r.y, r.width, r.height);
    ctx.restore();
  }
  async flatten() {
    if (!this.layer) return;
    this.stopOriginalPreview();
    this.editor.flush();
    this.busy = true;
    this.sync();
    try {
      const e = this.editor,
        c = canvas(e.image.width, e.image.height);
      this.drawSource(c.getContext("2d"));
      const blob = await new Promise((resolve) =>
        c.toBlob(resolve, "image/png"),
      );
      c.width = c.height = 0;
      this.activate("mask");
      await e.options.onUpload(
        new File([blob], `merged-${crypto.randomUUID()}.png`, {
          type: "image/png",
        }),
        { preserveMask: true, preserveCrop: true },
      );
      this.layer = null;
      this.widgets.layer_image.value = "";
      this.widgets.blend_data.value = "";
      this.contexts.blend = null;
      this.state({ ...this.region, job: crypto.randomUUID() });
    } finally {
      this.busy = false;
      this.sync();
      this.editor.schedule();
      this.changed();
    }
  }
  async reselect() {
    if (
      this.busy ||
      this.editor.stroke
    )
      return;
    await this.flatten();
    this.activate("mask");
    this.state({ locked: false, job: crypto.randomUUID() });
    this.hover = null;
    this.sync();
    this.editor.schedule();
    this.changed();
  }
  destroy() {
    this.stopOriginalPreview();
    window.removeEventListener("blur", this.previewBlur);
    for (const name of ["pointerup", "pointercancel"]) {
      window.removeEventListener(name, this.finishPreview, true);
    }
    this.editor.canvas.removeEventListener("lostpointercapture", this.finishPreview, true);
    clearTimeout(this.resultTimer);
    this.pendingResult = null;
    this.acceptVersion++;
    for (const context of Object.values(this.contexts))
      for (const key of ["mask", "baseMask"])
        if (context?.[key] !== this.editor[key] && context?.[key])
          context[key].width = context[key].height = 0;
    this.patchCanvas.width = this.patchCanvas.height = 0;
  }
}
