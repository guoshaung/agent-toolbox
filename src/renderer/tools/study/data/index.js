import algorithms from './algorithms.js';
import patterns from './patterns.js';
import transformer from './transformer.js';
import recsys from './recsys.js';
import llmSecurity from './llm-security.js';
import middleware from './middleware.js';
import mathNotation from './math-notation.js';
import oop from './oop.js';
import concurrency from './concurrency.js';
import cuda from './cuda.js';
import patternsPractice from './patterns-practice.js';

/**
 * 内置知识模块。加一个新领域：写一个同结构的 data/xxx.js，在这里 import 进来。
 * 用户自己加的模板存在 config 的 study.userTemplates 里，按 moduleId 归到对应模块下。
 * 模块可以有 templates（模板背诵）也可以有 scenarios（懒人模式的场景题，见 patterns-practice）。
 */
export const MODULES = [algorithms, patterns, patternsPractice, cuda, transformer, recsys, llmSecurity, middleware, mathNotation, oop, concurrency];

export const findModule = (id) => MODULES.find((m) => m.id === id);
