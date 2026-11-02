#!/usr/bin/env node
/**
 * 生成某一天的新闻数据模板，并同步写入 index.json。
 *
 * 用法：
 *   node scripts/new-day.mjs                 # 使用今天日期
 *   node scripts/new-day.mjs --date=2026-11-03
 *   node scripts/new-day.mjs --date=2026-11-03 --force   # 覆盖已存在的文件
 *
 * 生成后请直接编辑 news/data/<date>.json，把各分类下的示例条目替换为当天内容。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS = join(ROOT, 'news');
const INDEX_FILE = join(NEWS, 'index.json');

const args = process.argv.slice(2);
const force = args.includes('--force');
const dateArg = args.find((a) => a.startsWith('--date='));

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localIsoString(date = new Date()) {
  const pad = (n) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${localDateString(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

const date = dateArg ? dateArg.slice('--date='.length) : localDateString();

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`❌ 日期格式不正确：${date}（应为 YYYY-MM-DD）`);
  process.exit(1);
}
if (Number.isNaN(Date.parse(`${date}T00:00:00`))) {
  console.error(`❌ 无效日期：${date}`);
  process.exit(1);
}

if (!existsSync(INDEX_FILE)) {
  console.error(`❌ 未找到 ${INDEX_FILE}`);
  process.exit(1);
}

const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
if (!Array.isArray(index.categories) || !index.categories.length) {
  console.error('❌ index.json 中没有 categories，无法生成模板');
  process.exit(1);
}

const dayFile = join(NEWS, 'data', `${date}.json`);
if (existsSync(dayFile) && !force) {
  console.error(`❌ ${dayFile} 已存在。若确认要覆盖，请加 --force`);
  process.exit(1);
}

const categories = {};
for (const cat of index.categories) {
  if (cat.id === 'aistocks') {
    categories[cat.id] = [
      {
        time: '17:00',
        title: '（示例）AI 与股市：10 条要闻 + 20 条要点',
        summary:
          '请填写约 600 字综述：AI 资本开支、算力供需、上市公司业绩与拟上市公司融资/IPO 进程，并说明美股在其中的主导地位与主要风险。',
        source: '示例数据，不构成投资建议',
        tags: ['AI', '美股', 'IPO'],
        highlights: Array.from({ length: 10 }, (_, i) => ({
          title: `（示例）要闻 ${i + 1}：请填写标题`,
          detail: '请填写一句话说明，建议 30 至 60 字。',
          market: i < 8 ? 'US' : i === 8 ? 'HK' : 'CN',
          stage: i < 6 ? 'listed' : 'pre-ipo',
          ticker: '',
        })),
        pointItems: Array.from({ length: 20 }, (_, i) => ({
          text: `（示例）要点 ${i + 1}：请填写公司、事件与影响，建议 40 至 80 字。`,
          market: i < 15 ? 'US' : i < 17 ? 'HK' : 'CN',
          stage: i < 11 ? 'listed' : 'pre-ipo',
          ticker: '',
        })),
      },
    ];
    continue;
  }

  if (cat.id === 'stocks') {
    categories[cat.id] = [
      {
        time: '16:00',
        title: '（示例）全球股市收盘：美股 / 港股 / A股 / 韩股走势一览',
        summary:
          '请填写约 600 字的全球股市综述：先概述风险偏好与资金流向，再分别说明美股、港股、A股、韩股的表现与驱动因素。表格与热点列表的字段结构不要改动。',
        source: '来源名称',
        tags: ['美股', '港股', 'A股', '韩股'],
        table: {
          caption: '全球主要股指收盘表现（示例，请替换为真实数据）',
          columns: ['市场', '指数', '收盘', '涨跌幅', '要点'],
          rows: [
            ['美股', '标普500', '—', '—', ''],
            ['美股', '纳斯达克', '—', '—', ''],
            ['港股', '恒生指数', '—', '—', ''],
            ['港股', '恒生科技', '—', '—', ''],
            ['A股', '上证指数', '—', '—', ''],
            ['A股', '深证成指', '—', '—', ''],
            ['A股', '创业板指', '—', '—', ''],
            ['韩股', 'KOSPI', '—', '—', ''],
            ['韩股', 'KOSDAQ', '—', '—', ''],
          ],
        },
        points: [
          '热点 1：请填写当天美股的关键驱动（例如财报、通胀数据、美联储表态）。',
          '热点 2：请填写港股与南向资金的主要变化。',
          '热点 3：请填写 A 股成交额、领涨板块与情绪指标。',
          '热点 4：请填写韩股与半导体、出口数据相关的看点。',
        ],
      },
      {
        time: '16:20',
        title: '（示例）市场情绪与资金面：风险偏好处于什么位置',
        summary:
          '请补充约 400 字的资金面与情绪分析：北向/南向资金、ETF 申赎、波动率指数、板块轮动等，与上方表格形成互补。',
        source: '来源名称',
        tags: ['资金面', '情绪'],
      },
    ];
    continue;
  }

  if (cat.id === 'gold') {
    categories[cat.id] = [
      {
        time: '15:00',
        title: '（示例）黄金行情：现货、期货与国内金价一览',
        summary:
          '请填写约 500 字的行情描述：伦敦金、COMEX 期货、上海金的日内波动区间与成交情况，并说明与美元指数、实际利率的关系。',
        source: '来源名称',
        tags: ['现货黄金', '期货', '上海金'],
        table: {
          caption: '黄金与相关品种行情（示例，请替换为真实数据）',
          columns: ['品种', '最新价', '日涨跌', '说明'],
          rows: [
            ['现货黄金（XAU/USD）', '—', '—', ''],
            ['COMEX 黄金期货', '—', '—', ''],
            ['上海金（Au99.99）', '—', '—', ''],
            ['美元指数（DXY）', '—', '—', ''],
            ['10 年期美债收益率', '—', '—', ''],
          ],
        },
        points: [
          '短线支撑 / 阻力位：请填写关键价位。',
          '资金面：请填写黄金 ETF 持仓变化。',
          '风险提示：请填写需要关注的宏观数据或事件。',
        ],
      },
      {
        time: '15:30',
        title: '（示例）这一轮涨跌的原因拆解：利率、美元与避险需求',
        summary:
          '请填写约 600 字的归因分析：按“实际利率—美元—避险—央行购金—资金流”逐条拆解，并给出对后续走势的观察指标。避免只堆砌结论。',
        source: '来源名称',
        tags: ['涨跌原因', '实际利率', '避险'],
      },
    ];
    continue;
  }

  if (cat.id === 'geopolitics') {
    categories[cat.id] = [
      {
        time: '07:30',
        title: '（示例）中东局势：停火谈判与地区安全的进展',
        summary:
          '请填写约 400 字：谈判各方的核心诉求、斡旋方的最新表态、对能源与航运的影响，以及未来一周需要观察的信号。',
        source: '来源名称',
        tags: ['中东', '停火谈判'],
      },
      {
        time: '09:00',
        title: '（示例）俄乌局势：战场态势与外部援助的变化',
        summary:
          '请填写约 400 字：前线态势、武器与资金援助的节奏、制裁与能源议题，以及对欧洲安全格局的外溢影响。',
        source: '来源名称',
        tags: ['俄乌', '援助'],
      },
      {
        time: '10:30',
        title: '（示例）美以关系：军事协作与外交分歧',
        summary:
          '请填写约 400 字：双方在军事行动、人道议题与地区安排上的分歧，国内政治约束，以及对周边国家关系的影响。',
        source: '来源名称',
        tags: ['美国', '以色列', '外交'],
      },
    ];
    continue;
  }

  categories[cat.id] = [
    {
      time: '08:00',
      title: '（示例）请替换为当天该分类的第一条新闻标题',
      summary:
        '请填写约 350 字：事件的核心信息、关键数据、影响范围与后续观察点，避免只写一句结论。',
      source: '来源名称',
      tags: ['标签', '可选'],
    },
    {
      time: '12:00',
      title: '（示例）请替换为当天该分类的第二条新闻标题',
      summary:
        '请填写约 350 字：补充背景、相关方反应与可能的影响路径，与前一条形成信息层次。',
      source: '来源名称',
    },
    {
      time: '18:00',
      title: '（示例）请替换为当天该分类的第三条新闻标题',
      summary:
        '请填写约 350 字：给出更具体的细节或数据，并说明值得继续跟踪的指标。',
      source: '来源名称',
    },
  ];
}

const day = {
  date,
  updatedAt: localIsoString(),
  headline: `（示例）${date} 今日看点：请用一句话概括当天最重要的新闻。`,
  categories,
};

mkdirSync(join(NEWS, 'data'), { recursive: true });
writeFileSync(dayFile, `${JSON.stringify(day, null, 2)}\n`, 'utf8');

// 同步索引
index.days = Array.isArray(index.days) ? index.days : [];
const counts = {};
for (const cat of index.categories) {
  counts[cat.id] = categories[cat.id].length;
}

const existing = index.days.find((d) => d.date === date);
if (existing) {
  existing.file = `data/${date}.json`;
  existing.counts = counts;
} else {
  index.days.push({ date, file: `data/${date}.json`, counts });
}

index.days.sort((a, b) => String(b.date).localeCompare(String(a.date)));
index.updatedAt = localIsoString();
writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

console.log(`✅ 已生成 ${dayFile}`);
console.log(`✅ 已更新 ${INDEX_FILE}`);
console.log('\n下一步：');
console.log(`   1. 编辑 news/data/${date}.json，替换分类下的示例条目`);
console.log('   2. 运行 node scripts/validate-news.mjs --strict 校验');
console.log('   3. 提交并发布新版本插件，数据将随插件一起分发');
