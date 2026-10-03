"""Validate and render the product design catalog; no application files are changed."""

from collections import Counter, defaultdict
from datetime import date
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCOPES = [
    ("learning.json", "学习", "L", 60, 6),
    ("tools.json", "工具", "T", 100, 10),
    ("entertainment.json", "娱乐", "E", 40, 4),
]
FIELDS = {
    "id", "category", "group", "name", "problem", "input", "output", "mvp",
    "acceptance", "dependencies", "mode", "priority", "complexity", "placement",
    "existing_relation",
}
PRIORITY = {"P0": 0, "P1": 1, "P2": 2}
SIZE = {"S": 0, "M": 1, "L": 2}
MODES = {"本地": 0, "AI可选": 1, "AI必需": 2, "外部运行时": 3}
NETWORK_TARGETS = {"T061", "T062", "T063", "T064", "T065", "T066", "T069"}


def cell(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def write(name, content):
    (ROOT / name).write_text(content.rstrip() + "\n", encoding="utf-8")


def main():
    features = []
    source_groups = {}
    for filename, category, prefix, count, groups_count in SCOPES:
        items = json.loads((ROOT / filename).read_text(encoding="utf-8-sig"))
        assert isinstance(items, list) and len(items) == count, (filename, len(items))
        expected_ids = {f"{prefix}{i:03d}" for i in range(1, count + 1)}
        assert {f["id"] for f in items} == expected_ids, filename
        groups = defaultdict(list)
        for item in items:
            assert set(item) == FIELDS, (item["id"], set(item) ^ FIELDS)
            for field in FIELDS - {"dependencies"}:
                assert isinstance(item[field], str) and item[field].strip(), (item["id"], field)
            assert item["category"] == category, item["id"]
            assert item["mode"] in MODES, item["id"]
            assert item["priority"] in PRIORITY, item["id"]
            assert item["complexity"] in SIZE, item["id"]
            assert isinstance(item["dependencies"], list), item["id"]
            assert all(isinstance(d, str) and d.strip() for d in item["dependencies"]), item["id"]
            groups[item["group"]].append(item)
        assert len(groups) == groups_count, (filename, len(groups))
        assert all(len(items) == 10 for items in groups.values()), filename
        # Two candidates from every group per wave preserve the full 6:10:4 split.
        # This is a proposed product sequence, not verified dependency scheduling.
        for group_items in groups.values():
            ranked = sorted(group_items, key=lambda f: (
                PRIORITY[f["priority"]], SIZE[f["complexity"]], MODES[f["mode"]],
                len(f["dependencies"]), f["id"],
            ))
            for index, feature in enumerate(ranked):
                feature["wave"] = index // 2 + 1
                feature["status"] = "待开发"
                feature["network"] = (
                    "访问用户指定目标" if feature["id"] in NETWORK_TARGETS else
                    "取决于可选AI供应商" if feature["mode"] == "AI可选" else
                    "运行无需联网"
                )
                feature["platform"] = (
                    "Windows优先，macOS需单独适配验证" if feature["id"] in {
                        "T017", "T070", "T074", "T075", "T077", "T078", "T079", "T080"
                    } else "Windows与macOS为设计目标，尚未实测"
                )
        source_groups[category] = groups
        features.extend(items)

    assert len(features) == 200
    assert len({f["id"] for f in features}) == 200
    names = Counter(f["name"] for f in features)
    assert all(n == 1 for n in names.values()), [n for n, v in names.items() if v > 1]
    for wave in range(1, 6):
        wave_counts = Counter(f["category"] for f in features if f["wave"] == wave)
        assert wave_counts == {"学习": 12, "工具": 20, "娱乐": 8}, (wave, wave_counts)

    counts = Counter(f["category"] for f in features)
    modes = Counter(f["mode"] for f in features)
    priorities = Counter(f["priority"] for f in features)
    sizes = Counter(f["complexity"] for f in features)
    networks = Counter(f["network"] for f in features)
    document = {
        "schemaVersion": 1, "createdOn": date.today().isoformat(),
        "baseline": {"version": "0.43.5", "commit": "0d945d8", "registeredEntrypoints": 38},
        "scope": "新增能力设计，尚未实现", "counts": dict(counts), "ratio": [6, 10, 4],
        "modes": dict(modes), "priorities": dict(priorities), "networkNeeds": dict(networks), "features": features,
    }
    write("catalog.json", json.dumps(document, ensure_ascii=False, indent=2))

    overview = [
        "# Agent 工具箱新增 200 个功能设计",
        "",
        "本提案新增学习 60 项、工具 100 项、娱乐 40 项，比例为 6∶10∶4。现有 38 个注册入口不计入新增数量。所有条目均为待开发设计，尚未进行实现或运行验证。",
        "",
        "每项功能都有输入、可用输出、最小交付范围和客观验收条件。同一个任务的格式、模板、配色和设置合并计数；扩展现有工具的条目明确说明新增能力。",
        "",
        "[详细规格](feature-planning/catalog.md) · [结构化目录](feature-planning/catalog.json) · [设计规则和技术边界](feature-planning/README.md) · [核对记录](feature-planning/review.md)",
        "",
        "## 数量与运行方式",
        "",
        "| 类别 | 新增功能 | 占比 | 模块数 |",
        "|---|---:|---:|---:|",
        "| 学习 | 60 | 30% | 6 |",
        "| 工具 | 100 | 50% | 10 |",
        "| 娱乐 | 40 | 20% | 4 |",
        "| 合计 | 200 | 100% | 20 |",
        "",
        "| 运行方式 | 项数 | 定义 |",
        "|---|---:|---|",
    ]
    meanings = {
        "本地": "计算与处理在本机，不需要 AI；主动网络诊断仍需访问用户指定目标。",
        "AI可选": "本地或手工路径可完成核心任务，AI 用于辅助。",
        "AI必需": "核心任务需要用户已配置的 AI 服务。",
        "外部运行时": "需要额外本机程序、模型或硬件环境。",
    }
    for mode in MODES:
        overview.append(f"| {mode} | {modes[mode]} | {meanings[mode]} |")
    overview.extend([
        "",
        f"运行方式与联网需求分开统计：{networks['运行无需联网']} 项核心任务设计为可离线运行，{networks['取决于可选AI供应商']} 项可选择 AI 辅助，{networks['访问用户指定目标']} 项需要主动访问指定网络目标。首次安装依赖或下载模型可能仍需网络；这些数字是设计目标，尚未验证。",
        "",
        f"优先级分布：P0 {priorities['P0']} 项，P1 {priorities['P1']} 项，P2 {priorities['P2']} 项。规模分布：S {sizes['S']} 项，M {sizes['M']} 项，L {sizes['L']} 项。分类是当前设计判断，可根据开发试验调整。",
        "",
        "## 界面组织与共享能力",
        "",
        "功能目录采用学习、工具、娱乐三类，内部按 20 个模块组织。保留现有工具 ID 和用户数据，复用现有工具作为执行位置，新增功能通过统一搜索、收藏、最近使用和输入类型筛选进入。模块名是导航分组，不意味着需要新增 20 个常驻窗口；200 项也不逐项进入侧栏。",
        "",
        "公共基础包括功能描述与路由、文件输入和输出预览、可取消的批处理、进度与逐项错误、依赖检测、版本化项目存储、AI 适配和内容预览。它们不占 200 项。各功能实现按现有生命周期挂载，后台任务离开面板后是否继续必须明确。",
        "",
        "先复用原生 JavaScript/CSS、现有 AI 门面和 preload 白名单。逐个实现后再形成稳定的公共组件；不为清单本身先做一次全项目框架重写。大文件和长任务使用受控后台执行，不能把后台进程或临时目录称为安全沙箱。",
        "",
        "## 分批交付",
        "",
        "设计分为 5 个候选批次，每批 40 项，均包含学习 12 项、工具 20 项、娱乐 8 项。每个模块每批选 2 项，先按 P0、较小规模、较少外部依赖排序。发布前需进行依赖核对，批次内可替换同类别条目，但总比例保持不变。",
        "",
        "| 批次 | 学习 | 工具 | 娱乐 | 合计 |",
        "|---|---:|---:|---:|---:|",
    ])
    for wave in range(1, 6):
        overview.append(f"| 第 {wave} 批 | 12 | 20 | 8 | 40 |")
    overview.extend([
        "",
        "批次是开发候选范围，不是工期或可行性承诺。每批只统计通过验收的功能；功能缺依赖、只有按钮或只有网页跳转时不计完成。首次交付先打通每类一个完整功能，确认交互、存储和后台任务边界，再扩展本批清单。",
        "",
        "## 完整功能清单",
        "",
        "P0 优先、P1 常规、P2 探索；S 小、M 中、L 大。每行中的箭头表示用户输入到产出，完整 MVP 和验收条件见详细规格。",
    ])
    for category, groups in source_groups.items():
        overview.extend(["", f"### {category}", ""])
        for group, group_items in groups.items():
            overview.extend(["", f"#### {group}", "", "| 编号 | 功能 | 输入与产出 | 运行方式 | 优先级与规模 | 批次 |", "|---|---|---|---|---|---:|"])
            for f in group_items:
                overview.append(f"| {f['id']} | {cell(f['name'])} | {cell(f['input'])} → {cell(f['output'])} | {f['mode']} | {f['priority']} / {f['complexity']} | {f['wave']} |")

    overview.extend(["", "## 第一批候选范围", "", "| 类别 | 编号与功能 |", "|---|---|"])
    for category in counts:
        first = [f"{f['id']} {f['name']}" for f in features if f["category"] == category and f["wave"] == 1]
        overview.append(f"| {category} | {'；'.join(first)} |")
    overview.extend([
        "", "## 每项交付的完成条件", "",
        "1. 使用典型输入完成其验收条件，产物可复制、保存、复用或继续操作。",
        "2. 处理空输入、无效输入、取消和依赖缺失，错误定位到具体文件或步骤。",
        "3. 本地处理功能断网可用；网络诊断如实报告观测范围，AI 可选功能能在不配置 API 时完成核心任务。",
        "4. 文件写入有明确目标和预览；原文件修改有回滚方式。",
        "5. Windows 上做真实界面与产物验证；承诺支持 macOS 的能力也完成对应验证。",
        "6. 算法和文件处理用有意义的样本检查，不以源码文本匹配替代用户流程验证。",
        "", "技术文档、跨平台限制和尚未选定的依赖参见[设计规则](feature-planning/README.md#技术依据与实施边界)。",
    ])
    (ROOT.parent / "FEATURE-EXPANSION-200.md").write_text("\n".join(overview) + "\n", encoding="utf-8")

    details = ["# 200 个新增功能详细规格", "", "本目录与设计 JSON 同步生成。所有条目均为待开发提案；输入输出、MVP 与验收条件共同定义计数范围。AI 和外部运行时的缺失需在实现时显式反馈。", "", "[总体设计](../FEATURE-EXPANSION-200.md) · [计数与运行规则](README.md)"]
    for category, groups in source_groups.items():
        details.extend(["", f"## {category}"])
        for group, group_items in groups.items():
            details.extend(["", f"### {group}"])
            for f in group_items:
                dependencies = "、".join(f["dependencies"]) or "无额外硬依赖，复用应用已有能力"
                details.extend([
                    "", f"#### {f['id']} {f['name']}", "",
                    f"{f['priority']} · {f['complexity']} · {f['mode']} · 候选第 {f['wave']} 批 · 待开发", "",
                    f"- 要解决的问题：{f['problem']}",
                    f"- 输入：{f['input']}", f"- 输出：{f['output']}",
                    f"- 最小交付范围：{f['mvp']}", f"- 验收条件：{f['acceptance']}",
                    f"- 硬依赖：{dependencies}", f"- 建议执行位置：{f['placement']}",
                    f"- 联网需求：{f['network']}；首次安装依赖另行确认。",
                    f"- 平台目标：{f['platform']}",
                    f"- 与现有能力的区别：{f['existing_relation']}",
                ])
    write("catalog.md", "\n".join(details))

    exact_duplicates = {}
    for field in ("name", "input", "output", "acceptance"):
        index = defaultdict(list)
        for f in features:
            index[f[field]].append(f["id"])
        exact_duplicates[field] = [ids for ids in index.values() if len(ids) > 1]
    write("validation.json", json.dumps({
        "total": len(features), "categoryCounts": dict(counts), "groupCount": sum(map(len, source_groups.values())),
        "uniqueIds": len({f['id'] for f in features}), "uniqueNames": len(names),
        "modeCounts": dict(modes), "priorityCounts": dict(priorities), "complexityCounts": dict(sizes),
        "networkNeeds": dict(networks),
        "exactDuplicateFields": exact_duplicates,
        "waves": [{"wave": n, "counts": dict(Counter(f['category'] for f in features if f['wave'] == n))} for n in range(1, 6)],
        "validationBoundary": "结构和计数检查，不证明语义去重、实现可行性或运行可用性",
    }, ensure_ascii=False, indent=2))
    print(json.dumps({"total": len(features), "categoryCounts": counts, "modes": modes, "priorities": priorities, "duplicates": exact_duplicates}, ensure_ascii=False))


if __name__ == "__main__":
    main()
