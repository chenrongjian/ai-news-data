/**
 * fetch-ai-news.js - 抓取全球 AI 资讯并输出静态 JSON
 *
 * 数据源：
 *   1) Hacker News Algolia API（免费无 key，返回 JSON，带点赞/评论数）
 *   2) TechCrunch AI 分类 RSS
 *   3) VentureBeat AI 分类 RSS
 *   4) The Verge AI 分类 RSS
 * 输出结构：data/daily/ai-news.json
 * 运行环境：GitHub Actions（Node 20，内置 fetch），由 .github/workflows/fetch-ai-news.yml
 *           每天 00:30 / 12:30（北京时间）定时触发
 */
const fs = require('fs');
const path = require('path');

/* ===== 配置 ===== */
const HN_KEYWORDS = [
  'AI', 'LLM', 'GPT', 'OpenAI', 'Anthropic', 'DeepSeek', 'Claude',
  'Gemini', 'machine learning', 'neural network', 'AGI', 'transformer'
];
const HN_WINDOW_HOURS = 48;        // 只取最近 48 小时的 HN 帖
const HN_MIN_POINTS = 30;          // 点赞数下限（过滤低热度）
const HN_PER_QUERY = 30;           // 每个关键字最多取多少条
const HN_MAX_TOTAL = 80;           // HN 最终最多保留多少条

const RSS_SOURCES = [
  { key: 'techcrunch', name: 'TechCrunch', feed: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { key: 'venturebeat', name: 'VentureBeat', feed: 'https://venturebeat.com/category/ai/feed/' },
  { key: 'the-verge', name: 'The Verge', feed: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' }
];
const RSS_MAX_PER_SOURCE = 20;
const CONTENT_MAX_CHARS = 6000;    // 正文纯文本最长保留字符数（控制数据文件体积）

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TIMEOUT = 20000;

// 带超时与重试的 fetch（Node 20 原生）
async function fetchText(url, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json, text/xml, application/rss+xml, */*' },
        signal: ctrl.signal,
        redirect: 'follow'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise(r => setTimeout(r, 3000 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/* ===== Hacker News ===== */
// 按关键字分别查询后合并去重，过滤窗口期与最低点赞数
async function fetchHackerNews() {
  const startTs = Math.floor(Date.now() / 1000) - HN_WINDOW_HOURS * 3600;
  const seen = new Map();
  const fetchOne = async (kw) => {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(kw)}&tags=story&numericFilters=points%3E%3D${HN_MIN_POINTS},created_at_i%3E%3D${startTs}&hitsPerPage=${HN_PER_QUERY}`;
    const text = await fetchText(url);
    const data = JSON.parse(text);
    for (const hit of data.hits || []) {
      if (!hit.title || seen.has(hit.objectID)) continue;
      seen.set(hit.objectID, {
        source: 'hacker-news',
        source_name: 'Hacker News',
        id: `hn-${hit.objectID}`,
        title: hit.title.trim(),
        url: hit.url && hit.url.startsWith('http') ? hit.url : `https://news.ycombinator.com/item?id=${hit.objectID}`,
        summary: '',
        content: (hit.story_text || '').trim().slice(0, CONTENT_MAX_CHARS),
        points: hit.points || 0,
        comments: hit.num_comments || 0,
        author: hit.author || '',
        published_at: hit.created_at || '',
        published_ts: (hit.created_at_i || 0) * 1000
      });
    }
  };
  await Promise.all(HN_KEYWORDS.map(fetchOne));
  const list = Array.from(seen.values())
    .sort((a, b) => b.points - a.points)
    .slice(0, HN_MAX_TOTAL);
  console.log(`[ok] hacker-news: ${list.length} 条`);
  return list;
}

/* ===== RSS / Atom 源 ===== */
// 兼容 RSS 2.0（<item>）与 Atom（<entry>），处理 CDATA 与 <link href> 属性形式
function parseFeed(xml) {
  const items = [];
  // Atom: <entry>...</entry>；RSS: <item>...</item>
  const entryRe = /<(?:entry|item)>([\s\S]*?)<\/(?:entry|item)>/gi;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const inner = tag => {
      const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const mm = block.match(re);
      if (!mm) return '';
      return mm[1];
    };
    // Atom 链接形式：<link rel="alternate" ... href="URL"/>；RSS 为 <link>URL</link>
    let link = '';
    const linkTag = block.match(/<link[^>]*>/i);
    if (linkTag) {
      const href = linkTag[0].match(/href\s*=\s*["']([^"']+)["']/i);
      if (href) link = href[1];
      else {
        const lm = block.match(/<link[^>]*>([^<]*)<\/link>/i);
        if (lm) link = lm[1].trim();
      }
    }
    const title = inner('title');
    const pubDate = inner('pubDate') || inner('updated');
    // 摘要：RSS 用 description，Atom 用 summary
    const description = inner('description') || inner('summary');
    // 正文：RSS 用 content:encoded（全文），Atom 用 content
    const contentRaw = block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i)
      ? block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i)[1]
      : inner('content');
    if (!link || !title) continue;
    items.push({ title, link, pubDate, description, contentRaw });
  }
  return items;
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')   // 先取出 CDATA 内容
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchRSS(source) {
  const text = await fetchText(source.feed);
  const raw = parseFeed(text);
  const list = raw.slice(0, RSS_MAX_PER_SOURCE).map((it, i) => {
    const ts = Date.parse(it.pubDate);
    const published = !isNaN(ts) ? new Date(ts).toISOString() : '';
    return {
      source: source.key,
      source_name: source.name,
      id: `${source.key}-${i}`,
      title: stripHtml(it.title),
      url: it.link,
      summary: stripHtml(it.description).slice(0, 200),
      // 正文优先取全文（content:encoded / atom content），无全文时回退完整摘要
      content: (stripHtml(it.contentRaw) || stripHtml(it.description)).slice(0, CONTENT_MAX_CHARS),
      points: 0,
      comments: 0,
      author: '',
      published_at: published,
      published_ts: isNaN(ts) ? 0 : ts
    };
  });
  console.log(`[ok] ${source.key}: ${list.length} 条`);
  return list;
}

/* ===== 主流程 ===== */
async function main() {
  const now = new Date();
  const generatedAt = now.toISOString();
  const results = [];
  const status = {};
  let failed = 0;

  // HN
  try {
    const hn = await fetchHackerNews();
    results.push(...hn);
    status['hacker-news'] = hn.length;
  } catch (e) {
    failed += 1;
    status['hacker-news'] = 0;
    console.error(`[fail] hacker-news: ${e.message}`);
  }

  // RSS
  for (const src of RSS_SOURCES) {
    try {
      const list = await fetchRSS(src);
      results.push(...list);
      status[src.key] = list.length;
    } catch (e) {
      failed += 1;
      status[src.key] = 0;
      console.error(`[fail] ${src.key}: ${e.message}`);
    }
  }

  // 统一按发布时间倒序（无时间的排最后，HN 无 summary 但有点赞）
  results.sort((a, b) => b.published_ts - a.published_ts);

  const out = {
    generated_at: generatedAt,
    count: results.length,
    status,
    items: results
  };

  const dir = path.join(__dirname, '..', 'data', 'daily');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai-news.json'), JSON.stringify(out, null, 2));
  console.log(`\n完成：共 ${results.length} 条资讯，失败 ${failed} 个源`);
  console.log(`状态：${JSON.stringify(status)}`);
  if (failed > 0 && results.length === 0) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
