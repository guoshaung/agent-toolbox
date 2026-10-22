# 系统美化

入口：工具库 → 设备外观 → 系统美化。此工具是独立实现的 Toolbox 模块。

## 当前可用

- 二次元素材图鉴：截至 2026-10-22，收录官网当前预设包 16 项、美化包 16 项、文件夹背景 11 项、鼠标指针与图标 19 项，共 62 项；支持作品/角色/作者搜索、分类、12 项分页、作者署名和原站入口。
- 目录预览按需从公开文章封面缓存到本机，离线可看；不把效果截图当作人物或完整主题。源码只带目录元数据、来源链接，不打包或公开第三方画作。
- 可批量导入公开文章内的 8 张透明人物 PNG（古拉 6 张、白玉插画 1 张、Helltaker 1 张）；内容去重并逐张持久化，失败保留成功项。人物与配色可在窗口/桌面画面中搭配，手动应用壁纸时先合成完整 PNG，避免直接把透明立绘铺成桌面。
- 本机已正常登录官网下载并解析 13 套完整预设：Fubuki、流萤、基础6初音、LR橘子、LR精致、LR简洁、蓝色幻想、简单优雅、粉色爱恋、丽芙（华丽）、丽芙（常规）、洛天依、刻晴。新增去重素材 102 项（人物 48、底图 1、图标 53），保留原有 8 张人物。另 10 个仅提供网盘入口的包按用户要求停止处理。源码与安装包不包含这些第三方素材。
- 顶部本地预设按原包分组，保留封面、作者与来源；点“使用预设”载入自己的搭配主题。人物和底图分层预览，图标单独查看；可按类型、所属预设与名称筛选。导入不套用原包中的字体、账户或系统配置。
- 批量导入 PNG / JPEG / WebP / ICO / CUR，本地解码后存为 PNG，按内容去重；图标与指针只作图片素材，不自动替换系统图标或鼠标。
- 十二套原创渐变配色；桌面、资源管理器和开始菜单三种预览。
- 渐变可生成 FHD、QHD、4K、超宽屏 PNG 并加入素材库；应用渐变时自动生成壁纸，仍需用户点击应用。
- 素材列表使用小尺寸 WebP、懒加载和每页 48 张的分页，支持名称搜索；预览与应用仍使用原图。旧库可手动优化加载，不改变原图。
- 选择窗口质感、底色、强调色、不透明度和模糊程度，保存与删除自己的主题。
- 记住上次选择的已保存主题；删除未被主题或当前壁纸引用的素材。
- 便携主题包 `.toolbox-theme.json` 导入与导出：可包含独立的底图与人物 PNG、来源署名，新导入创建独立主题，不覆盖已有主题，不携带本地路径、主配置或恢复记录。
- 生成 DWMBlurGlass 标题栏配方和 ExplorerBlurMica 资源管理器配方；使用 UTF-16LE BOM 的 INI 文件供对应引擎手动导入，不自动安装或启用引擎。
- Windows 桌面壁纸手动应用与恢复；第一次应用前持久化原图备份，连续应用保留最初的恢复点。恢复操作成功后才清除恢复记录。
- Windows 应用深浅色、系统深浅色和透明效果的手动应用与恢复。三项默认“保持当前”，保存/导入/选择主题不触发系统写入；主题包可携带这些选择。
- Windows 11 22H2+ 可打开独立的原生云母/亚克力预览窗，使用当前底色与不透明度，关闭即退出；纯色用于对照。
- 刷新并选择普通应用窗口，手动应用或恢复圆角、标题栏深色与系统材质；不注入代码。窗口关闭后可清理对应恢复记录。
- 只读检测原版 MToolBox 2.1.0 宿主，验证宿主 SHA-256 后才查询协议与状态。

窗口质感、资源管理器和开始菜单目前是画面预览，没有向这些系统进程注入代码。壁纸应用使用 Windows `SystemParametersInfoW`，不会改字体、凭据或工具箱主题。

## 数据与接入

### 使用入口

在工具库的“设备外观”中打开“系统美化”，也可以直接搜索这个名称。首次打开不会改变桌面或 Windows 外观。

