# Toolbox 原生 iPad 绘图本

使用 Apple PencilKit 的独立 iPadOS 应用，最低 iPadOS 16；仅绘图与电脑同步。

## 安装与签名

`ToolboxDrawing-0.2.0-unsigned.ipa` 是 **未签名的真机编译包**，不能直接点开安装。需要在自己的设备上签名。

- Windows：可使用爱思助手的「工具箱 → IPA 签名」，导入该 IPA，并自行输入 Apple ID / 验证码完成个人签名，再用数据线安装到 iPad。根据爱思官方说明，普通 Apple ID 签名有效期通常为 7 天，需要定期重新签名。首次运行可能需要在 iPad「隐私与安全性」启用开发者模式，并在「VPN 与设备管理」信任对应开发者。
- Mac：运行 `python3 generate_project.py`，用 Xcode 打开 `ToolboxDrawing.xcodeproj`，在 Signing & Capabilities 选自己的 Personal Team，连接 iPad 并运行。账号登录、设备信任与权限确认由本人操作。
- 本包没有 Apple 签名证书、描述文件或 Apple ID。没有绕过 iPadOS 签名。未越狱设备必须完成合法签名才能安装。

首次连接：电脑打开 Toolbox「更多 → 写作代码 → 同步绘图」，iPad 扫描专用二维码或粘贴完整配对地址。电脑需安装支持 PencilKit 数据的新版 Toolbox。

## 原生笔输入

- `PKCanvasView` 与 `PKToolPicker` 提供系统笔迹、压力、手写曲线、橡皮擦和套索。
- 默认 `pencilOnly`，手指不会画线；双指平移和缩放。可从「更多」显式允许手指绘制。
- 每笔保留 PencilKit 原始数据，并附上跨端矢量点，电脑可显示与继续编辑。
- 为兼容电脑矢量画板，原生橡皮限制为整笔擦除。暂未实现跨端像素级擦除。
- 最终压力值可能在抬笔后继续更新，因此延迟 180 ms 合并保存；此等待只影响同步提交，本地落笔由 PencilKit 即时显示。
- 原生绘图时推迟应用远端画面更新，避免来自电脑的通知打断正在写的笔迹。

## 数据与限制

配对凭据保存在本机 Keychain；笔迹与待同步操作保存在应用 Documents。应用开启、连接暂时中断时仍可书写；恢复连接后补传。个人签名续签请覆盖安装并保留相同 Bundle ID，避免卸载导致本地数据被删除。

图片/PDF 通过系统文件选择器导入。PDF 转为纸张底图，单次最多 30 页 / 20 MB；图片和底稿从电脑加载，断网时尚未缓存的图片不会显示。可导出当前页 PNG 和本机同步 JSON 备份；原生 JSON 备份不内嵌电脑图片，完整备份应同时保存电脑 `drawing-sync` 数据目录。

原生套索作用于笔迹，图片位置可在电脑端调整。手写识别、搜索、像素橡皮、自动形状与多人权限尚未实现。网页模式仍可用，绘图本沿用同一个设备 ID、纸张和同步服务。

原生构建通过不等于 Apple Pencil 真机验收。延迟、掌触、旋转、长时间绘制、签名续期及设备兼容性需要在实际 iPad 上验证。

参考：[Apple PencilKit](https://developer.apple.com/documentation/pencilkit)、[Apple 开发签名](https://help.apple.com/xcode/mac/current/en.lproj/dev60b6fbbc7.html)、[爱思官方签名教程](https://www.i4.cn/news_detail_38195.html)、[个人签名有效期](https://www.i4.cn/news_detail_40956.html)。
