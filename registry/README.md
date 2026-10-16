# Manager / Registry publishing

A public GitHub repository does not by itself mean the plugin is listed in the Manager search index or in the Comfy Registry.
The previous Manager listing submission is [PR #3378](https://github.com/Comfy-Org/ComfyUI-Manager/pull/3378). It was closed without merging; it is not confirmation that the plugin is searchable. Check the live Registry/Manager index for current availability.

## Manager listing

[manager-entry.json](manager-entry.json) records the legacy list entry submitted to [ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager).
For current registration requirements, follow the [official Manager instructions](https://github.com/Comfy-Org/ComfyUI-Manager#how-to-register-your-custom-node-into-comfyui-manager) and the Registry publishing guide below.
Until it is listed you can still install through the Manager's Git URL option, using `https://github.com/adachi0130/Adachi-Inpaint-Workbench`.

## Comfy Registry

Per the [official publishing guide](https://docs.comfy.org/registry/publishing), the first publish requires you to create your own Publisher and API key.

1. Sign in at [Comfy Registry](https://registry.comfy.org/) and create a Publisher, then note the actual Publisher ID.
2. Check `[tool.comfy].PublisherId` in `pyproject.toml` (currently `adachi0130`) and confirm it matches the Publisher you own before publishing.
3. In the repository Settings → Secrets and variables → Actions, add `REGISTRY_ACCESS_TOKEN` with the Registry publishing API key.
4. Run **Publish to Comfy Registry** manually from the Actions tab and check the publish and platform validation results.

The publishing workflow is manual-only. A Publisher ID in project metadata does not prove that an API key is configured or that a Registry release has been published.
A Registry version cannot be overwritten once published, so later releases have to bump the version in `pyproject.toml`.
