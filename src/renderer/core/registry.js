import ask from '../tools/ask/index.js';
import docs from '../tools/docs/index.js';
import typing from '../tools/typing/index.js';
import focus from '../tools/focus/index.js';
import study from '../tools/study/index.js';
import settings from '../tools/settings/index.js';

/**
 * 工具注册表 —— 需求第 5 条「以后还要更多工具」就靠这里。
 * 加一个工具：写 tools/<id>/index.js，默认导出 { id, title, icon, create(root, ctx) }，
 * 然后在这个数组里加一行。详见 docs/ADD-A-TOOL.md。
 */
export const TOOLS = [ask, docs, typing, focus, study, settings];
