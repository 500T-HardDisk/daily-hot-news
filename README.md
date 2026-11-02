# 每日热点新闻（Daily Hot News）

在 VS Code 里刷当天的热点新闻：**16 个板块、纯文字、离线可读**，含 AI 与股市要闻、全球股市行情表、黄金涨跌原因与全球局势深度解读。

新闻数据随插件包一起分发（放在仓库的 `news/` 目录），安装后**不需要联网**，也不会调用任何第三方接口；维护者每天更新仓库中的新闻数据并发布新版本，用户升级插件即可看到最新内容。

> ⚠️ 仓库内当前的两天数据（2026-11-01 / 2026-11-02）用于演示数据结构和界面效果。正式上架前，请替换为你自己的真实新闻内容，并自行确认转载授权与来源标注。

---

## ✨ 功能

- **16 个板块**：科技、人工智能、财经、全球股市、**AI 与股市**、黄金行情、国际、全球局势、社会、体育、娱乐、健康、教育、汽车、游戏、文化
- **AI 与股市**：顶部固定 10 条重要新闻，下方 20 条细分要点，美股 AI 标的占比 ≥60%，覆盖已上市与拟上市公司
- **长文阅读**：每个板块约 1000 字，详情页支持分段正文、热点列表与数据表格
- **全球股市**：美股 / 港股 / A股 / 韩股行情表 + 热点罗列，表格结构固定，便于每日更新
- **黄金行情**：现货、期货、国内金价与美元、实际利率对照，并拆解当日涨跌原因
- **侧边栏浏览**：活动栏「热点新闻」图标 → 「今日热点」视图，分类标签 + 关键词搜索
- **详情面板**：点击任意新闻，在编辑器标签页中查看全文（支持「复制全文 / 只复制标题」）
- **日期切换**：默认展示最新一天；顶部下拉可跳转任意历史日期，另有「最新」按钮一键返回
- **历史永久保留**：`news/data/` 下的旧文件不会被删除，每次发布都包含全部历史新闻
- **状态栏入口**：状态栏显示 `📰 热点 N`，一键打开
- **完全离线**：数据来自插件自带 JSON，不发起网络请求
- **主题自适应**：颜色全部使用 VS Code 主题变量，自动适配明暗主题

## 🚀 使用

1. 安装插件后，点击左侧活动栏的 **热点新闻** 图标（报纸图标）。
2. 在「今日热点」中按分类浏览，或在搜索框输入关键词。
3. 点击标题 → 打开「热点头条」面板查看全文；也可点击右上角 `⤢` 直接在编辑器打开面板。
4. 查看历史新闻：顶部日期下拉框选择日期，或点击「最新」按钮返回最新一天。

### 🗓 历史新闻与日期跳转

- **默认最新**：每次打开侧边栏或面板，都展示 `news/index.json` 中最新日期，不会停留在上次查看的历史日期。
- **日期下拉**：列出全部可用日期，最新标为「最新」，前一天标为「昨天」，更早显示星期几。
- **回到最新**：查看历史日期时，标题栏会出现「最新」按钮，一键跳回。
- **命令跳转**：`热点新闻: 跳转到指定日期`，以 QuickPick 显示「最新 / 昨天 / N 天前」及历史提示。
- **永久保留**：`news/data/` 下的历史文件不会自动清理，每次发布都会全部打包；`news:validate` 会检查数据目录中未登记的文件。

### 命令（`Ctrl/Cmd + Shift + P`）

| 命令 | 说明 |
| --- | --- |
| `热点新闻: 打开热点头条面板` | 在编辑器标签页打开双栏面板 |
| `热点新闻: 跳转到指定日期` | QuickPick 选择日期，查看保留的历史新闻 |
| `热点新闻: 选择新闻分类` | QuickPick 快速跳转到某个分类 |
| `热点新闻: 搜索热点新闻` | 输入关键词并在侧边栏过滤 |
| `热点新闻: 刷新新闻数据` | 清除缓存并重新读取数据文件 |
| `热点新闻: 打开新闻数据文件` | 直接打开 `index.json` 或某天的数据文件 |
| `热点新闻: 关于与数据统计` | 查看数据日期、分类数、条数与数据目录 |

