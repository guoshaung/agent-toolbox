# 系统美化

入口：工具库 → 设备外观 → 系统美化。此工具是独立实现的 Toolbox 模块。

## 当前可用

- 批量导入 PNG / JPEG / WebP，本地解码后存为 PNG，按内容去重。
- 四套内置渐变配色；桌面、资源管理器和开始菜单三种预览。
- 选择窗口质感、底色、强调色、不透明度和模糊程度，保存与删除自己的主题。
- Windows 桌面壁纸手动应用与恢复；第一次应用前持久化原图备份，连续应用保留最初的恢复点。恢复操作成功后才清除恢复记录。
- 只读检测原版 MToolBox 2.1.0 宿主，验证宿主 SHA-256 后才查询协议与状态。

窗口质感、资源管理器和开始菜单目前是画面预览，没有向这些系统进程注入代码。壁纸应用使用 Windows `SystemParametersInfoW`，不会改字体、凭据或工具箱主题。

## 数据与接入

数据单独保存在 `userData/system-beauty/library.json`、`assets/`、`recovery/`。不读写主 `config.json`，也不写原版 MToolBox 的 `.mcfg` 或 `.mpkg`。所有新 IPC 仅接受 Toolbox 本地 renderer 页面。

主进程实现：`src/main/system-beauty.js`。原生桥：`src/main/system-beauty-native.ps1`。renderer：`src/renderer/tools/system-beauty/index.js`。原生桥为短时隐藏 PowerShell 子进程，不加载原版 DLL，也不安装服务或注册 COM。

恢复功能覆盖单张桌面壁纸。还没有实现多显示器独立壁纸、幻灯片或 Windows 聚焦模式的完整状态恢复。

## 后续原生效果

本机用户提供的 2.1.0 经 REA/Ghidra 静态分析，已确认消息窗口 `MHostProcess`：协议查询 `0x8048` 返回 2；状态查询 `0x804b`；`WM_COPYDATA` 的 `dwData=1001, cbData=0` 触发配置重载。读写配置使用 DMResV2 容器，尚未完成字段级编解码往返验证，因此没有暴露“应用原版主题”的按钮。不能把协议线索当作已经运行验证的集成。

后续优先评估独立开源引擎，通过用户显式操作安装/启用/卸载，保持引擎与界面分离。原软件本体、资源、用户配置与逆向快照不纳入仓库或安装包。

参考：

- [Windows SystemParametersInfoW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow)
- [ExplorerBlurMica](https://github.com/Maplespe/ExplorerBlurMica)
- [DWMBlurGlass](https://github.com/Maplespe/DWMBlurGlass)

## 验证

`node --test test/system-beauty.test.js test/app-controls.test.js`

测试覆盖素材重复导入与并发、错误图片、字段白名单、应用前备份、连续应用后的恢复、失败时保留恢复记录、空壁纸恢复、原生调用参数隔离及 IPC 来源校验。另有本机隔离 Electron 预览检查，覆盖真实图片解码、导入、保存、切换画面和布局；不触发实际壁纸写入。
