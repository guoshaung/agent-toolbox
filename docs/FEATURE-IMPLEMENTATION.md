# 200 项功能实施约定

用户已确认 [200 项设计](FEATURE-EXPANSION-200.md)，实施目标为学习 60 项、工具 100 项、娱乐 40 项。设计目录保留为规格基线；其中“待开发”是制定方案时的状态，实际完成情况以各功能代码、验收记录和独立 PR 为准。

## 交付单位

每项功能单独一个分支、提交和 PR，标题包含设计编号。禁止把多个功能合成一个功能 PR。公共工作台和安全导出属于一个独立基础 PR，不占 200 项；功能 PR 在基础未合并时声明依赖，不自动合并 PR。

每个 PR 正文必须说明功能内容、为什么需要、实现方式、如何使用、使用后产出、具体可重现例子、验证结果和限制。`docs/features/<ID>.md` 是对应的长期使用文档，不把仅创建 PR 当作已合入或已发布。

## 文件布局与接口

每项实现拥有 `src/renderer/features/<ID>/`、`test/feature-<ID>.test.js` 和 `docs/features/<ID>.md`。算法建议用纯 `model.mjs`，界面使用现有 `h()` 和基础样式，用户数据必须作为文本或经过明确校验后渲染。

`meta.json` 只包含 `id/category/group/title/description`；编号为 L001–L060、T001–T100、E001–E040。分组沿用设计。`index.js` 默认导出 `{ id, create(root, ctx) }`，create 同步返回 `{ activate?, deactivate?, destroy? }`。create 准备界面，activate 才启动定时器或资源，deactivate 暂停，destroy 释放事件与资源。切换具体功能时会销毁旧面板，关闭整个工具时暂停当前面板。

主进程扫描随应用打包的目录，只有描述有效且带有 index.js 的功能才进入工作台，不动态执行用户提供的文件。渲染进程只惰性导入用户选中的实现。发现不等于运行验收，坏模块加载失败时隔离报错。

## 数据和文件

小设置通过 `ctx.config` 用 `featureLab` 或功能编号前缀保存。大型输入不写全局配置。功能需自行实现项目导入/导出及数据版本校验，不能假定生命周期保留所有未保存内容；需明确提示切换行为。

文本副本导出使用 `window.toolbox.files.saveText({ content, extension, defaultName, copyOnly: true })`。先检查 `window.toolbox.files.saveTextSupportsCopyOnly === true`；老版本缺能力时阻止导出并解释依赖。副本模式使用独占创建，已有目标不会被改写，包括用户选回原文件时。取消保存不报成功。

## 验证与进度

多文件恢复副本使用 `files.exportBundleSupportsCopyOnly === true` / `files.exportBundle({copyOnly:true,defaultName,files:[{path,base64,sha256}]})`。只接受1–100文件、每文件≤2MiB、总≤10MiB；相对路径禁止遍历、绝对路径、保留名称、大小写/NFC冲突和文件/目录前缀冲突。主进程先完整核验规范Base64与SHA-256，再由原生保存对话框选择新的目录名称，renderer不能指定任意目标路径；已存在目录拒绝。仅在独占创建的新目录写入，正常写入失败时清理该目录；进程崩溃/断电不提供事务恢复保证。`ok===true`才成功，清理失败返回`partialPath`供人工核对。完整验证和解密必须在调用前完成，接口不替代密码认证。浏览器桥缺失时禁用文件写入。

至少完成规格中可复现的验收样例和必要错误边界。带 UI 的功能还需浏览器交互检查；浏览器中注入 IPC 模拟桥的结果必须注明为渲染层验证。Electron 原生 IPC、文件对话框和打包适配应独立记录，不能混为已经验证。网络或外部运行时功能应另测依赖与失败状态。

运行 `npm run check` 以及各功能测试。现有 committed-import 检查读取 HEAD，因此还需在提交后跑导入检查。跨功能合并测试只能在隔离集成分支执行，不能把多个功能一起提交到单功能分支。

单文件二进制副本使用 `files.saveBinarySupportsCopyOnly === true` / `files.saveBinary({copyOnly:true,defaultName,base64,sha256})`。限10MiB（含空文件），主进程验证规范Base64及SHA-256后打开保存对话框，忽略renderer任意target/path；独占wx创建不覆盖已有文件。普通写入失败按文件身份清理本次新副本，身份改变/清理失败返回partialPath供人工核对；不保证断电/崩溃事务。二进制按原字节写出，不转UTF-8。此接口适用于分片重组超过目录接口每文件2MiB的单个副本；目录接口容量保持不变。

二进制接口验证：5项专属测试通过，隐藏Electron33.4.11生产preload/IPC/写入器实际保存5242880字节并逐字节及独立SHA核对，重复目标拒绝、坏摘要在对话框前拒绝。证据为隔离集成 `work/electron-smoke-1790970182457/result.json`；目标由测试对话框响应指定，未驱动系统对话框。

## 有限功能宿主接口

需要Node内置网络/文件能力的功能可包含自己固定的 `src/renderer/features/ID/host.cjs`，通过 `features.callHostSupported === true`、`features.callHost(id,operation,payload)` 及 `features.cancelHost(id,jobId)` 访问。主进程只加载当前有效catalog中对应ID下的已打包常规模块，拒绝symlink、目录越界、无效ID或超过256KiB的模块；renderer不能传任意模块/代码/磁盘路径让公共桥加载。模块必须提供 `invoke(operation,payload,{senderId})` 与 `cancel(jobId,{senderId})`，可用同步 `disposeSender(senderId)` 在窗口销毁时释放作业。

调用只允许本地file应用顶层窗口，operation及jobId有限格式，payload为有限JSON对象，≤64KiB、12层、5000节点；原型/非有限数字/循环/不可序列化值拒绝。桥不自动重试、发请求或信任用户任意后端。功能host自己负责具体操作、输入目标、用户确认、次数、期限、sender作业隔离、取消和权限范围；公共桥只传输，不能替代这些验证。异常对renderer返回通用失败，不暴露内部堆栈。

6项公共测试通过。T061在生产Electron33.4.11 / Node20.18.3中实际注册此桥，真实preload与workbench确认后调用固定DNS host；本地UDP夹具验证NXDOMAIN/A/AAAA/取消/超时，计划检查不发包，实际JSON/MD两新副本及已有文件拒绝。证据 `feature-T061/work/electron-T061-1790978687668/result.json`，未测外网DNS、系统保存对话框或安装包。公共基础接口不计入200个独立功能PR。
