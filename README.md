# AI News Data

每日全球 AI 资讯数据仓库，由 GitHub Actions 定时抓取，供微信小程序（工具箱类）展示。

## 数据源

| 来源 | 类型 | 说明 |
|---|---|---|
| Hacker News | Algolia API | AI/LLM/GPT 等关键字检索，含点赞数、评论数，热度过滤（>=30 赞，48h 内） |
| TechCrunch | RSS | AI 分类（artificial-intelligence） |
| VentureBeat | RSS | AI 分类（ai） |
| The Verge | RSS | AI 分类（ai-artificial-intelligence） |
| 量子位 | RSS | 国内 AI 垂直媒体（qbitai.com） |
| 新智元 | RSS | 国内 AI 垂直媒体（aiera.com.cn） |

## 更新频率

每天 2 次（北京时间 00:30、12:30），由 `.github/workflows/fetch-ai-news.yml` 定时触发，数据有变化时自动提交。

## 数据文件

`data/daily/ai-news.json`，结构：

```json
{
  "generated_at": "2026-08-22T08:30:00.000Z",
  "count": 120,
  "status": { "hacker-news": 80, "techcrunch": 20, "venturebeat": 10, "the-verge": 10 },
  "items": [
    {
      "source": "hacker-news",
      "source_name": "Hacker News",
      "id": "hn-123456",
      "title": "...",
      "url": "https://...",
      "summary": "",
      "points": 123,
      "comments": 45,
      "author": "alice",
      "published_at": "2026-08-22T08:00:00.000Z",
      "published_ts": 1755849600000
    }
  ]
}
```

## 本地运行

```bash
node scripts/fetch-ai-news.js
```

## CDN 访问

- jsDelivr: `https://cdn.jsdelivr.net/gh/chenrongjian/ai-news-data@main/data/daily/ai-news.json`
- GitHub raw: `https://raw.githubusercontent.com/chenrongjian/ai-news-data/main/data/daily/ai-news.json`
