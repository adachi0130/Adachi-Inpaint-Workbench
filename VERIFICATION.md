# 验证记录

验证环境：Windows、本机 ComfyUI 0.19.3、ComfyUI frontend 1.42.11、PyTorch 2.8.0、Pillow 11.0.0、Chrome 155，使用独立的 8190 端口、CPU、测试输入输出目录和内存数据库喵。

- 后端 16 项 CPU 测试通过，覆盖两种范围、边缘蒙版、反相、增长、羽化、周边颜色填充、批量映射、原像素保护、空蒙版、denoise=0、潜空间噪声/置零、专用 inpaint conditioning、不同 VAE 压缩比和 Refiner 分段喵。
- 浏览器 12 组交互测试通过，覆盖真实鼠标绘画、右键擦除、矩形/套索、撤销重做、导入持久化、半压力硬笔刷、活动形状保存、缩放坐标、1600/768/390 像素窗口布局喵。
- 经典节点与 Nodes 2.0 均完成真实画布拖画、工作流序列化、运行参数序列化与重新载入测试，蒙版像素一致且正确触发工作流修改状态，无插件 JavaScript 错误喵。
- 实际 ComfyUI API 队列执行了两种范围的载入→预处理→回贴→保存图像工作流，输出尺寸正确，有效蒙版外 RGB 像素逐值相等喵。
- 两份示例由真实节点生成、重新加载并构造执行参数，节点和连线有效，模型文件名为用户选择占位符喵。
- 安装脚本在临时目录完成首次安装、再次安装及旧版备份测试喵。
- 0.1.1 在经典节点和 Nodes 2.0 用真实鼠标拖动底部高度条，画布增高 160px、缩小 80px，保存并重开后尺寸和蒙版均保留喵。
- 0.1.2 用真实浏览器 Ctrl+滚轮测试笔径增减、1–512px 上下限、滑条数值同步和普通滚轮缩放，确认四个滑条位于画布下方；浏览器共 14 组交互验证通过喵。
- 0.2.0 新增 Alt 临时擦除和图像对比节点，后端 18 项测试通过；真实鼠标/键盘操作确认松开 Alt 恢复原工具喵。
- 0.2.0 在经典节点与 Nodes 2.0 的实际 API 队列验证左右像素、鼠标分割线、滚轮缩放、Ctrl+滚轮笔径、批量结果选择、多编辑器上游定位、点击回填、旧蒙版清空和保存后重新打开，无插件脚本错误喵。
- 两种节点模式中的图片滚轮事件均不会误触发整张工作流缩放，回填结果保存在 input 目录并可嵌入工作流喵。

采样路径还使用本机 ComfyUI 的真实 common_ksampler/KSampler 函数进行了噪声调度衔接检查；尚未加载实际 checkpoint 测试 GPU 生成质量或所有模型家族，不能将 CPU/接口测试视为模型效果验证喵。

实现参考资料：

- [ComfyUI 前端扩展接口](https://docs.comfy.org/custom-nodes/js/javascript_overview)
- [ComfyUI widget 序列化说明](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/WIDGET_SERIALIZATION.md)
- [WebUI 重绘预处理语义](https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/master/modules/processing.py)
- [rgthree 图像对比交互参考](https://github.com/rgthree/rgthree-comfy/blob/main/py/image_comparer.py)

插件代码为独立实现，发布许可见 LICENSE，未附带上述项目源码喵。