1. 顶部“已解析的完整预设”选择已安装的 13 套之一，载入人物与底图。“二次元素材图鉴”提供更多原站作品与公开人物图入口。自己的 PNG/JPEG/WebP 可在“我的素材”点击“从文件夹导入”，检查候选数量后导入；单次多选“＋ 导入图片”还支持 ICO/CUR。
2. 选择素材与配色，在“搭配主题”调整颜色、质感和透明度，点击“保存主题”。“全部 12 套配色”可展开更多原创渐变；主题包可带背景图片导出和重新导入。
3. “效果预览”用于搭配画面；“打开 Windows 原生材质预览”会另开自有预览窗口。点击“应用这张桌面壁纸”或“应用当前渐变壁纸”才改变桌面，可用“恢复原壁纸”恢复。
4. 若要调整实际窗口，在“指定窗口外观”刷新列表并选择目标，只更改需要的项目再点击应用；可恢复单个或全部已调整窗口。“Windows 原生外观”里的深浅色和透明效果也需要单独点击应用。
5. 已有 DWMBlurGlass/ExplorerBlurMica 的用户可使用“合并已有 INI”，保留其他引擎参数并另存新配置，之后在对应引擎里手动导入。Toolbox 不会自动安装或启用这些引擎。

本次专用主题包采用本机私有、只读的素材解析流程；产品界面尚未提供通用 `.mpkg` 导入器。Explorer 客户端图片背景暂不支持；当前预览与单窗 DWM 材质不代表完整全局背景引擎。恢复失败时保留自己的备份目录，按照界面提示重试；窗口关闭后可以显式清理其记录。

数据单独保存在 `userData/system-beauty/library.json`、`assets/`、`recovery/`。不读写主 `config.json`，也不写原版 MToolBox 的 `.mcfg` 或 `.mpkg`。所有新 IPC 仅接受 Toolbox 本地 renderer 页面。

受控解析接入 `beauty-prepared-packages.js` 只读取自己数据目录内的 `incoming/manifest.json` 与 SHA-256 命名 PNG。它验证清单格式、官方作品来源、数量、单文件大小、文件身份、非链接路径及内容哈希；未知配置字段丢弃。素材逐张持久化并保留跨包来源；重复运行保留用户编辑过的主题和当前选择。包封面单独存放，不当作人物或壁纸。原始下载包仅保留在本机 `packages/`，解析密钥、登录会话和原图不进入 Git 或应用归档。

`catalog/covers/` 存官网公开封面的本地 WebP 缩略图。下载仅允许策展目录中的 `https://dl.winmoes.com/uploads/` 图片，无 Cookie/Authorization，不跟随重定向；单文件流式上限 25 MB、20 秒超时、解码像素上限 4000 万，缓存最多 3 个并发。GIF 封面缓存为静态首帧，人物素材当前是静态 PNG。目录与人物保留原文链接及作者；便携主题包保留人物类型及已知来源署名，导入与打开目录都不会自动应用系统设置。

`thumbnails/` 只存列表用的小图。原图和缩略图按内容寻址且原子创建，重复导入不覆盖使用中的文件。每次新的壁纸应用周期创建独立备份，恢复后再次应用不会复制同一文件到自身。旧版本恢复记录仍可读取。

“从文件夹导入”先只读扫描并展示候选数、总大小、跳过项及最多 12 个相对文件名；用户点击“导入预览中的图片”后才写自己的素材库。扫描包含最多 3 层子目录，每次最多 120 张、源数据 256 MB、单张 25 MB；另有 4096 个目录项和 64 个目录的遍历上限。达到上限会明确提示只扫描了部分素材，可选择子目录继续。只接受 PNG/JPEG/WebP，实际图片签名与解码在导入时验证。

扫描跳过符号链接、目录联接，不沿它们递归。预览计划只在主进程内存中保存路径，renderer 仅持有随机 ID；15 分钟失效、单次使用，可取消或重新选择。导入前重新检查根目录身份、逐层链接及文件身份/大小/修改时间，读文件描述符后再次检查，文件被替换或改变则跳过。预览样本不带绝对路径。逐张持久化成功结果，单张失败继续其他图片，报告新增/重复/失败；不修改源文件、主配置或系统外观。文件夹导入不负责归档解压或 GIF 动画播放。

