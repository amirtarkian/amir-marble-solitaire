// Rewrites the solved-results table in README.md from web/public/data/solutions.json.
// Usage: bun scripts/update-readme.ts

const root = new URL("..", import.meta.url).pathname;
const sol = await Bun.file(`${root}web/public/data/solutions.json`).json();
const rows = [...sol.orbits]
  .sort((a: any, b: any) => a.best - b.best || a.rep.localeCompare(b.rep))
  .map((o: any) => {
    const holes = sol.holes.filter((h: any) => h.orbit === o.rep).map((h: any) => h.label).join(" ");
    return `| ${holes} | **${o.best}** | ${o.reachable.toLocaleString("en-US")} |`;
  });
const table = ["| Starting hole (and its mirror images) | Best | Reachable positions |", "|---|---|---|", ...rows].join("\n");
const path = `${root}README.md`;
const readme = await Bun.file(path).text();
const out = readme.replace(
  /<!-- solved-table:start -->[\s\S]*<!-- solved-table:end -->/,
  `<!-- solved-table:start -->\n${table}\n<!-- solved-table:end -->`,
);
await Bun.write(path, out);
console.log(table);
