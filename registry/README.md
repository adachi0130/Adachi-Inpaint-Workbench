# Manager / Registry 发布

GitHub 仓库公开并不代表 Manager 搜索清单或 Comfy Registry 已收录喵。

## Manager 清单

[manager-entry.json](manager-entry.json) 是提交给 [ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager) 的条目，加入其根目录的 `custom-node-list.json` 并提交 PR，等待维护者合并及索引更新喵。
提交方式以 [Manager 官方说明](https://github.com/Comfy-Org/ComfyUI-Manager#how-to-register-your-custom-node-into-comfyui-manager) 为准喵。
收录前仍可使用 Manager 的 Git URL 安装，仓库地址为 `https://github.com/adachi0130/Adachi-Inpaint-Workbench` 喵。

## Comfy Registry

根据 [官方发布指南](https://docs.comfy.org/registry/publishing)，首次发布需要开发者建立自己的 Publisher 及 API Key 喵。

1. 登录 [Comfy Registry](https://registry.comfy.org/)，创建自己的 Publisher，记录实际 Publisher ID 喵。
2. 将 `pyproject.toml` 中 `[tool.comfy].PublisherId` 的空值改成该 ID，提交到 GitHub 喵。
3. 在仓库 Settings → Secrets and variables → Actions 中添加 `REGISTRY_ACCESS_TOKEN`，值为 Registry 的发布 API Key 喵。
4. 在 Actions 中手动运行 **Publish to Comfy Registry**，查看发布和平台校验结果喵。

当前工作流仅手动触发，不会在未配置 Publisher 或 API Key 时自动发布喵。
Registry 的版本发布后不可覆盖，后续发布需要先递增 `pyproject.toml` 版本号喵。
