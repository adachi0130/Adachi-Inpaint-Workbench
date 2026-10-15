import { app } from "../../scripts/app.js";

export function routeWheelOutsideImage(root, canvas, isReady) {
    const route = event => {
        if (!root.contains(event.target)) return;
        if (event.target === canvas && isReady()) return;
        event.preventDefault(); event.stopPropagation();
        // Preserve the user's ComfyUI navigation mode (zoom or pan).
        app.canvas?.processMouseWheel(event);
    };
    window.addEventListener("wheel", route, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", route, true);
}
