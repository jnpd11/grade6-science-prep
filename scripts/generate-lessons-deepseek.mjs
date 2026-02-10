#!/usr/bin/env node
/**
 * 批量生成课程 markdown（用于静态站构建）。
 *
 * 设计目标：
 * - 不在网页端暴露 API Key
 * - 生成 src/content/lessons/*.md
 *
 * 用法：
 *   1) 准备大纲 JSON：scripts/outline.json
 *   2) 设置环境变量：DEEPSEEK_API_KEY
 *   3) 运行：npm run gen:deepseek
 *
 * 可选环境变量：
 *   DEEPSEEK_BASE_URL (默认 https://api.deepseek.com)
 *   DEEPSEEK_MODEL    (默认 deepseek-chat)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const OUTLINE_PATH = path.resolve('scripts/outline.json');
const OUT_DIR = path.resolve('src/content/lessons');

const API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

if (!API_KEY) {
  console.error('缺少环境变量 DEEPSEEK_API_KEY。请先在本机设置后再运行。');
  process.exit(1);
}

/** @param {string} url @param {any} body */
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${t.slice(0, 500)}`);
  }
  return res.json();
}

function safeSlug(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

async function main() {
  const outlineRaw = await fs.readFile(OUTLINE_PATH, 'utf8');
  /** @type {{order:number,title:string,unit?:string,summaryHint?:string,keywords?:string[] }[]} */
  const outline = JSON.parse(outlineRaw);

  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const item of outline) {
    const order = item.order;
    const title = item.title;
    const unit = item.unit ?? '';

    const filename = `${pad2(order)}-${safeSlug(title).slice(0, 48) || 'lesson'}.md`;
    const outPath = path.join(OUT_DIR, filename);

    const prompt = `你是一名小学科学老师，正在为“六年级下册 科教版”制作每课预习资料（纯静态网页）。\n\n请输出一篇 Markdown（不要代码块包裹），结构必须包含以下小标题（## 级别）：\n\n## 预习目标（3-5条，动词开头）\n## 关键词小卡片（5-8个词，每个用一句话解释）\n## 预习问题（3-6题，含1-2题生活化问题）\n## 安全小实验/观察（家庭可做，材料简单，有安全提示）\n## 趣味拓展（至少2条，课外知识/科学史/生活应用）\n## 练一练（3题，含选择/简答混合）\n\n要求：语言有趣但不幼稚；避免编造具体教材页码；不出现需要危险化学品/明火的操作；内容尽量和“测定/科学实验的公平/数据/误差”等科学方法相关联。\n\n本课信息：\n- 单元：${unit || '（未提供）'}\n- 课题：${title}\n- 提示：${item.summaryHint ?? '无'}\n\n另外请在文末加一段“打印版提示”（一句话）。`;

    console.log(`\n[${pad2(order)}] 生成：${title}`);

    const json = await postJson(`${BASE_URL}/v1/chat/completions`, {
      model: MODEL,
      messages: [
        { role: 'system', content: '你是严谨的中文科普写作者与小学科学教师。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    });

    const md = json?.choices?.[0]?.message?.content;
    if (!md || typeof md !== 'string') throw new Error('模型返回内容为空或格式不对');

    const fm = [
      '---',
      `title: "${title.replace(/\"/g, '”')}"`,
      unit ? `unit: "${unit.replace(/\"/g, '”')}"` : undefined,
      `order: ${order}`,
      item.keywords?.length ? `keywords: [${item.keywords.map((k) => `"${k.replace(/\"/g, '”')}"`).join(', ')}]` : undefined,
      '---',
      '',
    ].filter(Boolean).join('\n');

    await fs.writeFile(outPath, fm + md.trim() + '\n', 'utf8');
    console.log(`写入：${path.relative(process.cwd(), outPath)}`);
  }

  console.log('\n完成：已生成全部课程 markdown。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
