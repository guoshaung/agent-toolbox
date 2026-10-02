# 新增功能交付进度

实施目标：200 项功能，各自独立推送和创建 PR；学习 60、工具 100、娱乐 40。每个功能 PR 写明功能内容、必要性、实现方式、使用步骤、产出和具体使用例子，并记录验收边界。公共基础不计功能数量。已开 PR 不等于已经合并或发布。

## 当前状态

已提交功能 PR **28/200**：学习 8/60、工具 14/100、娱乐 6/40。其余 172 项尚未交付功能 PR，其中 L013、T009、L033、E024 正在独立 worktree 实现。目标仍在进行，不因本表记录一次进度而结束。

| 编号 | 功能 | 独立 PR | 状态 | 定向测试 |
|---|---|---|---|---|
| L002 | 例题步骤解封 | [#15](https://github.com/guoshaung/agent-toolbox/pull/15) | 已推送，待合并 | 9 项通过 |
| T002 | 表格脏数据清洗 | [#16](https://github.com/guoshaung/agent-toolbox/pull/16) | 已推送，待合并 | 19 项通过 |
| T038 | 文字配色对比度检查 | [#17](https://github.com/guoshaung/agent-toolbox/pull/17) | 已推送，待合并 | 6 项通过 |
| E002 | 扫雷 | [#18](https://github.com/guoshaung/agent-toolbox/pull/18) | 已推送，待合并 | 21 项通过 |
| L004 | 预测观察对账 | [#19](https://github.com/guoshaung/agent-toolbox/pull/19) | 已推送，待合并 | 9 项通过 |
| T081 | 跨时区会议窗口 | [#20](https://github.com/guoshaung/agent-toolbox/pull/20) | 已推送，待合并 | 24 项通过 |
| E004 | 管道接通 | [#21](https://github.com/guoshaung/agent-toolbox/pull/21) | 已推送，待合并 | 18 项通过 |
| T083 | 分摊账单结算 | [#22](https://github.com/guoshaung/agent-toolbox/pull/22) | 已推送，待合并 | 6 项通过 |
| T005 | 清单集合运算 | [#23](https://github.com/guoshaung/agent-toolbox/pull/23) | 已推送，待合并 | 6 项通过 |
| L011 | 指令流水线实验 | [#24](https://github.com/guoshaung/agent-toolbox/pull/24) | 已推送，待合并 | 11 项通过 |
| T006 | 日志事件时间线 | [#25](https://github.com/guoshaung/agent-toolbox/pull/25) | 已推送，待合并 | 21 项通过 |
| E006 | 汉诺塔 | [#26](https://github.com/guoshaung/agent-toolbox/pull/26) | 已推送，待合并 | 19 项通过 |
| T100 | 剪贴板内容分享净化 | [#27](https://github.com/guoshaung/agent-toolbox/pull/27) | 已推送，待合并 | 8 项通过 |
| L012 | 缓存命中实验 | [#28](https://github.com/guoshaung/agent-toolbox/pull/28) | 已推送，待合并 | 12 项通过 |
| E007 | 猜颜色密码 | [#29](https://github.com/guoshaung/agent-toolbox/pull/29) | 已推送，待合并 | 20 项通过 |
| L051 | 信心校准分析 | [#30](https://github.com/guoshaung/agent-toolbox/pull/30) | 已推送，待合并 | 7 项通过 |
| T004 | 正则抽取规则工坊 | [#31](https://github.com/guoshaung/agent-toolbox/pull/31) | 已推送，待合并 | 20 项通过 |
| T082 | 日期工作日计算 | [#32](https://github.com/guoshaung/agent-toolbox/pull/32) | 已推送，待合并 | 6 项通过 |
| L021 | 失败输入缩减器 | [#33](https://github.com/guoshaung/agent-toolbox/pull/33) | 已推送，待合并 | 15 项通过 |
| E021 | 禁词描述 | [#34](https://github.com/guoshaung/agent-toolbox/pull/34) | 已推送，待合并 | 23 项通过 |
| T003 | 两份数据集对账 | [#35](https://github.com/guoshaung/agent-toolbox/pull/35) | 已推送，待合并 | 23 项通过 |
| T087 | 采购规格单价比较 | [#36](https://github.com/guoshaung/agent-toolbox/pull/36) | 已推送，待合并 | 7 项通过 |
| L022 | 变异测试训练场 | [#37](https://github.com/guoshaung/agent-toolbox/pull/37) | 已推送，待合并 | 15 项通过 |
| T085 | 用电成本情景计算 | [#38](https://github.com/guoshaung/agent-toolbox/pull/38) | 已推送，待合并 | 7 项通过 |
| E023 | 动作猜词 | [#39](https://github.com/guoshaung/agent-toolbox/pull/39) | 已推送，待合并 | 24 项通过 |
| T008 | 数据字段字典生成 | [#40](https://github.com/guoshaung/agent-toolbox/pull/40) | 已推送，待合并 | 22 项通过 |
| T088 | 行李重量预算 | [#41](https://github.com/guoshaung/agent-toolbox/pull/41) | 已推送，待合并 | 7 项通过 |
| L023 | 分支覆盖探索 | [#42](https://github.com/guoshaung/agent-toolbox/pull/42) | 已推送，待合并 | 15 项通过 |

公共入口、发现与惰性加载、分类搜索、收藏最近使用及安全副本写入：[基础 PR #14](https://github.com/guoshaung/agent-toolbox/pull/14)。原仓库当前账号只有读权限，因此功能分支推送到 nightofknife 的 fork，PR 指向 guoshaung/agent-toolbox 的 main。先合入基础后再合入功能，避免入口缺失；不自动合并。

## 验收证据边界

二十八项功能的定向测试均通过；隔离集成分支按项目原有 CI 模式运行全量检查：910 项中 900 通过、10 跳过、0 失败。本机普通模式中，现有 Git Bash `source /dev/stdin` 用例因 `/dev/stdin: No such file or directory` 失败；该代码未在功能 PR 中修改，CI 跳过不等于已修复。

真实浏览器已完成 T002 五行清洗与 T038 三组配色／候选／报告检查，浏览器保存桥是替身。独立隐藏 Electron 33.4.11 窗口使用生产 preload、功能目录服务和实际 `wx` 写入器，完成以下流程：

- L002：三步练习、空白依据门槛、完整 3 条原始记录与 JSON 文件。
- T002：五行示例解析、清洗预览与 176 字节 UTF-8 副本。
- T038：普通/大文本分开判定与 1504 字节 JSON 报告。
- E002：指定局号首点、安全展开、暂停继续、完整输局与成绩文件。
- L004：锁定预测 10g、追加观察 13g，误差 3、相对偏差 30% 与完整账本文件。
- T081：伦敦 / 香港时间解析，7 个公共会议候选、含当地日期时间的邀请和窗口报告。
- E004：暂停遮住、恢复、固定示例 14 步通关与 9 格路径记录。
- T083：三人 100 元分摊，乙丙各向甲转 33.33 元建议及整数分报告；浏览器也检查了实际表格显示。
- T005：甲乙乙与乙丙得到交集乙，A 重复项原始第 2、3 行保留。
- L011：转发开 7 周期 / 1 停顿、关闭后 8 周期 / 2 停顿，最终 R2=12。
- T006：两日志 4 事件 / 1 未解析行 / 1 同刻组，归 UTC 后保留同刻来源顺序。
- E006：四层汉诺塔实际点击 15 步通关，暂停恢复及成绩文件。
- T100：URL 删除 utm_source、保留 order_id 与 hash；复制结果经 IPC 测试接收器捕获，未改系统剪贴板。
- L012：同块 miss/hit/hit、2/3 命中；LRU 第4/5步分别替换块2/0。
- E007：指定局号2293，ADAA反馈1/1，AABC第二轮通关，未完成DOM不含答案。
- L051：两条样例分数0.5且不画图；五条分数0.232，空箱为null，SVG四个非空点。
- T004：与主应用相同 CSP 下，file:// module Worker 在1秒超时终止后恢复；样例两条匹配及准确[8,18)偏移。

- T082：周三休假区间4工作日，向后4工作日推算至6月8日。
- L021：15次尝试缩减至[2,7]，逐元素删除证明1-minimal。
- E021：两轮7张不同卡，红队0分、蓝队2分，暂停遮题与完整报告。
- T003：示例新增1、移除1、修改1，修改路径/name保留。

- T087：默认40/35单价排序，双包含运费35并列，改输入废弃旧报告。
- L022：弱max测试2/3，手动添加第二测试后3/3，等价项排除。

- T085：基础15度/15元，分时待机17.85度，费用24.38/10.13及精确差−14.25。
- E023：150题中的局号demo两轮6唯一题，红1分、蓝2分并完整导出。
- T008：10行score数字8/null2，20%空值率，人工说明保留到报告。

- T088：超重1kg→移走2kg后余量1kg，未分配仍2kg；JSON恢复重算保持草案。
- L023：x=1分支50%，手动添加x=-1后100%，T2路径D1:false。

Electron 烟测的配置存储和保存目标是测试夹具，未操作原生保存对话框，不构成完整主应用、打包、macOS、触屏硬件或辅助技术验收。后续功能需各自验证，不能直接沿用上述二十八项通过结论。

完整规格见 [设计方案](FEATURE-EXPANSION-200.md)，代码接口和交付要求见 [实施约定](FEATURE-IMPLEMENTATION.md)。
