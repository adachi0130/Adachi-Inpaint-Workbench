# Manager / Registry publishing

A public GitHub repository does not by itself mean the plugin is listed in the Manager search index or in the Comfy Registry.
The Manager listing submission for this plugin is [PR #3378](https://github.com/Comfy-Org/ComfyUI-Manager/pull/3378), currently waiting on the upstream maintainer.

## Manager listing

[manager-entry.json](manager-entry.json) is the entry submitted to [ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager); it is added to the `custom-node-list.json` at the repository root in a pull request, and the maintainer merges it and refreshes the index.
Follow the [official Manager instructions](https://github.com/Comfy-Org/ComfyUI-Manager#how-to-register-your-custom-node-into-comfyui-manager).
Until it is listed you can still install through the Manager's Git URL option, using `https://github.com/adachi0130/Adachi-Inpaint-Workbench`.

## Comfy Registry

Per the [official publishing guide](https://docs.comfy.org/registry/publishing), the first publish requires you to create your own Publisher and API key.

1. Sign in at [Comfy Registry](https://registry.comfy.org/) and create a Publisher, then note the actual Publisher ID.
2. Replace the empty `[tool.comfy].PublisherId` in `pyproject.toml` with that ID and push it to GitHub.
3. In the repository Settings → Secrets and variables → Actions, add `REGISTRY_ACCESS_TOKEN` with the Registry publishing API key.
4. Run **Publish to Comfy Registry** manually from the Actions tab and check the publish and platform validation results.

The workflow is manual-only today and will not publish while no Publisher ID or API key is configured.
A Registry version cannot be overwritten once published, so later releases have to bump the version in `pyproject.toml`.
