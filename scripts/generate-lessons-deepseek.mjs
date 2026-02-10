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

async function readKeyFallback() {
  // 允许用户在本机放一个不提交的密钥文件，避免在聊天里发送 Key。
  // 优先级：环境变量 > scripts/.deepseek_key > .env.local
  const keyFromEnv = process.env.DEEPSEEK_API_KEY;
  if (keyFromEnv) return keyFromEnv;

  const tryFiles = [
    path.resolve('scripts/.deepseek_key'),
    path.resolve('.env.local'),
  ];

  for (const p of tryFiles) {
    try {
      const raw = (await fs.readFile(p, 'utf8')).trim();
      if (!raw) continue;

      // scripts/.deepseek_key 允许直接放 key
      if (path.basename(p) === '.deepseek_key') return raw;

      // .env.local 支持 DEEPSEEK_API_KEY=...
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*DEEPSEEK_API_KEY\s*=\s*(.+)\s*$/);
        if (m) {
          return m[1].replace(/^['\"]|['\"]$/g, '').trim();
        }
      }
    } catch {
      // ignore
    }
  }
  return '';
}

const API_KEY = await readKeyFallback();
const BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

if (!API_KEY) {
  console.error('缺少 DeepSeek API Key。请用以下任意一种方式提供：\n' +
    '  1) 环境变量 DEEPSEEK_API_KEY（推荐）\n' +
    '  2) 在 scripts/.deepseek_key 文件中放一行 key（不会提交）\n' +
    '  3) 在 .env.local 中写 DEEPSEEK_API_KEY=...（不会提交）');
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

    const prompt = `你是一名小学科学老师，为“六年级下册（教科版）”制作【孩子自己能读懂】的每课预习卡（用于纯静态网页）。\n\n请输出一篇 Markdown（不要代码块包裹），结构必须包含以下小标题（## 级别）：\n\n## 预习目标（3条，动词开头，短句）\n## 关键词小卡片（4-5个词，每个≤12字解释）\n## 预习问题（3题：2题理解 + 1题生活化）\n## 安全小实验/观察（1个，材料家里常见，步骤≤4步，含安全提示）\n## 趣味拓展（2条，每条≤25字，偏生活应用/科学史冷知识）\n## 练一练（3题：1道选择 + 2道简答；难度中等；**在题目下方立即给出答案与简要解析**）\n\n【图片要求】在练一练后面加一行：unsplash: 描述词（英文，1-3个关键词，用来找合适的免费图片，如 "science experiment kids"）\n\n【长度要求】除标题外，正文总字数尽量控制在约 300–420 字，句子短、节奏快、读起来像“闯关卡”。\n\n【安全与真实】不编造教材页码与权威引用；不包含危险化学品/明火/密闭容器产气等操作；强调在家可安全完成。\n\n本课信息：\n- 单元：${unit || '（未提供）'}\n- 课题：${title}\n- 提示：${item.summaryHint ?? '无'}\n\n最后加一行：打印版提示（1句话）。`;

    console.log(`\n[${pad2(order)}] 生成：${title}`);

    const json = await postJson(`${BASE_URL}/v1/chat/completions`, {
      model: MODEL,
      messages: [
        { role: 'system', content: '你是严谨的中文科普写作者与小学科学教师。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    });

    let md = json?.choices?.[0]?.message?.content;
    if (!md || typeof md !== 'string') throw new Error('模型返回内容为空或格式不对');

    // Extract unsplash keyword from generated content
    let unsplashKeyword = '';
    const unsplashMatch = md.match(/unsplash:\s*([^\n]+)/i);
    if (unsplashMatch) {
      unsplashKeyword = unsplashMatch[1].trim();
      md = md.replace(/unsplash:[^\n]+\n?/i, '').trim(); // Remove the unsplash line from content
    }

    const fm = [
      '---',
      `title: "${title.replace(/\"/g, '”')}"`,
      unit ? `unit: "${unit.replace(/\"/g, '”')}"` : undefined,
      `order: ${order}`,
      item.keywords?.length ? `keywords: [${item.keywords.map((k) => `"${k.replace(/\"/g, '”')}"`).join(', ')}]` : undefined,
      unsplashKeyword ? `image: "https://source.unsplash.com/featured/?${encodeURIComponent(unsplashKeyword)}&sig=${order}"` : undefined,
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
