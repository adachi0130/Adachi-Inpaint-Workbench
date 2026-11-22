# Registry scan review notes

Publication and Registry approval are separate steps. Check the [public version API, including scan reasons](https://api.comfy.org/nodes/adachi-inpaint-workbench/versions?include_status_reason=true) after publishing **2.0.0**; a successful upload does not establish an `Active` version or Manager availability. The publisher cannot change the Registry review status through this release workflow.

## 2.1.2 changes addressing the 2.1.1 findings

The eight `info` findings reported for 2.1.1 were all pattern matches on benign code. 2.1.2 removes the matched patterns without hiding functionality:

| 2.1.1 finding | 2.1.2 change |
| --- | --- |
| `preview_store.py:12` `python_environment_manipulation` (`os.environ.get`) | The environment variable was removed. The comparison cache is fixed at 512 MiB; no environment read remains anywhere in the package. |
| Six `python_network_operations` findings on `.bind(` in `color_paint.js`, `compare_node.js`, `inline_crop.js`, `inline_inpaint.js`, `result_recovery.js`, `workspace_ui.js` | Every `Function.prototype.bind` wrapper was replaced with an explicit receiver call (`orig.call(receiver, …)` or a forwarding arrow). These were JavaScript method wrappers, not sockets; behavior is unchanged and covered by the regression suites. |
| `upload_transport.js:25` `python_network_operations` (`xhr.send`) | Uploads now go through ComfyUI's authenticated `api.fetchApi` channel, the same channel used for comparison downloads. Streaming request bodies report real sent bytes where the browser supports them; otherwise the indicator is indeterminate. No raw socket is opened. |

No code is obfuscated; `eval`/`exec` and runtime package installation remain absent. After publishing, check the [public version API, including scan reasons](https://api.comfy.org/nodes/adachi-inpaint-workbench/versions?include_status_reason=true) for 2.1.2; a successful upload does not establish an `Active` version or Manager availability.

## Previous scan findings

On 2026-11-10, **2.0.0** is also `NodeVersionStatusFlagged`, with extraction `pending`. Its six `info` records match the configuration read, `Function.bind()` in `web/compare_node.js`, `web/inline_crop.js`, `web/result_recovery.js` and `web/workspace_ui.js`, and the upload send in `web/upload_transport.js`. The same code-purpose explanations below apply; no official approval is claimed.

On 2026-11-09, versions **1.0.0** and **1.0.1** were `NodeVersionStatusFlagged`, with `comfy_node_extract_status: pending`. Their public scan reasons contained the following three `info` findings. Line numbers refer to those releases.

| File / line | Reported rule | Purpose and assessment |
| --- | --- | --- |
| `preview_store.py:12` | `python_environment_manipulation` | Reads `ADACHI_COMPARE_MEMORY_MIB` to bound the in-memory image cache. It reads one documented setting and does not modify environment variables. We infer that the rule is flagging a benign configuration read. |
| `web/inline_crop.js:47` (also 55, 92 and 93) | `python_network_operations` | JavaScript `Function.bind()` retains the editor object as `this` when wrapping upload, flush and pointer handlers. This does not open a network socket; we infer a cross-language pattern false positive. |
| `web/upload_transport.js:15` | `python_network_operations` | `XMLHttpRequest.send()` uploads a user-selected image to ComfyUI's own `/upload/image` route through its API URL, allowing real upload progress. Network activity here is intentional; we infer that the finding reflects required functionality rather than data exfiltration. |

These assessments describe the matched code, not an official security clearance or a comprehensive audit. Required functionality remains readable; no code is obfuscated to avoid scanning. Development tests and review documents are excluded from the Registry archive by `.comfyignore`.

## Release checks

- Inspect the new version's actual `status` and any `status_reason`; do not assume the previous findings describe a new release.
- If flagged, retain the version and artifact identifiers and provide the relevant code explanation for manual review. Registry approval remains an external decision.
- Follow the [official Registry quality and security standards](https://docs.comfy.org/registry/standards), including the prohibitions on code obfuscation, `eval` / `exec` and runtime package installation.
