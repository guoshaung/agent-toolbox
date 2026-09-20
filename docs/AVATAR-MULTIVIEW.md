# 三视图建模：安装、生成与验收

本版本在单图 TripoSR 之外增加 Hunyuan3D-2mv 真正的三视图联合推理，包含原图贴图改进、法线修复、细节查看，以及项目升级备份。

## 使用

1. 打开「更多 → 图片建模」，选择“三视图重建”。
2. 首次点击“安装所选环境”。需要 Windows、NVIDIA CUDA 显卡、uv、Git，Python 3.12 可由 uv 安装。单图和三视图环境分开存放；不会替换系统 Python。
3. 选择同一角色的正面、左侧（鼻尖朝画面左边）、背面三张图片，再点击“重建并导出 VRM”。要求完整全身、同姿势、同衣服、透明或纯白背景。三视图拼图必须先裁开。
4. 输出保存在容器的 `avatar-rig-studio/jobs/<job-id>`，打开查看器可旋转检查模型、看无贴图几何、显示骨架及测试头部运动。
5. 升级已有容器项目时，点击“更新项目脚本（自动备份）”。变化的旧脚本保存在 `_backups/<timestamp>`，用户任务、权重、环境不会被覆盖；保持这些备份即可恢复自己的脚本修改。

首次安装会联网拉取依赖、约 4.9GB Hunyuan fp16 权重和固定版本源码，约需额外数 GB 磁盘空间。Hunyuan3D 遵循其自己的许可（见下载源码 LICENSE 和模型卡），并不是 MIT。仓库不包含权重、用户图片、账号配置或生成产物。

豆包网页版可以生成三视图，但本工具没有接入自动网页登录/生图或收费 API。用户在豆包生成后导出三张参考图再导入，先检查服装、身高和左右方向是否一致。

## 本机验证与边界

RTX 4070 Laptop 8GB 上完成过完整多视图推理：fp16 + CPU offload、40 步、320 网格、chunk 8000。此前实验的模型加载和形状生成约160秒（不含下载、生成参考图）；实际时间取决于显存和其他程序占用。

贴图使用三张参考图正交投影，不是 Hunyuan 的扩散纹理生成。未提供的右侧细节需要近似，会有接缝；三视图生成错误也会传到模型。网格、原始无贴图 GLB 和 VRM 都会保留供精修。

VRM 导出包括21骨骼、每顶点最多4权重。它是启发式初步绑定，不保证准确适配任意姿势；没有手指/表情骨骼、口型、头发与衣服物理。文件校验通过不等于完成动画质量验收。

## 独立命令

```powershell
# 在容器项目目录
./setup_multiview.ps1
# 放入 input-front.png、input-left.png、input-back.png 到 jobs/my-avatar
.venv-mv/Scripts/python.exe pipeline_multiview.py --job jobs/my-avatar
.venv-mv/Scripts/python.exe app.py --port 18765
```

预先已拆图的拼图可用 `prepare_three_views.py --job jobs/example --first-cut 1000 --second-cut 1500`，但裁切线必须依据该图片选择，不是所有三视图通用值。推荐使用界面分别上传三张图，避免误切。

## 检查

```powershell
node --test test/avatar-rig.test.js test/avatar-multiview.test.js
# 任一已配置 numpy/scipy/Pillow/trimesh 的环境
python test/avatar_pipeline_test.py
npm run check
```

Node 测试不运行/下载大模型，检查分模式路由、缺图、并发锁、失败回执和备份升级；Python 测试检查白色衣服保留、输入对齐和实际三材质 VRM 结构。真实 GPU 回归与浏览器验收另行记录在 PR 验证说明。

本次新版回归：真实 IPC 服务使用三张 RGBA 参考图，完成预处理、GPU 多视图推理、贴图与 VRM 导出，结果140100顶点 / 280260三角面 / 21骨骼。剔除了4个退化三角形后，glTF validator 报告0错误0警告（不验证VRM扩展）；three-vrm 实际加载成功，三份蒙皮材质对同一头部旋转均产生一致位移。网页界面使用真实模块与 IPC stand-in 检查三图齐全前按钮禁用、模式/视图参数和结果显示；这是与 GPU 后端分开的界面测试，不冒充原生文件对话框端到端测试。
