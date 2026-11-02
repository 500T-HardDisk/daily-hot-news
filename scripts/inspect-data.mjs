import { readFileSync } from 'node:fs';
const day = JSON.parse(readFileSync('news/data/2026-11-03.json', 'utf8'));
const index = JSON.parse(readFileSync('news/index.json', 'utf8'));
console.log('days:', index.days.map((d) => `${d.date}(${Object.values(d.counts).reduce((a, b) => a + b, 0)})`).join(', '));
for (const [id, items] of Object.entries(day.categories)) {
  if (!items.length) {
    console.log(`\n## ${id}: 0`);
    continue;
  }
  const lengths = items.map((i) => [...i.summary].length);
  console.log(`\n## ${id}: ${items.length} | 摘要 ${Math.min(...lengths)}-${Math.max(...lengths)} | URL ${items.filter((i) => /^https?:/.test(i.url)).length}/${items.length}`);
  for (const item of items.slice(0, 3)) {
    console.log(`- [${item.time}] ${item.title} (${[...item.summary].length}) ${item.source}`);
    console.log(`  ${item.summary.slice(0, 100)}…`);
    console.log(`  ${item.url}`);
  }
  if (items[0].table) console.log('  TABLE:', JSON.stringify(items[0].table));
}
