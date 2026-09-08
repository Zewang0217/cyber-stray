/**
 * clean-interest-graph 测试（#176）：隔离污染节点不丢、幂等、合法节点保留。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { cleanInterestGraphFile } from "./clean-interest-graph.js";

describe("cleanInterestGraphFile（存量图谱去污染）", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-graphclean-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function seedGraph(nodes: Array<Record<string, unknown>>): void {
    writeFileSync(
      join(dir, "user-interests.json"),
      JSON.stringify({ nodes, lastUpdated: "2026-09-07T00:00:00Z" }),
    );
  }

  it("污染节点隔离到 quarantine（不丢），合法节点保留", async () => {
    seedGraph([
      { id: "wallstreetcn.com", weight: 0.8, source: "feedback", reinforceCount: 3 },
      { id: "复古掌机", weight: 0.6, source: "reflection", reinforceCount: 2 },
      { id: "AI chip news September 2026", weight: 0.32, source: "reflection", reinforceCount: 0 },
    ]);

    const report = await cleanInterestGraphFile(join(dir, "user-interests.json"));
    expect(report.total).toBe(3);
    expect(report.kept).toBe(1);
    expect(report.quarantined).toBe(2);

    const cleaned = JSON.parse(readFileSync(join(dir, "user-interests.json"), "utf-8"));
    expect(cleaned.nodes).toHaveLength(1);
    expect(cleaned.nodes[0].id).toBe("复古掌机");

    const quarantine = JSON.parse(
      readFileSync(join(dir, "user-interests.quarantine.json"), "utf-8"),
    );
    expect(quarantine.map((n: { id: string }) => n.id).sort()).toEqual([
      "AI chip news September 2026",
      "wallstreetcn.com",
    ]);
    expect(quarantine[0].weight).toBeDefined(); // 全字段保留，可回捞
  });

  it("幂等：清洗后重跑 0 隔离，quarantine 追加不覆盖", async () => {
    seedGraph([{ id: "www.x.com", weight: 0.5, source: "feedback", reinforceCount: 1 }]);
    await cleanInterestGraphFile(join(dir, "user-interests.json"));
    // 再种一个污染节点（模拟清洗前旧备份回灌）+ 重跑
    const g = JSON.parse(readFileSync(join(dir, "user-interests.json"), "utf-8"));
    g.nodes.push({ id: "spam.cn", weight: 0.1, source: "reflection", reinforceCount: 0 });
    writeFileSync(join(dir, "user-interests.json"), JSON.stringify(g));

    const report2 = await cleanInterestGraphFile(join(dir, "user-interests.json"));
    expect(report2.quarantined).toBe(1);

    const q = JSON.parse(readFileSync(join(dir, "user-interests.quarantine.json"), "utf-8"));
    expect(q).toHaveLength(2); // 追加非覆盖
  });

  it("全合法图谱：零改动（nodes 引用原样，不产生 quarantine 文件）", async () => {
    seedGraph([
      { id: "科技", weight: 0.9, source: "default", reinforceCount: 5 },
      { id: "独立游戏", weight: 0.4, source: "feedback", reinforceCount: 1 },
    ]);
    const report = await cleanInterestGraphFile(join(dir, "user-interests.json"));
    expect(report.quarantined).toBe(0);
    expect(existsSync(join(dir, "user-interests.quarantine.json"))).toBe(false);
  });

  it("形状非法（nodes 非数组）→ 显式抛错", async () => {
    writeFileSync(join(dir, "user-interests.json"), JSON.stringify({ nodes: "oops" }));
    await expect(cleanInterestGraphFile(join(dir, "user-interests.json"))).rejects.toThrow(/形状非法/);
  });
});
