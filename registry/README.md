# Manager / Registry publishing

The node is registered under publisher `adachi0130` in [Comfy Registry](https://registry.comfy.org/nodes/adachi-inpaint-workbench). Version visibility and installation can depend on Registry validation, so check the current status there.

## Manager listing

[manager-entry.json](manager-entry.json) records the legacy list entry submitted to [ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager).
For current registration requirements, follow the [official Manager instructions](https://github.com/Comfy-Org/ComfyUI-Manager#how-to-register-your-custom-node-into-comfyui-manager) and the Registry publishing guide below.
You can also install through the Manager's Git URL option, using `https://github.com/adachi0130/Adachi-Inpaint-Workbench`.

## Comfy Registry

Per the [official publishing guide](https://docs.comfy.org/registry/publishing), publishing requires the registered Publisher and its API key.

1. Sign in at [Comfy Registry](https://registry.comfy.org/) as the owner of publisher `adachi0130`.
2. Check `[tool.comfy].PublisherId` in `pyproject.toml` (currently `adachi0130`) and confirm it matches the Publisher you own before publishing.
3. In the repository Settings → Secrets and variables → Actions, add `REGISTRY_ACCESS_TOKEN` with the Registry publishing API key.
4. Run **Publish to Comfy Registry** manually from the Actions tab and check the publish and platform validation results.

The publishing workflow is manual-only. Check its result and the Registry version status after publishing.
A Registry version cannot be overwritten once published, so later releases have to bump the version in `pyproject.toml`.
