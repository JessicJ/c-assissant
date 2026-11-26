import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Element = { type: any; props: Record<string, any> };
function elements(node: any): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}

function components() {
  const source = readFileSync(new URL("./LandiBlueprintWorkspace.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${source}\nexport { DetailPanel, EntrySources, ImageSource };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports: any = {};
  const jsx = (type: any, props: any) => ({ type, props });
  vm.runInNewContext(compiled, { exports, require(name: string) {
    return name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : {};
  } });
  return exports;
}

test("比较选项将完整事实与精确来源放在同一选项的全宽区，操作保持独立", () => {
  const exports = components();
  const factSources = [{ title: "开放时间原始资料", url: "https://example.test/opening", purpose: "inspiration", status: "verified", retrievedAt: "2026-11-01", summary: "仅供灵感，开放事实仍需核实" }];
  const rowSources = [{ title: "原选项证据", url: "https://example.test/option", purpose: "evidence", status: "stale", summary: "原选项独立资料" }];
  const selected: string[] = [], added: string[] = [];
  const detail = {
    title: "主题", placeId: "主题", heroMeta: [], leadTitle: "说明", leadBody: "原文",
    primaryActionLabel: "Background note", visitFacts: [], visitNotes: [], links: [], priorityActions: [],
    detailSections: [], guideContext: [], relatedEvents: [], sources: [], comparisonTitle: "比较",
    comparisonRows: [
      { id: "选项", name: "共享市场", area: "区域", routeFit: "Unknown", timing: "Unknown", effort: "Unknown", sourceState: "Inspiration · facts unverified", relatedPlaceId: "唯一地点", canAdd: true, facts: [{ label: "开放时间", value: "市场整体开放09:00–18:00，场次与预约仍未知", sources: factSources }], sources: rowSources },
      { id: "无关联", name: "未关联选项", area: "未知", routeFit: "Unknown", timing: "Unknown", effort: "Unknown", sourceState: "Evidence unavailable", sources: [] }
    ]
  };
  const tree = exports.DetailPanel({ detail, hidden: false, onSelect: (id: string) => selected.push(id), onAdd: (id: string) => added.push(id) });
  const groups = elements(tree).filter((node) => node.props?.role === "rowgroup");
  assert.equal(groups.length, 2);
  const group = elements(groups[0]);
  const evidence = group.find((node) => node.props?.className === "blueprint-comparison-evidence")!;
  assert.equal(evidence.props.children.props["aria-colspan"], 7);
  const evidenceNodes = elements(evidence);
  assert.ok(evidenceNodes.some((node) => node.props?.sources === factSources));
  assert.ok(evidenceNodes.some((node) => node.props?.sources === rowSources));
  assert.ok(evidenceNodes.some((node) => node.props?.className === "blueprint-comparison-fact" && node.props.children.includes(detail.comparisonRows[0]!.facts![0]!.value)));
  assert.equal(evidenceNodes.some((node) => node.type === "button"), false);
  const actions = group.find((node) => node.props?.className === "blueprint-comparison-actions")!;
  const buttons = elements(actions).filter((node) => node.type === "button");
  assert.equal(buttons.length, 2);
  buttons.forEach((button) => button.props.onClick());
  assert.deepEqual(selected, ["唯一地点"]);
  assert.deepEqual(added, ["唯一地点"]);
  assert.equal(elements(groups[1]).some((node) => node.type === "button"), false);
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const comparisonRules = [...css.matchAll(/([^{}]*\.blueprint-comparison[^{}]*)\{([^{}]*)\}/g)];
  assert.ok(comparisonRules.length > 0);
  for (const [, selector, declarations] of comparisonRules) {
    // 窄屏仅视觉隐藏表头，原 columnheader 仍保留给辅助技术。
    if (selector!.trim() === ".blueprint-comparison .blueprint-comparison-heading" && /overflow:\s*hidden/.test(declarations!)) {
      assert.match(declarations!, /position:\s*absolute/);
      assert.match(declarations!, /width:\s*1px/);
      assert.match(declarations!, /height:\s*1px/);
      assert.match(declarations!, /clip-path:\s*inset\(50%\)/);
      assert.doesNotMatch(declarations!, /display:\s*none|visibility:\s*hidden|ellipsis|nowrap/);
      continue;
    }
    assert.doesNotMatch(declarations!, /text-overflow:\s*ellipsis|overflow:\s*hidden/);
    // 操作按钮可保持短标签不拆词；事实、来源及其容器仍须允许换行。
    if (selector!.trim() !== ".blueprint-comparison-actions button") {
      assert.doesNotMatch(declarations!, /white-space:\s*nowrap/);
    }
  }
  const heading = elements(tree).find(node => node.props?.className === "blueprint-comparison-heading")!;
  assert.equal(heading.props["aria-hidden"], undefined);
  const headers = elements(heading).filter(node => node.props?.role === "columnheader");
  assert.equal(headers.length, 7);
  for (const rowGroup of groups) {
    const labeledCells = elements(rowGroup).filter(node => node.props?.["data-label"] !== undefined);
    assert.deepEqual(labeledCells.map(node => node.props["data-label"]), headers.slice(1, 6).map(node => node.props.children));
  }
  assert.match(css, /\.blueprint-comparison[^{}]*::before\s*\{[^}]*content:\s*attr\(data-label\)/);
  assert.match(css, /\.blueprint-comparison \[role="row"\] > \*\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.blueprint-comparison \.blueprint-comparison-evidence\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/s);
  assert.match(css, /\.blueprint-comparison \[role="row"\]\s*\{[^}]*min-width:\s*0;[^}]*grid-template-columns:\s*minmax\(0,1\.35fr\) minmax\(0,\.9fr\) repeat\(4,minmax\(0,1fr\)\) minmax\(0,\.8fr\)/s);
  assert.match(css, /\.blueprint-detail-sources a,\.blueprint-detail-sources span\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/s);
  const detailSourcesRule = css.match(/\.blueprint-detail-sources a,\.blueprint-detail-sources span\s*\{([^}]*)\}/)!;
  assert.doesNotMatch(detailSourcesRule[1]!, /ellipsis|nowrap|overflow:\s*hidden/);
  for (const selector of [".blueprint-detail-events a", ".blueprint-detail-guide-context a", ".blueprint-entry-sources"]) {
    const declarations = css.slice(css.indexOf(`${selector} {`)).split("}")[0]!;
    assert.match(declarations, /white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/s);
    assert.doesNotMatch(declarations, /ellipsis|nowrap|overflow:\s*hidden/);
  }
  assert.doesNotMatch(css, /\.blueprint-detail-image-source/);
  for (const selector of [".blueprint-image-source", ".blueprint-image-source[open] > .blueprint-entry-sources", ".blueprint-detail-image figcaption", ".blueprint-image-source summary [role=tooltip]"]) {
    const declarations = css.slice(css.indexOf(`${selector} {`)).split("}")[0]!;
    assert.doesNotMatch(declarations, /position:\s*absolute|[;{]\s*(?:top|bottom):|[;{]\s*width:\s*\d+px/);
  }
  assert.match(css, /\.blueprint-image-source:not\(\[open\]\) summary:hover \[role=tooltip\],\.blueprint-image-source:not\(\[open\]\) summary:focus-visible \[role=tooltip\]/);
});

test("图片摘要以合法非交互行内结构复用完整来源元数据，展开保留原链接", () => {
  const { EntrySources, ImageSource } = components();
  const sources = [
    { label: "图片资料", title: "商家原始图片说明", url: "https://example.test/photo", purpose: "inspiration", status: "recheck", retrievedAt: "2026-11-01", summary: "原始图片说明与时效" },
    { label: "来源用途未知", summary: "无检索时间" },
    { label: "过期事实资料", url: "https://example.test/old", purpose: "evidence", status: "stale", retrievedAt: "2025-01-01", summary: "已过期须核对" }
  ];
  const text = (node: any): string => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
  for (const source of sources) {
    const inline = EntrySources({ sources: [source], inline: true });
    const linked = EntrySources({ sources: [source] });
    assert.equal(text(inline), text(linked));
    assert.ok(elements(inline).every((node) => node.type === "span"));
    assert.equal(linked.type, "div");
    assert.ok(elements(linked).some((node) => node.type === "small"));
    assert.equal(elements(linked).filter((node) => node.type === "a").length, source.url ? 1 : 0);
    if (source.url) assert.equal(elements(linked).find((node) => node.type === "a")!.props.href, source.url);
    const image = ImageSource({ source });
    const summary = elements(image).find((node) => node.type === "summary")!;
    const preview = elements(summary).find((node) => node.type === EntrySources)!;
    assert.equal(preview.props.inline, true);
    assert.equal(preview.props.sources[0], source);
    const expanded = image.props.children.find((node: Element) => node.type === EntrySources)!;
    assert.equal(expanded.props.inline, undefined);
    assert.equal(expanded.props.sources[0], source);
  }
  assert.match(text(EntrySources({ sources: [sources[0]], inline: true })), /商家原始图片说明 · Inspiration · recheck/);
  assert.match(text(EntrySources({ sources: [sources[1]], inline: true })), /Source purpose unknown · unknown · Freshness unknown/);
  assert.match(text(EntrySources({ sources: [sources[2]], inline: true })), /Evidence · stale/);
  assert.equal(text(EntrySources({ inline: true })), text(EntrySources({})));
  assert.equal(text(EntrySources({})), "Evidence unavailable · Freshness unknown");
});