批量导入显示处理数量、当前图片与进度条，可在忙态下点击“停止后续导入”。当前图片解码与落盘完成后才停止，已经成功导入的素材保留，剩余数量另行显示。取消排队中的任务可在第一张之前停止。关闭或离开发起页面也停止后续处理；重启应用仍能读到之前逐张保存的结果。

`beauty-folder-jobs.js` 只保留一个活动/最近任务和一个预览。预览使用、进度查询和停止都绑定发起 WebContents/进程/帧及本地页面 URL，其他页面即使知道计划 ID 也不能读进度或停止。renderer 每 300 ms 仅轮询自己的任务，没有广播文件名；完成和销毁时停止轮询，进度更新只替换小面板。并发导入被拒绝，不打断现有导入；停止不删除源文件或已导入素材。

主进程实现：`src/main/system-beauty.js`。原生桥：`src/main/system-beauty-native.ps1`。renderer：`src/renderer/tools/system-beauty/index.js`。原生桥为短时隐藏 PowerShell 子进程，不加载原版 DLL，也不安装服务或注册 COM。

恢复功能覆盖单张桌面壁纸。还没有实现多显示器独立壁纸、幻灯片或 Windows 聚焦模式的完整状态恢复。

壁纸恢复记录的原路径和备份路径必须都是字符串，并同时为空或同时非空；缺失、不完整的记录在原生调用前拒绝并保留，不能被当成“恢复空壁纸”。读取当前壁纸返回无法识别的数据时也停止应用。新增窗口更改前检查恢复 ID 的格式与唯一性，避免损坏的重复 ID 导致另一个窗口的备份被覆盖或删除。

### Windows 原生外观