### 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `hotNews.defaultCategory` | `all` | 打开时默认选中的分类 id |
| `hotNews.summaryLines` | `2` | 列表中摘要显示行数（`0` 为隐藏） |
| `hotNews.localDataPath` | 空 | 指向本地 `news` 目录，便于维护时实时预览 |
| `hotNews.showStatusBar` | `true` | 是否显示状态栏入口 |

---

## 📁 数据结构

```
news/
├── index.json              # 分类定义 + 日期索引
└── data/
    ├── 2026-11-02.json     # 某一天的新闻
    └── 2026-11-01.json
```

### `news/index.json`

```json
{
  "version": 1,
  "updatedAt": "2026-11-02T07:55:00+08:00",
  "categories": [
    { "id": "tech", "name": "科技", "emoji": "💻", "description": "芯片、终端与通信" }
  ],
  "days": [
    { "date": "2026-11-02", "file": "data/2026-11-02.json", "counts": { "tech": 3 } }
  ]
}
```

> 分类数量必须 **≥ 10**；`id` 只能使用小写字母、数字与连字符，且需与数据文件中的键名一致。

### `news/data/YYYY-MM-DD.json`

```json
{
  "date": "2026-11-02",
  "updatedAt": "2026-11-02T07:55:00+08:00",
  "headline": "今日看点一句话概述",
  "categories": {
    "tech": [
      {
        "time": "07:10",
        "title": "新闻标题",
        "summary": "三到五句话的长文摘要，每个板块合计约 1000 字。",
        "source": "来源名称",
        "tags": ["芯片", "端侧"],
        "points": ["热点一：一句话要点。", "热点二：一句话要点。"],
        "highlights": [
          { "title": "要闻标题", "detail": "一句话说明", "market": "US", "stage": "listed", "ticker": "NVDA" }
        ],
        "pointItems": [
          { "text": "要点内容，建议 40 至 80 字。", "market": "US", "stage": "pre-ipo", "ticker": "" }
        ],
        "table": {
          "caption": "表格标题（可选）",
          "columns": ["市场", "指数", "收盘", "涨跌幅", "要点"],
          "rows": [["美股", "标普500", "6,842.31", "+0.58%", "科技股领涨"]]
        },
        "url": "https://example.com/optional"
      }
    ]
  }
}
```

字段说明：

- `title`：必填，纯文字。
- `summary`：推荐填写，侧边栏显示摘要、详情页正文；每个板块的文字量建议 ≥ 1000 字（标题 + 摘要 + 热点 + 表格文字）。
- `points`：可选，热点罗列，详情页以列表展示。
- `highlights`：可选，顶部重要新闻列表（AI 与股市固定 10 条），每条含 `title`、`detail`、`market`、`stage`、`ticker`。
- `pointItems`：可选，详细新闻要点（AI 与股市固定 20 条），每条含 `text`、`market`、`stage`、`ticker`。
- `table`：可选，结构化表格，详情页以可横向滚动的表格展示；`rows` 每行列数需与 `columns` 一致。
- `source` / `time` / `tags` / `url`：可选，`url` 仅用于复制，插件不会自动联网打开。
- 只有 `title` 非空的条目会被展示。

### 固定格式（全球股市 / 黄金）

为保证每天更新后展示一致，以下结构不要改动：

- `stocks`（全球股市）：必须包含 `table`，表头固定为 `市场 / 指数 / 收盘 / 涨跌幅 / 要点`，行首必须覆盖 `美股`、`港股`、`A股`、`韩股`；同时至少保留 3 条 `points` 热点。
- `aistocks`（AI 与股市）：`highlights` 固定 10 条、`pointItems` 固定 20 条；`market` 取 `US/HK/CN/KR/EU/JP/OTHER`，美股占比必须 ≥60%，且美股内容同时包含 `stage: listed`（已上市）与 `stage: pre-ipo`（拟上市）。
- `gold`（黄金行情）：建议保留行情表（`品种 / 最新价 / 日涨跌 / 说明`）与至少 3 条观察要点，并单列一条“涨跌原因”内容。
- `geopolitics`（全球局势）：覆盖中东、俄乌、美以等方向，板块文字量 ≥ 1000 字。

