import { T } from "./i18n.js";

// XMLHttpRequest reports bytes sent, unlike fetch. Keep ComfyUI's API URL and
// per-user header; the browser automatically sends same-origin session cookies.
export async function uploadImageWithProgress(api, body, onProgress) {
    const response = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", api.apiURL("/upload/image"));
        if (api.user) xhr.setRequestHeader("Comfy-User", api.user);
        xhr.upload.onprogress = event => onProgress?.({phase: "upload", loaded: event.loaded, total: event.lengthComputable ? event.total : 0});
        xhr.upload.onload = () => onProgress?.({phase: "processing"});
        xhr.onload = () => resolve(xhr);
        xhr.onerror = () => reject(new Error(T("Network error while uploading image")));
        xhr.onabort = () => reject(new Error(T("Upload was cancelled")));
        xhr.send(body);
    });

    // Some cloud frontends wrap fetchApi with an authentication mechanism that
    // is not exposed to XHR. Retry rejected authentication through that same
    // frontend API, without inventing upload percentages for the fallback.
    if (response.status === 401 || response.status === 403) {
        onProgress?.({phase: "authenticated"});
        const fallback = await api.fetchApi("/upload/image", {method: "POST", body});
        if (!fallback.ok) throw new Error(`${T("Upload failed")} (${fallback.status})`);
        onProgress?.({phase: "processing"});
        return fallback.json();
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`${T("Upload failed")} (${response.status})`);
    try { return JSON.parse(response.responseText); }
    catch { throw new Error(T("Invalid upload response")); }
}
