# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [1.0.0] - 2026-11-02

### 新增

- 侧边栏「今日热点」视图：12 个分类标签、关键词搜索、日期切换。
- 编辑器「热点头条」双栏面板：列表 + 全文详情，支持复制全文 / 只复制标题。
- 状态栏入口：显示当天条数，点击打开面板。
- 命令：打开面板、选择分类、搜索新闻、刷新数据、打开数据文件、关于与统计。
- 配置项：`hotNews.defaultCategory`、`hotNews.summaryLines`、`hotNews.localDataPath`、`hotNews.showStatusBar`。
- 内置离线新闻数据：`news/index.json` + `news/data/YYYY-MM-DD.json`（12 类，多天）。
- 维护脚本：`news:new`（生成当天模板）、`news:validate`（数据校验）、`news:freshness`（新鲜度检查）、`icon`（生成图标）。
- GitHub Actions：数据校验与每日更新提醒。
