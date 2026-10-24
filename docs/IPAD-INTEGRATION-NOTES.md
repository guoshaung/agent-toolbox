# iPad 原生绘图：签名、安装与同步联调记录

验证日期：2026-10-24。原生绘图本 0.2.1，iPad（第 8 代）/ iPadOS 18.7.8，Xcode 27.1。本文记录可复用步骤与实测边界，不包含个人账户、主机地址、设备标识、连接二维码或证书。

## 先区分编译、签名、安装和启动

这四步可以分别成功或失败。`BUILD SUCCEEDED` 不代表应用已安装；`App installed` 也不代表 iPad 已信任开发者或应用能启动。

1. 在 Xcode Accounts 登录自己的 Apple 账户，目标启用自动签名并选择 Personal Team。
2. iPad 直接用 USB 接到 Mac，解锁，并确认设备信任。使用 `xcrun devicectl list devices` 检查 `available (paired)`。
3. 若提示设备需要解锁以开启开发服务，保持 iPad 解锁亮屏后重试。仅“USB 中能看见设备”不足以确认开发服务已就绪。
4. 编译时使用实际设备作为 destination，允许 Xcode 更新描述文件与注册设备。检查描述文件是否包含目标 iPad。
5. 签名私钥的钥匙串授权由用户在 Mac 上完成。SSH 下可能报 `errSecInternalComponent`；在用户已登录的本机终端运行构建，可显示授权提示。不要把钥匙串密码写入脚本。
6. 使用 `devicectl device install app` 安装，再单独启动。若 iPad 提示“不受信任的开发者”，在「设置 → 通用 → VPN 与设备管理」信任对应开发者。

可用以下命令作诊断；路径、Team 和设备标识使用自己的值：

```sh
xcrun devicectl list devices
xcrun devicectl device info details --device <DEVICE>
security find-identity -v -p codesigning
xcodebuild -project ToolboxDrawing.xcodeproj -scheme ToolboxDrawing \
  -configuration Debug -sdk iphoneos -destination 'id=<DEVICE>' \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM=<TEAM> build
codesign --verify --deep --strict <PATH_TO_APP>
xcrun devicectl device install app --device <DEVICE> <PATH_TO_APP>
xcrun devicectl device process launch --device <DEVICE> cn.macpe.agenttoolbox.drawing
```

个人签名存在到期时间，以实际 embedded.mobileprovision 为准。续签使用相同 Bundle ID 和同一团队覆盖安装，避免先卸载导致本地绘图数据丢失。本文不分发个人签名包、签名私钥或描述文件。

## USB 转接的实际结论

前期尝试让插在 Windows 的 iPad 经 USB 网络转接供远端 Mac 使用。曾达到 USB 枚举、部分配对接口和设备标识可见，但没有完成可验证的真机安装。服务 socket、苹果开发服务及设备准备状态均曾阻塞。

后来将 iPad 直接接入 Mac，完成配对、签名、安装与启动。因此可复用的成功路径是直接 USB 连接；不能把前期网络 USB 转接或重启猜测描述成已成功方案。不要把“设备出现在列表”当成“Xcode 可以安装和运行”。

## 扫码后没反应：SSE 空行问题

症状：HTTP 和网络正常，SSE 请求也建立了，但原生画面一直显示“未配对”，没有应用初始绘图快照。

旧代码迭代 `URLSession.AsyncBytes.lines`，收集 `event:`、`data:`，并等待空行后处理事件。实际运行发现该行序列跳过空行，处理分支始终无法执行。用真实 Foundation 网络接口和本地 SSE 响应可复现；浏览器客户端并无相同症状。

工具箱服务的协议为每个事件发送一行完整 JSON `data:`。0.2.1 因此在收到该数据行后立即处理当前事件，随后清除事件类型；流结束时进入重连，而不是继续显示在线。这是针对本项目单行 JSON 协议的接收方式，不是通用的多行 SSE 解析器。

排查顺序：

1. 确认电脑服务已开启，客户端网络可访问。
2. 确认原生绘图本内部完成配对。系统相机扫码打开 Safari，只会配对网页。
3. 检查服务是否实际收到带身份与凭据的事件请求。
4. 检查原生端是否处理到初始快照，而不是仅收到 HTTP 200。
5. 分别验证快照、后续笔迹事件、图片下载，以及客户端上传。

## 真机验收证据与范围

- 原生右上角显示电脑设备编号、“已同步”、待同步 0。
- 从电脑发送临时笔迹和图片，在 iPad 真机画面确认两者显示；随后仅撤回测试对象。
- 用户用 Apple Pencil 画一笔，电脑画板显示该笔迹；电脑数据中保留 `pencilkit-v1` 原始数据。
- 修复采用相同 Bundle ID 覆盖安装，原配对从 Keychain 恢复，绘图数据保留。

这能证明基本双向笔迹同步与电脑图片下发。它不等于已经测量端到端延迟、验证长时间掌触、全部离线场景或 iPad 图片上传。个人截图、二维码、内网 IP、登录配置及 IPA 均未加入公开记录。
