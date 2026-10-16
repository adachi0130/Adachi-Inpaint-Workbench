# Git versions and rollback

The current local version is **v0.5.5**. Both the installed plugin and the source repository retain local commits and tags. No GitHub push is part of this update.

| Tag | Contents |
|---|---|
| `v0.5.5` | Bind canvas/panel widths to node geometry and retain vertical resizing |
| `v0.5.4` / `local-before-v0.5.5` | Isolate Fit clicks and refresh editor assets on upgrade |
| `v0.5.3` / `local-before-v0.5.4` | Fit beside Load image in the inline mask, plus the 5D VAE fix |
| `v0.5.2` / `local-before-v0.5.3` | Single-frame 5D VAE support for image models, plus all previous features |
| `local-before-v0.5.2` | Exact baseline before the VAE compatibility fix in each local repository |
| `v0.5.1` | Auto Exclusive Switch, wider preset list, and all v0.5.0 features |
| `v0.5.0` / `local-before-v0.5.1` | Preserve masks on adoption and group bypass presets |
| `local-before-v0.5.0` | Exact baseline before mask adoption / group preset changes |

To undo only this update, run in the plugin folder:

```powershell
git status --short
git switch --detach local-before-v0.5.5
```

Return to this version with:

```powershell
git switch --detach v0.5.5
```

Restart ComfyUI and hard-refresh the browser (`Ctrl+F5`) after switching versions.
Commit or back up any local modifications before switching. A release ZIP does not contain `.git`; local history is kept in the source and installation repositories.