`npm run news:validate` 会校验上述结构；`--strict` 模式下字数不足也会失败。

---

## 🔄 每天更新流程（维护者）

```bash
# 1. 生成当天模板（自动同步 index.json）
npm run news:new
#   或指定日期
node scripts/new-day.mjs --date=2026-11-03

# 2. 编辑 news/data/2026-11-03.json，替换各分类的示例条目
#    要求：覆盖 16 个板块，每个板块约 1000 字；
#    AI 与股市保持 10 条 highlights + 20 条 pointItems，美股占比 ≥60%
#    美股/港股/A股/韩股行情表与黄金行情表保持既有列结构
#    注意：不要删除 news/data 下的旧日期文件，历史新闻需永久保留

# 3. 校验数据格式
npm run news:validate          # 严格模式：node scripts/validate-news.mjs --strict

# 4. 检查数据新鲜度
npm run news:freshness

# 5. 提交并发布新版本
git add news
git commit -m "news: 2026-11-03"
git push

# 6. 提升版本号并打包 / 发布
npm version patch --no-git-tag-version
npm run compile
npx vsce package           # 生成 .vsix
npx vsce publish           # 发布到 VS Code Marketplace
```

> 也可以直接把整理好的 JSON 手动覆盖到 `news/data/` 并更新 `news/index.json`，插件只依赖文件本身，不关心数据来源。

本地预览技巧：在插件设置中把 `hotNews.localDataPath` 指向仓库里的 `news` 目录，然后在 VS Code 中修改 JSON 并执行「刷新新闻数据」即可看到效果，无需重新打包。

### GitHub Actions

- `.github/workflows/validate-news.yml`：推送修改 `news/` 时自动校验数据格式与新鲜度。
- `.github/workflows/daily-news-reminder.yml`：每天北京时间 09:00 检查最新数据日期，落后超过 1 天会自动创建提醒 Issue。

---

## 🛠 本地开发

```bash
npm install
npm run compile      # 编译 TypeScript 到 out/
npm run watch        # 监听编译
```

在 VS Code 中按 `F5` 启动「运行扩展」，即可打开扩展开发宿主窗口调试。

```bash
npm test                 # 数据校验 + Webview 冒烟测试 + 宿主逻辑测试
```

- `scripts/validate-news.mjs`：校验数据格式（分类数、字段、日期一致性）
- `scripts/test-webview.mjs`：用 jsdom 验证列表、分类、搜索、详情与复制消息
- `scripts/test-host.cjs`：用 vscode API 模拟器验证激活、数据下发、命令与面板

```bash
node scripts/make-icon.mjs   # 重新生成 icon.png
```

## 📦 发布到 VS Code Marketplace

1. 注册 [Azure DevOps](https://dev.azure.com) 并创建 Personal Access Token（Marketplace → Manage 权限）。
2. 在 [Marketplace 管理页](https://marketplace.visualstudio.com/manage) 创建 publisher。
3. 修改 `package.json` 中的 `publisher`、`repository`、`bugs`、`homepage` 为你的真实信息（本项目已配置为 `500TSSD` / `https://github.com/500T-HardDisk/daily-hot-news`）。
4. 登录并发布：

```bash
npx vsce login 500TSSD
npx vsce publish
```

发布前检查清单：

- [ ] `displayName`、`description`、`README.md`、`CHANGELOG.md`、`LICENSE` 完整
- [ ] `icon.png` 为 128×128 PNG
- [ ] `news/index.json` 中至少 16 个分类、每板块约 1000 字，且最新日期为当天/昨天
- [ ] `npm run news:validate -- --strict` 通过
- [ ] `out/extension.js` 已编译（`vsce` 会自动执行 `npm run vscode:prepublish`）

## 🔒 隐私

- 插件不收集任何数据，不包含遥测，不发任何网络请求。
- 所有新闻内容随插件包分发，来源与版权由维护者负责；请在转载时注明来源。

## 📄 License

MIT
