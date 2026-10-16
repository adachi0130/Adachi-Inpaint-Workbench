# Git versions and rollback

`v0.5.0` preserves masks when adopting results and adds group bypass presets. The local tag `local-before-v0.5.0` retains the exact version present before these changes, including the existing locale updates.

Both the local installation folder and the source folder keep Git history; a normal release ZIP does not contain `.git`, so use the Git bundle to restore history separately.

Run these commands in the plugin folder. Check there are no unsaved changes before switching versions.

```powershell
git status --short
git switch --detach local-before-v0.5.0
```

Return to the current version with:

```powershell
git switch --detach v0.5.0
```

Restart ComfyUI and refresh the browser with `Ctrl+F5` afterwards.
If you have local modifications, commit or back them up first so they are not overwritten.
