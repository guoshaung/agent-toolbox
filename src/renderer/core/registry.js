import ask from '../tools/ask/index.js';
import docs from '../tools/docs/index.js';
import typing from '../tools/typing/index.js';
import focus from '../tools/focus/index.js';
import study from '../tools/study/index.js';
import { codeTool as notebook, notesTool as notes } from '../tools/notebook/index.js';
import pet from '../tools/pet/index.js';
import history from '../tools/history/index.js';
import video from '../tools/video/index.js';
import research from '../tools/research/index.js';
import coach from '../tools/coach/index.js';
import terms from '../tools/terms/index.js';
import dock from '../tools/dock/index.js';
import skills from '../tools/skills/index.js';
import remote from '../tools/remote/index.js';
import settings from '../tools/settings/index.js';
import tasks from '../tools/tasks/index.js';
import container from '../tools/container/index.js';
import dsh from '../tools/dsh/index.js';
import tavern from '../tools/tavern/index.js';
import voicebox from '../tools/voicebox/index.js';
import digitalHuman from '../tools/digital-human/index.js';
import controls from '../tools/controls/index.js';
import appearance from '../tools/appearance/index.js';
import voice from '../tools/voice/index.js';
import gesture from '../tools/gesture/index.js';
import avatarRig from '../tools/avatar-rig/index.js';
import eat from '../tools/eat/index.js';
import api from '../tools/api/index.js';
import netlog from '../tools/netlog/index.js';
import git from '../tools/git/index.js';
import monologue from '../tools/monologue/index.js';
import tidy from '../tools/tidy/index.js';
import home from '../tools/home/index.js';

/**
 * 工具注册表 —— 需求第 5 条「以后还要更多工具」就靠这里。
 * 加一个工具：写 tools/<id>/index.js，默认导出 { id, title, icon, create(root, ctx) }，
 * 然后在这个数组里加一行。详见 docs/ADD-A-TOOL.md。
 */
export const TOOLS = [home, ask, docs, typing, focus, study, notebook, notes, tidy, api, git, netlog, monologue, eat, container, dsh, tavern, voicebox, digitalHuman, avatarRig, pet, history, video, research, coach, terms, dock, skills, remote, controls, appearance, voice, gesture, tasks, settings];
