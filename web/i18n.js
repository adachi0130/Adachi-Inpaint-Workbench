// Locale-aware labels for this plugin's own canvas UI.
//
// The English string in the call site is the default and the dictionary key, so any
// missing translation falls back to English. ComfyUI's locales/ files only cover node
// definitions (display name, category, sockets, tooltips); the custom panel and canvas
// buttons are drawn by this plugin, so they translate here by reading Comfy.Locale.

const ZH = {
  "Selection tools": "选区工具",
  "Magic wand": "魔棒",
  "Quick selection": "快速选择",
  "Quick selection (Q); drag to add, Alt to subtract": "快速选择 (Q)：拖动添加，Alt 减选",
  "Selection brush size": "选区笔径",
  "Editing mode": "编辑模式",
  "Crop & Blend": "裁切融合",
  "Crop size": "裁切尺寸",
  "Custom": "自定义",
  "Swap crop dimensions": "交换宽高",
  "Choose another region": "重新选区（自动合并当前图层）",
  "Repaint mask": "重绘蒙版",
  "Blend layers: brush keeps new pixels; Alt restores original": "图层融合：画笔保留新图，Alt 擦回原图",
  "Merge the visible layers": "合并当前可见图层",
  "Magic wand (W); Alt+click subtracts": "魔棒 (W)；Alt＋左键减去选区",
  "Tolerance": "容差",
  "Magic wand tolerance": "魔棒颜色容差",
  "Group Bypass Presets": "组忽略预设 / Group Bypass Presets",
  "Switch saved group enable/bypass presets; no connections required.": "切换已保存的分组启用/忽略预设，无需接线。",
  "Group presets": "分组预设",
  "+ New preset": "+ 添加预设",
  "Preset name": "预设名称",
  "Save": "保存",
  "Cancel": "取消",
  "Presets": "预设列表",
  "Group states": "分组状态",
  "Rename": "改名",
  "Save current group states": "记住当前分组状态",
  "Delete preset": "删除预设",
  "Preset": "预设",
  "Apply preset": "应用预设",
  "Add a preset to get started": "添加第一套预设",
  "No groups in this workflow yet": "当前工作流还没有分组",
  "Keep current": "保持当前",
  "Enabled": "打开",
  "Bypassed": "忽略",
  "Current group state differs from the preset": "当前分组状态与预设不同",
  "Overlapping groups use the smaller group's setting": "重叠分组以较小分组的设置为准",
  "presets": "套预设",
  "groups": "个分组",
  "missing groups": "个分组已不存在",
  // compare.js
  "Result": "结果",
  "Choose result": "选择重绘结果",
  "Connect an original image and a result, then run the workflow": "连接原图与重绘结果，然后运行工作流",
  "Adopt into": "回填到",
  "Target inline editor": "接收结果的内联蒙版",
  "Adopt this result": "采用此结果",
  "Move to compare · wheel to zoom · middle-drag to pan": "鼠标移动对比 · 滚轮缩放 · 中键拖动",
  "Select an inline mask": "选择内联蒙版",
  "Adopting…": "采用中…",
  "Setting the result as the new source image…": "正在将结果设为新原图…",
  "Adopted: back in the inline mask, keep painting to inpaint again": "已采用：回到内联蒙版，可继续涂抹重绘",
  "Inline Mask": "内联蒙版",
  "No inline mask node is available to receive the result": "找不到接收结果的内联蒙版节点",
  "Result preview expired; run the workflow again": "结果预览已过期，请重新运行工作流",
  "Result image exceeds 64 MiB; downscale it first": "结果图片超过 64 MiB，请先缩小",

  // editor.js
  "Cannot load image": "无法读取图像",
  "INLINE MASK": "内联蒙版 · INLINE MASK",
  "Load image": "载入原图",
  "Upload an image, or drop / paste one": "上传图片，也可拖放或粘贴",
  "Drop an image onto the canvas": "拖放图片到画布",
  "Brush": "画笔",
  "Brush (B)": "画笔 (B)",
  "Eraser": "橡皮",
  "Eraser (E); hold Alt or right-click for temporary erase": "橡皮 (E)，按住 Alt 或鼠标右键临时擦除",
  "Rectangle": "矩形",
  "Rectangle (R)": "矩形 (R)",
  "Lasso": "套索",
  "Freehand lasso (L)": "自由套索 (L)",
  "Pan": "移动",
  "Pan (H), or hold Space": "移动 (H)，或按住空格",
  "Brush size": "笔径",
  "Hardness": "硬度",
  "Brush opacity": "笔触",
  "Overlay": "叠加",
  "Drop an image here": "把原图拖到这里",
  "Paint the areas to repaint directly in this node": "直接在节点中涂抹需要重绘的区域",
  "Undo": "撤销",
  "Undo (Ctrl+Z)": "撤销 (Ctrl+Z)",
  "Redo": "重做",
  "Redo (Ctrl+Shift+Z)": "重做 (Ctrl+Shift+Z)",
  "Invert": "反转",
  "Invert the painted mask": "反转绘制的蒙版",
  "Fill": "全选",
  "Fill the whole image with mask": "重绘整张图",
  "Clear": "清空",
  "Clear the mask": "清空蒙版",
  "Import mask": "导入蒙版",
  "White repaints, black preserves": "白色重绘，黑色保护",
  "Export": "导出",
  "Export the mask PNG at full resolution": "导出原始分辨率黑白蒙版",
  "Image": "原图",
  "Mask": "蒙版",
  "Fit": "适应",
  "Keep": "保持",
  "Upload": "上传",
  "Fit the image to the canvas": "适应画布",
  "File is too large (max 64 MB)": "图片文件不能超过 64 MB",
  "Loading image…": "正在载入原图…",
  "Embedded image": "内嵌原图",
  "Orange is the painted mask · Alt = temporary erase · Ctrl+wheel = brush size": "橙色为绘制蒙版 · Alt 临时擦除 · Ctrl+滚轮调笔径",
  "Image is too large; keep it under 32 MP and 16384 px per side": "图像超过 3200 万像素或单边 16384px，请先缩小",

  // inline_inpaint.js
  "The inline mask node was removed": "内联蒙版节点已移除",
  "Adopted the result as the new source image; the mask and undo history were preserved": "已采用重绘结果作为新原图，蒙版与撤销记录已保留",
  "The result size must match the source image to preserve the mask": "为保留蒙版，重绘结果尺寸必须与原图一致",
  "Wait for the source image to finish loading before adopting a result": "请等待原图加载完成后再采用结果",
  "Drag to resize canvas height": "上下拖动调整画布高度",
  "Resize canvas height": "调整画布高度",
  "Upload failed": "上传失败",

  // inpaint_node.js
  "Connect an inline mask to show the painting tools": "连接内联蒙版后显示画笔工具",
  "The painting tools live in the other inpaint node connected to this image": "画笔工具位于连接此原图的另一个重绘节点",

  // inpaint_panel.js
  "WebUI Inpaint": "WebUI 局部重绘",
  "Controlled WebUI inpaint node": "控制的局部重绘节点",
  "Connect a WebUI inpaint node to edit its parameters here": "连接 WebUI 局部重绘节点后，在这里调整参数",
  "Mask mode": "重绘区域",
  "Fill content": "重绘参考内容",
  "Sampling area": "重绘画布",
  "Sampling resolution": "采样分辨率",
  "Use source size": "使用原图宽高",
  "Fill width and height from the current source image; aligned to 8 px and clamped to 64-8192 px": "填写当前原图宽高；按 8 的倍数对齐，并限制在 64–8192 像素",
  "Width": "宽度",
  "Height": "高度",
  "Denoise": "重绘幅度",
  "Sampler": "采样器",
  "Scheduler": "调度器",
  "Steps": "采样步数",
  "CFG scale": "提示词引导 CFG",
  "Seed": "随机种子",
  "After generate": "生成后种子",
  "Mask, batch and advanced settings": "蒙版、批量与高级设置",
  "Context padding": "蒙版外扩边距",
  "Mask blur": "蒙版模糊",
  "Mask grow / shrink": "蒙版扩张 / 收缩",
  "Batch size": "每张生成数量",
  "Resize mode": "缩放方式",
  "Use dedicated inpaint model": "使用专用 Inpaint 模型",
  "Extra edge feathering": "额外羽化边缘",
  "Feather strength": "额外羽化强度",
  "Refiner switch ratio": "Refiner 切换比例",

  "Preview unavailable; run the workflow again": "预览已过期或无法加载，请重新运行",
  "Result left, original right; hover to compare": "左重绘结果、右原图，移动鼠标竖线对比",
  "Inline mask painting canvas; orange areas are repainted": "直接涂抹蒙版；橙色区域将被重绘",
  "Embed the source image in the workflow; no separate file needed when sharing": "原图嵌入工作流 · 分享时无需另传原图",
  "Alt = temporary erase · Ctrl+wheel = brush size · wheel = zoom · Space = pan": "Alt 临时擦除 · Ctrl+滚轮调笔径 · 滚轮缩放 / 空格拖动",

  // enum values
  "enum:Inside mask": "蒙版内",
  "enum:Outside mask": "蒙版外",
  "enum:Fill": "填充",
  "enum:Original pixels": "原图像素",
  "enum:Latent noise": "潜空间噪声",
  "enum:Empty latent": "空白潜空间",
  "enum:Whole image": "整图重绘",
  "enum:Masked area only": "仅蒙版区域",
  "enum:Stretch": "拉伸",
  "enum:Center crop": "居中裁剪",
  "enum:Aspect fill": "保比例填充",
  "enum:Fixed": "固定种子",
  "enum:Increment": "生成后递增",
  "enum:Decrement": "生成后递减",
  "enum:Randomize": "生成后随机",
};

const DICTS = { zh: ZH };

function readLocale() {
  try {
    const api = globalThis.comfyAPI;
    const value = api?.app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    if (value) return String(value);
  } catch (_) { /* settings unavailable before the app boots */ }
  try {
    const value = globalThis.app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    if (value) return String(value);
  } catch (_) { /* ignore */ }
  return "en";
}

export function localeDict() {
  const base = readLocale().split("-")[0].toLowerCase();
  return DICTS[base] || null;
}

// Translate a user-facing string. `context` disambiguates identical English strings
// that need different translations (for example the Fill button and the Fill enum).
export function T(text, context) {
  const dict = localeDict();
  if (!dict) return text;
  const key = context ? `${context}:${text}` : text;
  return dict[key] ?? text;
}
