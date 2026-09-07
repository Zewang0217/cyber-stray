import { describe, expect, it } from "vitest";
import { isPlausibleTopic } from "./topic-validator.js";

describe("isPlausibleTopic（#176 话题准入）", () => {
  it("合法话题放行（中英/带连字符/短词组）", () => {
    expect(isPlausibleTopic("复古掌机")).toBe(true);
    expect(isPlausibleTopic("pixel art")).toBe(true);
    expect(isPlausibleTopic("中子星-黑洞并合")).toBe(true);
    expect(isPlausibleTopic("Black Hole Star")).toBe(true);
  });

  it("生产实证的污染形态全部拒绝", () => {
    // URL 域名节点（曾占最高权重 0.8）
    expect(isPlausibleTopic("wallstreetcn.com")).toBe(false);
    expect(isPlausibleTopic("www.ithome.com")).toBe(false);
    expect(isPlausibleTopic("https://example.com/post/1")).toBe(false);
    // 搜索 query 原句 / 搜索算子
    expect(isPlausibleTopic("AI chip news September 2026")).toBe(false);
    expect(isPlausibleTopic("site:ithome.com NVIDIA PAIR 本地AI")).toBe(false);
    expect(isPlausibleTopic("OpenAI Jalapeño chip 自研芯片 细节 架构")).toBe(false);
  });

  it("已知误杀锚定（宁枉勿纵的代价，评审 LOW-1）", () => {
    // 域名形态误伤技术名词；ASCII 冒号前缀误伤「标题: 正文」式话题。
    // 被拒话题下次以干净形态（去 .js 后缀写法等）仍可入图——这里固化代价清单
    expect(isPlausibleTopic("Node.js")).toBe(false);
    expect(isPlausibleTopic("lopsop: 讲道理")).toBe(false);
    expect(isPlausibleTopic("1.5")).toBe(false);
  });

  it("边界：空白拒、超长拒、单算子词拒", () => {
    expect(isPlausibleTopic("   ")).toBe(false);
    expect(isPlausibleTopic("a".repeat(41))).toBe(false);
    expect(isPlausibleTopic("site:")).toBe(false);
  });
});
