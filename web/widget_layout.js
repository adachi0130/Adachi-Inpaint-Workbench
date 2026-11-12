/** Keep the DOM widget host stable while its contents are mounted elsewhere.
 * Vue may reattach widget.element when switching renderers or viewport sizes. */
export function createWidgetHost(content) {
    const host = document.createElement("div");
    host.className = "adachi-widget-host";
    Object.assign(host.style, {width:"100%", height:"100%", minWidth:"0", minHeight:"0"});
    host.append(content);
    return host;
}

/** Fill the node in graph coordinates, independently of cached DOM measurements. */
export function bindWidgetToNodeWidth(node, widget, element) {
    // Classic ComfyUI uses widget.width before node.width for its DOM host.
    // A cached screen-space width is scaled a second time when zoomed out.
    // These single-column widgets always occupy the node's available width;
    // the frontend still applies its own widget margins and vertical layout.
    Object.defineProperty(widget, "width", {
        configurable: true,
        enumerable: true,
        get: () => Math.max(1, Number(node.size[0]) || 1),
        set: () => {},
    });
    element.style.width = "100%";
    element.style.maxWidth = "100%";
    element.style.minWidth = "0";
}
