# Avatar Rig Studio 0.3

三视图入口：在 Toolbox「图片建模」中选择 Hunyuan3D-2mv，安装所选环境后分别选择正面、左侧、背面。旧容器先点“更新项目脚本”，变化文件会备份至 `_backups`。

独立使用：运行 `setup_multiview.ps1`，将 `input-front.png` / `input-left.png` / `input-back.png` 放进任务目录，执行 `.venv-mv/Scripts/python.exe pipeline_multiview.py --job jobs/<id>`。三图需同姿势、完整全身、透明或纯白背景，左侧图鼻尖朝画面左边。三视图拼图先裁成三张独立图片。

首次多视图安装需下载约4.9GB权重和独立依赖，要求 NVIDIA CUDA。Hunyuan 源码和权重不在安装包内，使用其各自许可；当前贴图是参考图投影，不是扩散纹理。文件格式有效不代表模型、绑定和纹理已经精修。

以下为单图入口及共同产物说明。

本地 TripoSR 单图三维重建 + 初步蒙皮 + 标准 VRM 1.0 / GLB 导出。

上一版的横向缩放 GIF、长方体 OBJ 和自定义 `.vrk.json` 不是三维重建，现已退出生成流程。旧 jobs 仅作为历史文件保留。

## 启动

首次使用在容器内的项目目录运行 `setup.ps1` 安装依赖及下载权重，不需要 API Key。随后在 Toolbox 的「图片建模」选择图片 → 重建并导出 VRM → 旋转查看/下载模型。

从源码运行工具箱前执行 `npm ci` 与 `npm run avatar:prepare`；发布构建会自动准备 three.js / three-vrm 查看器资源。图片与生成资产不会随源码发布。初音官方参考图可选用 `.venv/Scripts/python.exe setup_models.py --sample` 下载，仅作个人本地测试，遵守来源许可。

在「容器」中本项目的启动按钮会打开 3D 查看器。也可以运行：

```powershell
.venv/Scripts/python.exe app.py
.venv/Scripts/python.exe pipeline.py --input miku-official.png --output jobs/my-avatar
```

新机器先运行 `setup.ps1`。需要 uv、Python 3.12 和 NVIDIA 驱动；会下载约 1.6GB 模型、约 2.4GB CUDA PyTorch 安装包。无 GPU 会尝试 CPU，速度明显更慢。

## 输出

- `avatar.vrm`：真正的 GLB 容器、VRMC_vrm 1.0 扩展、人形骨骼映射、蒙皮权重。
- `avatar.glb`：相同蒙皮模型，附带头部旋转测试动画。
- `reconstructed.glb` / `.ply`：未绑定的真实推理网格，可进入 Blender 精修。
- `project.json` / `reconstruction.json`：阶段结果、几何数量、绑定限制。
- `mesh.npz`：中间网格。编辑同任务下的 `landmarks.json` 后，可运行 `export_vrm.py --job jobs/my-avatar` 重新绑定。

## 实测与限制

初音官方全身立绘在 RTX 4070 Laptop 8GB 上完成推理，生成 39,825 顶点 / 79,646 三角面；VRM 具有 21 骨骼、每顶点最多 4 权重。

这是自动重建草稿，不是精修角色。单图背面和遮挡部分由模型猜测，脸/手细节会损失，可能有对称/背面伪影。绑定为启发式初始估计，保留原图姿势；动作重定向前需要人工校正 T-pose 和权重。没有口型、表情 BlendShape、手指骨骼、头发/布料物理。实验性 `--t-pose` 可能拉坏连在身体上的衣服和头发，默认禁用。

视频/豆包 API 尚未自动接入。可以在豆包网页生成一致三视图后手动导入当前多视图模式；不能把网页免费额度等同于免费 API。

## 来源

- TripoSR: https://github.com/VAST-AI-Research/TripoSR ，MIT，固定提交 `107cefdc244c39106fa830359024f6a2f1c78871`。Windows marching-cubes 改用 scikit-image，未更改网络权重。
- 模型：https://huggingface.co/stabilityai/TripoSR 。SHA256 `429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee`。
- 初音输入图：https://piapro.net/images/ch_img_miku.png ，官方页面 https://piapro.net/pages/character 。Art by KEI / © Crypton Future Media。许可须遵守 https://piapro.net/intl/en_for_creators.html ，本次仅作个人本地技术测试，不表示获得模型分发或商用授权。
- 查看器：three.js 0.186.0、@pixiv/three-vrm 3.5.5（MIT）。
- 多视图： https://github.com/Tencent-Hunyuan/Hunyuan3D-2 ，固定提交 `f8db63096c8282cb27354314d896feba5ba6ff8a`；模型 https://huggingface.co/tencent/Hunyuan3D-2mv 。安装器验证 SHA256，具体源码与模型许可见其官方仓库。
