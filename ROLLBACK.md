# Git 版本与回滚

`v0.2.0` 是最早的界面回滚点，`v0.3.0` 包含内联参数面板、左右对比调整和滚轮路由修复；`v0.4.0` 将画笔与参数集中到 WebUI 重绘节点；`v0.4.1` 更新橡皮擦光标及公开名称喵。
本机安装目录与源码目录均保留 Git 历史；普通发布 ZIP 不含 `.git`，可另用 Git bundle 恢复历史喵。

在插件目录运行以下命令，先确认没有未保存改动，再切换版本喵。

```powershell
git status --short
git switch --detach v0.4.0
```

恢复本版使用以下命令喵。

```powershell
git switch --detach v0.4.1
```

切换后重启 ComfyUI 并在浏览器按 `Ctrl+F5` 刷新喵。
已有本地修改时请先提交或备份，避免覆盖自己的改动喵。
