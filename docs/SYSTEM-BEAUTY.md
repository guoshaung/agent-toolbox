# 系统美化

入口：工具库 → 设备外观 → 系统美化。此工具是独立实现的 Toolbox 模块。

## 当前可用

- 批量导入 PNG / JPEG / WebP，本地解码后存为 PNG，按内容去重。
- 十二套原创渐变配色；桌面、资源管理器和开始菜单三种预览。
- 渐变可生成 FHD、QHD、4K、超宽屏 PNG 并加入素材库；应用渐变时自动生成壁纸，仍需用户点击应用。
- 素材列表使用小尺寸 WebP、懒加载和每页 48 张的分页，支持名称搜索；预览与应用仍使用原图。旧库可手动优化加载，不改变原图。
- 选择窗口质感、底色、强调色、不透明度和模糊程度，保存与删除自己的主题。
- 记住上次选择的已保存主题；删除未被主题或当前壁纸引用的素材。
- 便携主题包 `.toolbox-theme.json` 导入与导出：包含背景 PNG，新导入创建独立主题，不覆盖已有主题，不携带本地路径、主配置或恢复记录。
- 生成 DWMBlurGlass 标题栏配方和 ExplorerBlurMica 资源管理器配方；使用 UTF-16LE BOM 的 INI 文件供对应引擎手动导入，不自动安装或启用引擎。
- Windows 桌面壁纸手动应用与恢复；第一次应用前持久化原图备份，连续应用保留最初的恢复点。恢复操作成功后才清除恢复记录。
- Windows 应用深浅色、系统深浅色和透明效果的手动应用与恢复。三项默认“保持当前”，保存/导入/选择主题不触发系统写入；主题包可携带这些选择。
- 只读检测原版 MToolBox 2.1.0 宿主，验证宿主 SHA-256 后才查询协议与状态。

窗口质感、资源管理器和开始菜单目前是画面预览，没有向这些系统进程注入代码。壁纸应用使用 Windows `SystemParametersInfoW`，不会改字体、凭据或工具箱主题。

## 数据与接入

数据单独保存在 `userData/system-beauty/library.json`、`assets/`、`recovery/`。不读写主 `config.json`，也不写原版 MToolBox 的 `.mcfg` 或 `.mpkg`。所有新 IPC 仅接受 Toolbox 本地 renderer 页面。

`thumbnails/` 只存列表用的小图。原图和缩略图按内容寻址且原子创建，重复导入不覆盖使用中的文件。每次新的壁纸应用周期创建独立备份，恢复后再次应用不会复制同一文件到自身。旧版本恢复记录仍可读取。

主进程实现：`src/main/system-beauty.js`。原生桥：`src/main/system-beauty-native.ps1`。renderer：`src/renderer/tools/system-beauty/index.js`。原生桥为短时隐藏 PowerShell 子进程，不加载原版 DLL，也不安装服务或注册 COM。

恢复功能覆盖单张桌面壁纸。还没有实现多显示器独立壁纸、幻灯片或 Windows 聚焦模式的完整状态恢复。

### Windows 原生外观

