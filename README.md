# 每日热点新闻（Daily Hot News）

在 VS Code 里刷当天的热点新闻：**12 个分类、纯文字、离线可读**。

新闻数据随插件包一起分发（放在仓库的 `news/` 目录），安装后**不需要联网**，也不会调用任何第三方接口；维护者每天更新仓库中的新闻数据并发布新版本，用户升级插件即可看到最新内容。

> ⚠️ 仓库内当前的两天数据（2026-11-01 / 2026-11-02）用于演示数据结构和界面效果。正式上架前，请替换为你自己的真实新闻内容，并自行确认转载授权与来源标注。

---

## ✨ 功能

- **12 个分类**：科技、人工智能、财经、国际、社会、体育、娱乐、健康、教育、汽车、游戏、文化
- **侧边栏浏览**：活动栏「热点新闻」图标 → 「今日热点」视图，分类标签 + 关键词搜索
- **详情面板**：点击任意新闻，在编辑器标签页中查看全文（支持「复制全文 / 只复制标题」）
- **日期切换**：内置多天数据时，可通过下拉框回溯往日内容
- **状态栏入口**：状态栏显示 `📰 热点 N`，一键打开
- **完全离线**：数据来自插件自带 JSON，不发起网络请求
- **主题自适应**：颜色全部使用 VS Code 主题变量，自动适配明暗主题

## 🚀 使用

1. 安装插件后，点击左侧活动栏的 **热点新闻** 图标（报纸图标）。
2. 在「今日热点」中按分类浏览，或在搜索框输入关键词。
3. 点击标题 → 打开「热点头条」面板查看全文；也可点击右上角 `⤢` 直接在编辑器打开面板。

### 命令（`Ctrl/Cmd + Shift + P`）

| 命令 | 说明 |
| --- | --- |
| `热点新闻: 打开热点头条面板` | 在编辑器标签页打开双栏面板 |
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
        "summary": "两到三句话的摘要，纯文字即可。",
        "source": "来源名称",
        "tags": ["芯片", "端侧"],
        "url": "https://example.com/optional"
      }
    ]
  }
}
```

字段说明：

- `title`：必填，纯文字。
- `summary`：推荐填写，侧边栏显示、详情页正文。
- `source` / `time` / `tags` / `url`：可选，`url` 仅用于复制，插件不会自动联网打开。
- 只有 `title` 非空的条目会被展示。

---

## 🔄 每天更新流程（维护者）

```bash
# 1. 生成当天模板（自动同步 index.json）
npm run news:new
#   或指定日期
node scripts/new-day.mjs --date=2026-11-03

# 2. 编辑 news/data/2026-11-03.json，替换各分类的示例条目
#    要求：至少覆盖 10 个分类

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
- [ ] `news/index.json` 中至少 10 个分类，且最新日期为当天/昨天
- [ ] `npm run news:validate -- --strict` 通过
- [ ] `out/extension.js` 已编译（`vsce` 会自动执行 `npm run vscode:prepublish`）

## 🔒 隐私

- 插件不收集任何数据，不包含遥测，不发任何网络请求。
- 所有新闻内容随插件包分发，来源与版权由维护者负责；请在转载时注明来源。

## 📄 License

MIT
