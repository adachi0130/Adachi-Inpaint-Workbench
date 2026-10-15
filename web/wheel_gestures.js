/* Keep a continuous wheel gesture with its original viewport. */
const canvases = new Map();
let owner = null, lastTime = 0, modifiers = "";
const IDLE_MS = 180;
const reset = () => { owner = null; lastTime = 0; modifiers = ""; };

function capture(event) {
    // Ignore synthetic events forwarded by ComfyUI; they are not new gestures.
    if (!event.isTrusted) return;
    const entry = canvases.get(event.target);
    const rect = entry?.canvas.getBoundingClientRect();
    const inside = rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    const canvas = entry && inside && entry.ready() ? entry.canvas : null;
    const now = performance.now(), keys = `${event.ctrlKey}:${event.altKey}:${event.metaKey}:${event.shiftKey}`;
    if (!owner || now - lastTime > IDLE_MS || keys !== modifiers) owner = canvas || "graph";
    else if (owner !== "graph" && owner !== canvas) owner = "graph";
    lastTime = now; modifiers = keys;
    if (!entry || !inside || !entry.ready()) return;
    if (owner === canvas) entry.wheel(event);
    else if (entry.graphWheel) {
        event.preventDefault(); event.stopPropagation(); entry.graphWheel(event);
    }
}

export function registerImageWheel(canvas, ready, wheel, graphWheel) {
    if (!canvases.size) {
        window.addEventListener("wheel", capture, { capture: true, passive: false });
        window.addEventListener("blur", reset);
    }
    canvases.set(canvas, { canvas, ready, wheel, graphWheel });
    return () => {
        canvases.delete(canvas);
        if (!canvases.size) { window.removeEventListener("wheel", capture, true); window.removeEventListener("blur", reset); reset(); }
    };
}