只读/写当前用户 `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize` 下的 `AppsUseLightTheme`、`SystemUsesLightTheme`、`EnableTransparency`，其他项无法通过 IPC 指定。字段依据微软的 [Windows 设置参考](https://learn.microsoft.com/en-us/windows/apps/develop/settings/settings-common)，主题通知参考微软 [Windows Settings DSC 实现](https://www.powershellgallery.com/packages/Microsoft.Windows.Settings/0.1.1-alpha/Content/Microsoft.Windows.Settings.psm1) 与 [WM_SETTINGCHANGE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-settingchange)。实现没有依赖或安装 DSC 模块。

应用前将所改字段的原值持久化到独立素材库的 `personalizationRecovery`。备份包含原 DWORD 类型与完整无符号值，原来不存在的值在恢复时删除；遇到不支持的原类型会在写入前停止。连续应用保留最早的恢复点，新更改字段追加各自的初始值，恢复只涉及这些字段。原生写入或恢复失败时保留记录以便重试。不会删除注册表键或改变其他键值。

修改后使用有超时的 `ImmersiveColorSet` 广播，不重启 Explorer。不处理系统策略、强制应用主题或每个应用的私有主题；部分窗口可能需要重新打开，透明效果也取决于系统与应用。夜间开发只在模拟接口和独立临时注册表键中测试写入，没有变更用户真实配色或透明效果。

## 后续原生效果

本机用户提供的 2.1.0 经 REA/Ghidra 静态分析，已确认消息窗口 `MHostProcess`：协议查询 `0x8048` 返回 2；状态查询 `0x804b`；`WM_COPYDATA` 的 `dwData=1001, cbData=0` 触发配置重载。读写配置使用 DMResV2 容器，尚未完成字段级编解码往返验证，因此没有暴露“应用原版主题”的按钮。不能把协议线索当作已经运行验证的集成。

后续优先评估独立开源引擎，通过用户显式操作安装/启用/卸载，保持引擎与界面分离。原软件本体、资源、用户配置与逆向快照不纳入仓库或安装包。

### 配方适配依据与限制

配方生成器 `src/main/beauty-recipes.js` 为独立实现，只输出公开配置字段，不包含上游代码或二进制。

- DWMBlurGlass 使用其 [Common.cpp 配置读取器](https://github.com/Maplespe/DWMBlurGlass/blob/e3a160c849c35415a4b959462815eebc6870270b/Common/Common.cpp) 与 [Common.h 枚举](https://github.com/Maplespe/DWMBlurGlass/blob/e3a160c849c35415a4b959462815eebc6870270b/Common/Common.h) 的字段约定：效果 `-1/0/2/3`、`blurMethod=0`、颜色为十进制 `0xAABBGGRR`。导出的 `applyglobal=false` 保持上游默认的作用范围。
- ExplorerBlurMica 使用 [公开 INI 说明](https://github.com/Maplespe/ExplorerBlurMica/blob/5fd0b0b83b3564f7d51c9be966ec190f5e70f0f9/README_ZH.md)：玻璃映射 `Blur(Clear)=3`、亚克力 `1`、云母 `2`；不支持纯色配方。
- 配方只映射颜色、不透明度、模糊程度和质感，不导出背景图片；浏览器 CSS 预览与原生渲染不能保证逐像素一致。
- INI 的 Windows API 读取已验证；本机没有安装或启用这些引擎，Windows 25H2 上的实际注入和画面效果尚未验证。
- 2026-10-22 检查的 ExplorerBlurMica 公开仓库缺少项目文件引用的部分核心实现，不能据此声称可以直接重编译完整引擎。

参考：

- [Windows SystemParametersInfoW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow)
- [ExplorerBlurMica](https://github.com/Maplespe/ExplorerBlurMica)
- [DWMBlurGlass](https://github.com/Maplespe/DWMBlurGlass)

## 验证

`node --test test/system-beauty.test.js test/beauty-personalization.test.js test/app-controls.test.js`

测试覆盖素材重复导入与并发、错误图片、字段白名单、应用前备份、连续应用后的恢复、失败时保留恢复记录、空壁纸恢复、原生调用参数隔离及 IPC 来源校验。另有本机隔离 Electron 预览检查，覆盖真实图片解码、导入、保存、切换画面和布局；不触发实际壁纸写入。

主题包测试覆盖带图往返、重复素材去重、独立主题 ID、恶意/损坏输入拒绝、真实图片签名校验和本地路径隔离。原生配方测试包括 Windows `GetPrivateProfileStringW` 真实读取 UTF-16LE INI。界面检查覆盖导出、导入、原生配方导出及引用中素材的删除保护。

渐变生成测试使用真实 Sharp 编码与解码检查尺寸、格式和内容去重；旧库补小图时验证原图与主题引用保留。壁纸重复应用/恢复、失败恢复测试使用模拟原生接口，真实桌面不参与写入。界面检查另覆盖 70 张素材的分页和搜索，以及窄窗口布局。

原生外观测试覆盖分项应用、多次应用后的初始值保留、缺失值恢复、DWORD 边界、并发、磁盘失败、部分原生失败、备份篡改、主题包隔离与界面失败恢复。PowerShell 注册表适配器在唯一临时测试键中验证真实类型与缺失值往返，保留非目标值并拒绝未知字段，完成后删除临时键；该测试不发送全局主题通知。
