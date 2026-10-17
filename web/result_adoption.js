import { api } from "../../scripts/api.js";
import { T } from "./i18n.js";

export function installResultAdoption(node, crop) {
    // Saved workflows may still contain the old feedback socket and wire.
    const removeLegacyInput = () => {
        const index = node.inputs?.findIndex(input => input.name === "result");
        if (index >= 0) node.removeInput(index);
    };
    removeLegacyInput();
    const configured = node.onConfigure;
    node.onConfigure = function () {
        const result = configured?.apply(this, arguments);
        removeLegacyInput();
        return result;
    };
    node.adachiAdoptCrop = async (file, origin) => {
        const editor = crop.editor, region = crop.region;
        if (!editor.ready || !region.locked) throw Error(T("Select a crop region before adopting a result"));
        if (crop.busy || editor.stroke) throw Error(T("Finish editing before adopting a result"));
        if (origin && (origin.mode !== "crop" || String(origin.source) !== String(node.id) || origin.job !== region.job)) {
            throw Error(T("This result belongs to another crop; generate a result for the current region"));
        }
        if (file.size > 64 * 1024 * 1024) throw Error(T("File is too large (max 64 MB)"));
        crop.busy = true; crop.sync();
        const objectUrl = URL.createObjectURL(file);
        try {
            const image = new Image(); image.src = objectUrl; await image.decode();
            if (image.width !== region.width || image.height !== region.height) {
                throw Error(T("Result dimensions must match the selected crop"));
            }
            const body = new FormData();
            body.append("image", file, `adopted-${crypto.randomUUID()}.png`);
            body.append("type", "input"); body.append("subfolder", "adachi-inpaint-layers");
            const response = await api.fetchApi("/upload/image", {method:"POST", body});
            if (!response.ok) throw Error(`${T("Upload failed")} (${response.status})`);
            const uploaded = await response.json();
            if (typeof uploaded.name !== "string" || !uploaded.name) throw Error(T("Upload failed"));
            if (editor.destroyed || crop.mode !== "crop" || crop.region.job !== region.job) {
                throw Error(T("The crop changed while adopting the result"));
            }
            const descriptor = {filename:uploaded.name, subfolder:uploaded.subfolder || "", type:"input"};
            await crop.accept({job:region.job, image:descriptor}, {allowBusy:true, image});
            const name = descriptor.subfolder ? `${descriptor.subfolder}/${descriptor.filename}` : descriptor.filename;
            if (crop.widgets.layer_image.value !== name) {
                // accept() may have skipped silently (busy / changed job / duplicate).
                throw Error(T("The result was not applied; the crop or layer state changed"));
            }
            editor.status("");
        } finally {
            URL.revokeObjectURL(objectUrl); crop.busy = false; crop.sync();
        }
    };
}
