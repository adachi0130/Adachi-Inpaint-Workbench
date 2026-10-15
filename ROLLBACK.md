# Git versions and rollback

`v0.2.0` is the first UI rollback point; `v0.3.0` added the inline parameter panel, the result/original comparison change and the wheel routing fix; `v0.4.0` moved the painting tools and parameters into the WebUI Inpaint node; `v0.4.1` refreshed the eraser cursor and the public name.

Both the local installation folder and the source folder keep Git history; a normal release ZIP does not contain `.git`, so use the Git bundle to restore history separately.

Run these commands in the plugin folder. Check there are no unsaved changes before switching versions.

```powershell
git status --short
git switch --detach v0.4.1
```

Return to the current version with:

```powershell
git switch main
```

Restart ComfyUI and refresh the browser with `Ctrl+F5` afterwards.
If you have local modifications, commit or back them up first so they are not overwritten.
