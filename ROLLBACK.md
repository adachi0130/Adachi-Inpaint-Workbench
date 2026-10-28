# Git versions and rollback

The current version is **v1.0.0**. Git history lives in the source repository. The installed custom-node folder may be a ZIP/file copy without its own `.git`; do not run rollback commands in ComfyUI's parent repository.

Before installing, the installer saves the previous plugin directory under `ComfyUI/user/adachi-workbench-backups/`. Restore that ZIP to roll back a copied installation. For a Git clone, use the tags below.

| Tag | Contents |
|---|---|
| `v1.0.0` | First stable release with current bilingual crop instructions |
| `local-before-v1.0.0` / `v0.9.0` | Source before stable-release documentation and metadata |
| `v0.9.0` | In-memory comparison previews and real upload progress |
| `local-before-v0.9.0` / `v0.8.2` | Source before memory previews and upload progress |
| `v0.8.2` | Refresh different-sized uploads and synchronize inpaint dimensions |
| `local-before-v0.8.2` / `v0.8.1` | Source before upload and dimension synchronization fixes |
| `v0.8.1` | Expire old comparison previews and download the latest result |
| `local-before-v0.8.1` / `v0.8.0` | Source before comparison-preview cleanup and latest-result download |
| `v0.6.7` | Hold right mouse to preview the original before merging; contextual hover help |
| `local-before-v0.6.7` | Source before original-layer preview and expanded hover instructions |
| `v0.6.6` | Right-click releases crops; move mask Undo beside Merge |
| `local-before-v0.6.6` | Source before right-click reselection and inline Undo |
| `v0.6.5` | Change crop dimensions while selected, automatically return to selection |
| `local-before-v0.6.5` | Source before editable locked-crop dimensions |
| `v0.6.4` | Black crop frame, automatic dimensions and comparison-only result adoption |
| `local-before-v0.6.4` | Source before the comparison-adoption update, including v0.6.3 draft preflight fixes |
| `v0.6.2` | Draft recovery, collapsible controls, retired selection tools and revised crop behavior |
| `local-before-v0.6.2` | Exact baseline before the combined draft/fold and crop updates |
| `v0.6.0` | Merged crop/blend editor, magic wand and quick selection |
| `local-before-v0.6.0` | Exact source baseline before the merged editor (includes bilingual README) |
| `v0.5.13` | Restore dropped enabled inputs through saved subgraph output routes |
| `v0.5.12` / `local-before-v0.5.13` | Trace Get/Set source states server-side before prompt validation and caching |
| `v0.5.11` / `local-before-v0.5.12` | Resolve exclusive selection from actual submitted connections despite stale frontend flags |
| `v0.5.10` / `local-before-v0.5.11` | Pin inline fit, bound/cache inline previews, Upload label and restart comparison rounds after adoption |
| `v0.5.9` / `local-before-v0.5.10` | Bound comparison bitmap allocations and redraw only the swept divider strip |
| `v0.5.8` / `local-before-v0.5.9` | Deduplicate replayed comparison previews and repair duplicate saved history |
| `v0.5.7` / `local-before-v0.5.8` | Fixed comparison images; wheel navigates the workflow; retain result history across runs |
| `v0.5.6` / `local-before-v0.5.7` | Exclusive selector follows Get/Set and virtual routes correctly |
| `v0.5.5` / `local-before-v0.5.6` | Bind canvas/panel widths to node geometry and retain vertical resizing |
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
git switch --detach local-before-v1.0.0
```

Return to this version with:

```powershell
git switch --detach v1.0.0
```

Restart ComfyUI and hard-refresh the browser (`Ctrl+F5`) after switching versions.
Commit or back up any local modifications before switching. A release ZIP does not contain `.git`; use the installer backup for a copied installation.
