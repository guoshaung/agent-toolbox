'use strict';

/**
 * 教学幻灯片生成（第一版）：
 *  - 根据主题生成 5 页 storyboard（模板驱动，无 LLM 依赖，保证可离线/可测试）
 *  - 用 GPT Image 为每页生成一张 16:9 横向教学配图（并发默认 2，单张失败不拖垮）
 *
 * 不做 PPTX / 视频；后续可把模板 storyboard 换成 LLM 版本而不改对外接口。
 */

const IMAGE_MODEL = 'gpt-image-2';     // 网关可用模型（gpt-image-2.5-flare 需官方端点时配置）
const IMAGE_SIZE = '1536x864';         // 16:9 横向（1536/864 = 16:9，两边均可被 16 整除）
const IMAGE_QUALITY = 'medium';
const SLIDE_COUNT = 5;

/** 5 页 storyboard 模板（普通学术课结构，主题用占位符 {topic}）。 */
function slideBlueprint(topic) {
  return [
    {
      id: 'overview',
      title: '概述',
      bullets: [
        `介绍「${topic}」的动机与要回答的问题`,
        '使用场景：大学课堂 / 技术分享的引入页',
        '本节将按 背景 → 机制 → 流程 → 应用 展开',
      ],
      prompt: `学术教学幻灯片开场页视觉：关于「${topic}」的课程概述，大标题加简洁副标题，蓝色系扁平设计，清晰版式与留白，适合大学课堂，16:9 横向构图，文字少而精。`,
    },
    {
      id: 'background',
      title: '背景与核心概念',
      bullets: [
        `「${topic}」所处的上下文与相关概念`,
        '用一句话概括要讲透的核心定义/目标',
        '一张图说清术语之间的关系',
      ],
      prompt: `学术教学幻灯片「背景与核心概念」页视觉：围绕「${topic}」的关键概念关系图，节点与连线清晰展示术语层级，柔和渐变配色，适合大学课堂投屏，16:9 横向构图，无多余文字。`,
    },
    {
      id: 'mechanism',
      title: '核心机制',
      bullets: [
        `拆解「${topic}」最关键的工作原理`,
        '强调输入 → 处理 → 输出 的因果链',
        '用箭头标注关键环节的主次',
      ],
      prompt: `学术教学幻灯片「核心机制」页视觉：图解「${topic}」的工作原理，分层模块与箭头表示数据流，主次分明，蓝色为主、强调色点缀，适合大学课堂，16:9 横向构图。`,
    },
    {
      id: 'process',
      title: '流程与示例',
      bullets: [
        `给出「${topic}」的完整执行流程`,
        '配一个能一眼看懂的小示例',
        '标注每一步的输入输出',
      ],
      prompt: `学术教学幻灯片「流程与示例」页视觉：展示「${topic}」的分步流程图，横向步骤卡片加编号与箭头，配一个直观小示例图标，浅色背景清晰图表，适合大学课堂，16:9 横向构图。`,
    },
    {
      id: 'summary',
      title: '应用与小结',
      bullets: [
        `「${topic}」在实际场景中的典型应用`,
        '总结 3 个关键收获',
        '给出课后延伸方向',
      ],
      prompt: `学术教学幻灯片「应用与小结」页视觉：总结「${topic}」的应用场景与要点，三栏要点卡片加留白，收束感强，适合大学课堂结课页，16:9 横向构图，干净现代。`,
    },
  ];
}

/** 生成 5 页 storyboard。纯函数，可单测。 */
function generateStoryboard(topic) {
  const safeTopic = String(topic || '').trim() || '本主题';
  return slideBlueprint(safeTopic).map((slide) => ({
    id: slide.id,
    title: slide.title,
    bullets: slide.bullets,
    imagePrompt: slide.prompt,
    topic: safeTopic,
  }));
}

/**
 * 生成教学幻灯片：storyboard + 每页一张配图。
 * @param {string} topic
 * @param {object} options
 * @param {string} options.outputDir        图片输出目录
 * @param {object} options.imageClient      OpenAIImageClient 实例（apiKey 由调用方注入）
 * @param {number} [options.concurrency=2]
 * @param {string} [options.model]
 * @returns {Promise<{ok, storyboard, slides, outputDir, meta | error}>}
 */
async function generateTeachingSlides(topic, { outputDir, imageClient, concurrency = 2, model = IMAGE_MODEL, size = IMAGE_SIZE, quality = IMAGE_QUALITY } = {}) {
  if (!imageClient) return { ok: false, error: '缺少 imageClient' };
  if (!outputDir) return { ok: false, error: '缺少 outputDir' };
  const storyboard = generateStoryboard(topic);
  const started = Date.now();

  const perSlide = { model, size, quality, outputFormat: 'png', outputDir };
  const results = await imageClient.generateImages(
    storyboard.map((slide) => slide.imagePrompt),
    { concurrency, ...perSlide, filename: false },
  );

  const slides = storyboard.map((slide, index) => {
    const result = results[index] || { ok: false, error: '未执行' };
    return {
      ...slide,
      imageOk: Boolean(result.ok),
      filePath: result.meta?.filePath || null,
      error: result.error || null,
      elapsedMs: result.meta?.elapsedMs || null,
      usage: result.meta?.usage || null,
    };
  });

  const succeeded = slides.filter((s) => s.imageOk).length;
  return {
    ok: succeeded === storyboard.length,
    storyboard,
    slides,
    outputDir,
    succeeded,
    total: storyboard.length,
    meta: {
      model,
      size,
      quality,
      topic,
      elapsedMs: Date.now() - started,
    },
  };
}

module.exports = { generateStoryboard, generateTeachingSlides, SLIDE_COUNT, IMAGE_MODEL, IMAGE_SIZE };