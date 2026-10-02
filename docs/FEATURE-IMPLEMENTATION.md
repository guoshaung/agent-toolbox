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

至少完成规格中可复现的验收样例和必要错误边界。带 UI 的功能还需浏览器交互检查；浏览器中注入 IPC 模拟桥的结果必须注明为渲染层验证。Electron 原生 IPC、文件对话框和打包适配应独立记录，不能混为已经验证。网络或外部运行时功能应另测依赖与失败状态。

运行 `npm run check` 以及各功能测试。现有 committed-import 检查读取 HEAD，因此还需在提交后跑导入检查。跨功能合并测试只能在隔离集成分支执行，不能把多个功能一起提交到单功能分支。