只读/写当前用户 `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize` 下的 `AppsUseLightTheme`、`SystemUsesLightTheme`、`EnableTransparency`，其他项无法通过 IPC 指定。字段依据微软的 [Windows 设置参考](https://learn.microsoft.com/en-us/windows/apps/develop/settings/settings-common)，主题通知参考微软 [Windows Settings DSC 实现](https://www.powershellgallery.com/packages/Microsoft.Windows.Settings/0.1.1-alpha/Content/Microsoft.Windows.Settings.psm1) 与 [WM_SETTINGCHANGE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-settingchange)。实现没有依赖或安装 DSC 模块。

应用前将所改字段的原值持久化到独立素材库的 `personalizationRecovery`。备份包含原 DWORD 类型与完整无符号值，原来不存在的值在恢复时删除；遇到不支持的原类型会在写入前停止。连续应用保留最早的恢复点，新更改字段追加各自的初始值，恢复只涉及这些字段。原生写入或恢复失败时保留记录以便重试。不会删除注册表键或改变其他键值。

修改后使用有超时的 `ImmersiveColorSet` 广播，不重启 Explorer。不处理系统策略、强制应用主题或每个应用的私有主题；部分窗口可能需要重新打开，透明效果也取决于系统与应用。夜间开发只在模拟接口和独立临时注册表键中测试写入，没有变更用户真实配色或透明效果。

### 独立原生材质预览

`beauty-native-preview.js` 使用安装版本 Electron 33.4.11 的 [`BrowserWindow.setBackgroundMaterial`](https://www.electronjs.org/docs/latest/api/browser-window#winsetbackgroundmaterialmaterial-windows)，只控制自己创建的预览窗口。亚克力/云母/纯色分别请求对应的 Windows 合成器材质；玻璃配方用亚克力进行原生对照，模糊强度由系统控制。所选背景图片仅显示在原搭配画面，原生材质使用 Windows 当前桌面环境。

预览不改主窗口、全局 `nativeTheme`、字体配置或其他进程；不加载第三方 DLL。新页面开启沙箱，没有 preload、Node 或 Toolbox API，拒绝新窗口、导航和权限请求；主题名称通过 `textContent` 显示。只复用一个预览窗口，失败时清理，窗口可独立关闭。

本机已在隐藏隔离预览窗上读取 `DWMWA_SYSTEMBACKDROP_TYPE=38`，确认亚克力/云母/纯色分别得到 `3/2/1`，与微软的 [DWM_SYSTEMBACKDROP_TYPE](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type) 一致。该检查验证材质请求被系统接受，实际视觉仍取决于系统透明效果、节能状态和窗口环境，不能据此声称资源管理器或全局窗口美化已生效。

### 指定窗口外观

`beauty-window-appearance.js` 与 `beauty-window-native.ps1` 只读写可读回的 DWM 属性 `20/33/38`（深色标题栏、圆角、系统材质）。依据微软 [DWMWINDOWATTRIBUTE](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute) 与 [DwmSetWindowAttribute](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmsetwindowattribute)。本机无法可靠读回 `34/35/36` 的颜色原值，因此没有提供这些属性的应用操作。

界面只接收主进程枚举的候选 ID。每次操作校验窗口句柄、PID、进程创建时间、进程名和窗口类；首次绑定还核对标题，之后使用固定属性名和随机值标记窗口，防止恢复时误用已经复用的句柄。标记通过微软 [SetPropW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setpropw) / [GetPropW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getpropw) / [RemovePropW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-removepropw) 管理，只删除自己的标记。更高完整性级别的窗口可能拒绝操作，不自动提权。

窗口恢复数据单独保存在 `userData/system-beauty/window-appearance/windows.json`，最多 32 条，包含原值与窗口身份，不进入便携主题包或主配置。写原值与绑定意图落盘后才改变窗口；连续应用保留初始值并追加新字段。恢复成功后先持久化 `restored` 阶段，再删除标记和记录，磁盘失败后重试不会重新写其他窗口。原生失败保留备份，未绑定且属性未变的失败操作可直接结束恢复。

“恢复全部已调整窗口”仅在手动点击后运行，与应用、单项恢复共用同一串行队列。它对点击时已有的每条记录依次做原身份/标记校验，恢复各自原值并清理自己的标记；一项失败不影响其他项，结果显示成功数量及每项失败原因。关闭、身份变化、权限失败或损坏的记录保留，仍可逐项重试或对已关闭窗口显式清理。空列表不产生文件或原生调用。重复恢复 ID 在原生写入前拒绝，不会因一次恢复删掉另一个窗口的备份。

窗口列表排除桌面、任务栏、安全/系统宿主；Explorer 仅允许文件窗口类。窗口自绘、非透明客户端或应用主动重置外观可能使材质不明显。这些操作不创建自动重应用规则、不注册 DLL、不绘制 Explorer 客户端背景，不等同于完整全局美化引擎。

原生助手从 asar 复制到每次调用独立的临时目录，用 base64 JSON 参数运行；完成后清理，不触碰系统配置。夜间真实写入只在新建的隐藏 Electron 测试窗口上进行，并验证原值恢复、标记清除、错误标记拒绝与已关闭窗口记录清理。

## 后续原生效果

本机用户提供的 2.1.0 经 REA/Ghidra 静态分析，已确认消息窗口 `MHostProcess`：协议查询 `0x8048` 返回 2；状态查询 `0x804b`；`WM_COPYDATA` 的 `dwData=1001, cbData=0` 触发配置重载。读写配置使用 DMResV2 容器，尚未完成字段级编解码往返验证，因此没有暴露“应用原版主题”的按钮。不能把协议线索当作已经运行验证的集成。

后续优先评估独立开源引擎，通过用户显式操作安装/启用/卸载，保持引擎与界面分离。原软件本体、资源、用户配置与逆向快照不纳入仓库或安装包。

### 配方适配依据与限制

配方生成器 `src/main/beauty-recipes.js` 为独立实现，只输出公开配置字段，不包含上游代码或二进制。

- DWMBlurGlass 使用其 [Common.cpp 配置读取器](https://github.com/Maplespe/DWMBlurGlass/blob/e3a160c849c35415a4b959462815eebc6870270b/Common/Common.cpp) 与 [Common.h 枚举](https://github.com/Maplespe/DWMBlurGlass/blob/e3a160c849c35415a4b959462815eebc6870270b/Common/Common.h) 的字段约定：效果 `-1/0/2/3`、`blurMethod=0`、颜色为十进制 `0xAABBGGRR`。导出的 `applyglobal=false` 保持上游默认的作用范围。
- ExplorerBlurMica 使用 [公开 INI 说明](https://github.com/Maplespe/ExplorerBlurMica/blob/5fd0b0b83b3564f7d51c9be966ec190f5e70f0f9/README_ZH.md)：玻璃映射 `Blur(Clear)=3`、亚克力 `1`、云母 `2`；不支持纯色配方。
- 配方只映射颜色、不透明度、模糊程度和质感，不导出背景图片；浏览器 CSS 预览与原生渲染不能保证逐像素一致。
- “合并已有 INI”只读原配置，将当前主题的视觉字段合并后另存新文件；源文件及所有已有文件均无法被该操作覆盖（独占创建也拒绝硬链接、符号链接）。未知键、其他段、注释、字体等自定义项原文保留；`applyglobal`、`disableOnBattery`、`crossFade`、`blurMethod` 和 Explorer 工具栏开关等运行选项保留原值。
- 合并器 `src/main/beauty-ini.js` 接受严格 UTF-8（有/无 BOM）及带 BOM 的 UTF-16LE，保留编码与原有行尾。超过 1 MB、无 `[config]`、结构或编码无法可靠识别时拒绝，不猜测 ANSI/GBK。UTF-8 文件中非 ASCII 字段能否被第三方引擎正确读取取决于该引擎；需要 Win32 Unicode INI 的场景应事先使用 UTF-16LE。重复目标键全部更新，缺失项补到第一个匹配段，已通过 Win32 INI API 验证。
- INI 的 Windows API 读取已验证；本机没有安装或启用这些引擎，Windows 25H2 上的实际注入和画面效果尚未验证。
- 2026-10-22 检查的 ExplorerBlurMica 公开仓库缺少项目文件引用的部分核心实现，不能据此声称可以直接重编译完整引擎。

参考：

- [Windows SystemParametersInfoW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow)
- [ExplorerBlurMica](https://github.com/Maplespe/ExplorerBlurMica)
- [DWMBlurGlass](https://github.com/Maplespe/DWMBlurGlass)

## 验证

`node --test test/beauty-package-materials.test.js test/beauty-catalog.test.js test/system-beauty.test.js test/beauty-folder-import.test.js test/beauty-folder-jobs.test.js test/beauty-ini.test.js test/beauty-personalization.test.js test/beauty-native-preview.test.js test/beauty-window-appearance.test.js test/app-controls.test.js`

本轮相关测试共 103 项。新增覆盖 ICO/CUR 内嵌 PNG 与 DIB 调色板/透明遮罩、损坏范围拒绝、受控清单路径与哈希校验、按包去重及失败重试、保留原主题编辑与选择、双层便携主题往返。隔离 Electron 使用真实的 13 套解析素材验证分组、筛选、双层预览、图标查看和窄窗口布局，原生写入次数为 0。

测试覆盖素材重复导入与并发、错误图片、字段白名单、应用前备份、连续应用后的恢复、失败时保留恢复记录、空壁纸恢复、原生调用参数隔离及 IPC 来源校验。另有本机隔离 Electron 预览检查，覆盖真实图片解码、导入、保存、切换画面和布局；不触发实际壁纸写入。

主题包测试覆盖带图往返、重复素材去重、独立主题 ID、恶意/损坏输入拒绝、真实图片签名校验和本地路径隔离。原生配方测试包括 Windows `GetPrivateProfileStringW` 真实读取 UTF-16LE INI。界面检查覆盖导出、导入、原生配方导出及引用中素材的删除保护。

渐变生成测试使用真实 Sharp 编码与解码检查尺寸、格式和内容去重；旧库补小图时验证原图与主题引用保留。壁纸重复应用/恢复、失败恢复测试使用模拟原生接口，真实桌面不参与写入。界面检查另覆盖 70 张素材的分页和搜索，以及窄窗口布局。

原生外观测试覆盖分项应用、多次应用后的初始值保留、缺失值恢复、DWORD 边界、并发、磁盘失败、部分原生失败、备份篡改、主题包隔离与界面失败恢复。PowerShell 注册表适配器在唯一临时测试键中验证真实类型与缺失值往返，保留非目标值并拒绝未知字段，完成后删除临时键；该测试不发送全局主题通知。

原生预览测试覆盖系统版本判断、参数白名单、并发窗口复用、权限隔离、关闭与失败清理；隔离 Electron 检查还验证 DWM 属性、无特权页面、主题名称无 HTML 执行及关闭按钮。
