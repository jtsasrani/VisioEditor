import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Play, Plus, ChevronLeft, ChevronRight, CornerDownRight, GitBranch, Flag,
  Download, Copy, Check, PanelLeftClose, PanelLeftOpen, Hand, Cpu, Trash2, Maximize2, Network, Hammer, Save, FilePlus2, Route, ExternalLink, Link2, Upload,
} from "lucide-react";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "loose",
  flowchart: { useMaxWidth: true, htmlLabels: true }
});

function MermaidView({ chart }) {
  const ref = useRef();

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = chart;
      ref.current.removeAttribute("data-processed");
      try {
        mermaid.run({
          nodes: [ref.current]
        });
      } catch (err) {
        console.warn("Mermaid parsing error:", err);
      }
    }
  }, [chart]);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", padding: "40px 20px", background: "#fff", boxSizing: "border-box", display: "flex", justifyContent: "center" }}>
      <div ref={ref} className="mermaid" style={{ width: "100%", maxWidth: "800px" }} />
    </div>
  );
}

import PROFILE from "./template-profile.json";

/* ------------------------------------------------------------------ *
 *  Guided Builder — author a flow one branch at a time.
 *  Start with a named start step, add a handful of steps, and when a
 *  decision appears you pick a branch and build/see just that side;
 *  switch to the other branch to build/see the other side. Produces a
 *  standard process graph -> exports to template-styled draw.io + Mermaid.
 * ------------------------------------------------------------------ */

const T = {
  rail: "#0F1830", railLine: "#27324E", railSoft: "#172238",
  paper: "#FBFAF7", panel: "#FFFFFF", line: "#E6E1D6",
  ink: "#15213B", inkSoft: "#3A465F", amber: "#D97706", amberSoft: "#FBE7C6",
  textDim: "#737B8E", inv: "#EAEEF8", invDim: "#8B97B6",
};
const mono = { fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" };
const sans = { fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" };

// node-type presentation for the builder view
const NT = {
  start:       { bg: "#efe1f5", bd: "#7030a0", fg: "#4a1d63", name: "Start" },
  process:     { bg: "#ffffff", bd: "#8a8a8a", fg: "#333333", name: "Process" },
  manual:      { bg: "#d6ecf7", bd: "#0e86b8", fg: "#0a4a63", name: "Manual" },
  decision:    { bg: "#f8d7d5", bd: "#b85450", fg: "#7a2320", name: "Decision" },
  information: { bg: "#fff7cc", bd: "#d6b656", fg: "#5a4a00", name: "Information" },
  end:         { bg: "#efe1f5", bd: "#7030a0", fg: "#4a1d63", name: "End" },
  step:        { bg: "#ffffff", bd: "#8a8a8a", fg: "#333333", name: "Step" },
};
const ADD_TYPES = ["process", "manual", "information", "decision", "end"];
// type -> accent colour, shared by the mind map and the paths view
const FILL = Object.fromEntries(Object.entries(NT).map(([k, v]) => [k, v.bd]));
const TYPE_TAG = FILL;
const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n) + "…" : String(s));
// word-set (Jaccard) similarity — flags likely duplicate step content
// filler words that inflate the union and hide real matches
const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "are", "was", "has", "have", "been", "its", "into", "onto", "per", "via", "not", "but", "all", "any", "can", "will", "shall", "must", "should", "may", "then", "when"]);
const normWords = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
// Similarity for duplicate detection. Pure Jaccard punishes length differences, so a
// half-typed step never matches its longer twin — we take the best of Jaccard and
// containment (how much of the shorter text is inside the longer) so partial typing matches.
function similarSteps(text, nodes, excludeId, k = 4, threshold = 0.34) {
  const a = new Set(normWords(text));
  if (a.size < 1) return [];
  const typed = String(text).trim().toLowerCase();
  const out = [];
  for (const n of nodes) {
    if (n.id === excludeId || !n.label) continue;
    const b = new Set(normWords(n.label));
    if (!b.size) continue;
    let inter = 0; for (const w of a) if (b.has(w)) inter++;
    if (!inter) continue;
    const uni = new Set([...a, ...b]).size;
    const jaccard = uni ? inter / uni : 0;
    const containment = inter / Math.min(a.size, b.size);
    const exact = typed === String(n.label).trim().toLowerCase();
    const score = exact ? 1 : Math.max(jaccard, containment * 0.9);
    if (score >= threshold) out.push({ n, score, exact });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, k);
}
let _uid = 0;
const uid = (p = "n") => `${p}${Date.now().toString(36).slice(-4)}${_uid++}`;
// Adapt an uploaded JSON export into the builder's graph model. Accepts either the app's native
// shape { title?, nodes:[{id,label|text,type?,branches?}], edges:[{from,to,label?}] }, or a flat
// array of shapes — with explicit from/to, or (last resort) reconstructed from x/y/width/height.
function adaptJson(data) {
  const typeMap = { start: "start", end: "end", decision: "decision", manual: "manual", information: "information", process: "process", step: "process" };
  const num = (v) => parseFloat(v) || 0;
  let nodes = [], edges = [], title = "Imported flow";
  const mkNode = (n, i) => ({ id: String(n.id != null ? n.id : "n" + i), label: String(n.label != null ? n.label : n.text != null ? n.text : "").trim() || "(unnamed)", type: typeMap[String(n.type || "").toLowerCase()] || "process", ...(Array.isArray(n.branches) ? { branches: n.branches } : {}) });

  if (data && !Array.isArray(data) && Array.isArray(data.nodes)) {
    // native graph
    title = data.title || title;
    nodes = data.nodes.map(mkNode);
    edges = (data.edges || []).map((e) => ({ from: String(e.from), to: String(e.to), label: e.label || "" }));
  } else if (Array.isArray(data) && data.length && data[0] && data[0].logical_step_id != null && data[0].step_type != null) {
    // universal process-flow export: step objects with logical ids, next-step ids and decision outcomes
    title = "Imported process";
    const btype = (it) => {
      const st = String(it.step_type || "").toLowerCase();
      if (st === "start") return "start";
      if (st === "end") return "end";
      if (st === "decision") return "decision";
      const at = String(it.actiontype || "").toLowerCase();
      if (at === "manual") return "manual";
      if (at === "info") return "information";
      return "process";
    };
    nodes = data.map((it) => ({ id: String(it.logical_step_id), label: String(it.step_text || "").trim() || "(unnamed)", type: btype(it) }));
    const idset = new Set(nodes.map((n) => n.id));
    for (const it of data) {
      const from = String(it.logical_step_id);
      const outcomes = it.decision_outcomes && typeof it.decision_outcomes === "object" ? it.decision_outcomes : null;
      if (outcomes && Object.keys(outcomes).length) {
        for (const [label, tgt] of Object.entries(outcomes)) {
          const to = tgt && (tgt.logical_step_id || tgt.id);
          if (to && idset.has(String(to))) edges.push({ from, to: String(to), label });
        }
        const nd = nodes.find((n) => n.id === from); if (nd) nd.branches = Object.keys(outcomes);
      } else {
        for (const to of it.next_logical_step_ids || []) if (idset.has(String(to))) edges.push({ from, to: String(to), label: "" });
      }
    }
  } else if (Array.isArray(data)) {
    const hasLinks = data.some((it) => it.from != null || it.source != null);
    if (hasLinks) {
      // explicit connectivity: split items into nodes vs edges
      nodes = data.filter((it) => it.from == null && it.source == null).map(mkNode);
      edges = data.filter((it) => it.from != null || it.source != null).map((it) => ({ from: String(it.from != null ? it.from : it.source), to: String(it.to != null ? it.to : it.target), label: it.label || it.text || "" }));
    } else {
      // geometry only: box-like or text-bearing shapes are nodes; the rest are connectors
      const isBox = (it) => num(it.width) >= 0.6 && num(it.height) >= 0.25;
      const nodeItems = data.filter((it) => (it.text && it.text.trim()) || isBox(it));
      const connItems = data.filter((it) => !((it.text && it.text.trim()) || isBox(it)));
      nodes = nodeItems.map((it, i) => ({ id: String(it.id != null ? it.id : "n" + i), label: String(it.text || "").trim() || "(unnamed)", type: "process" }));
      const centers = nodeItems.map((it, i) => ({ id: String(it.id != null ? it.id : "n" + i), x: num(it.x) + num(it.width) / 2, y: num(it.y) + num(it.height) / 2 }));
      const nearest = (x, y) => { let best = null, bd = Infinity; for (const c of centers) { const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = c; } } return best; };
      for (const c of connItems) {
        const x = num(c.x), y = num(c.y), w = num(c.width), h = num(c.height);
        const a = nearest(x, y), b = nearest(x + w, y + h);
        if (a && b && a.id !== b.id) edges.push({ from: a.id, to: b.id, label: String(c.text || "").trim() });
      }
    }
  }
  // clean, derive decision branches, normalise start id to "start"
  const ids = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  nodes.forEach((n) => { if (n.type === "decision") { const l = [...new Set(edges.filter((e) => e.from === n.id && e.label).map((e) => e.label))]; n.branches = l.length ? l : ["Yes", "No"]; } });
  let start = nodes.find((n) => n.type === "start") || nodes.find((n) => !edges.some((e) => e.to === n.id)) || nodes[0];
  if (start && start.id !== "start") { const old = start.id; nodes = nodes.map((n) => (n.id === old ? { ...n, id: "start" } : n)); edges = edges.map((e) => ({ ...e, from: e.from === old ? "start" : e.from, to: e.to === old ? "start" : e.to })); start = nodes.find((n) => n.id === "start"); }
  if (start && start.type === "process") start.type = "start";
  return { title, nodes, edges, startId: start ? start.id : "start", unlabeled: nodes.filter((n) => n.label === "(unnamed)").length };
}
// reachable node set following edges forward from a start id
function reachableFrom(graph, startId) {
  const seen = new Set(); if (!startId) return seen;
  const stack = [startId];
  while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); graph.edges.filter((e) => e.from === x).forEach((e) => stack.push(e.to)); }
  return seen;
}
// if all of a decision's branches eventually reach one common downstream node, return the nearest such join
function reconvergePoint(graph, decId) {
  const kids = graph.edges.filter((e) => e.from === decId).map((e) => e.to);
  if (kids.length < 2) return null;
  const sets = kids.map((k) => reachableFrom(graph, k));
  let common = [...sets[0]].filter((x) => x !== decId && sets.every((s) => s.has(x)));
  if (!common.length) return null;
  const depth = {}; const q = [[decId, 0]]; const seen = new Set();
  while (q.length) { const [x, d] = q.shift(); if (seen.has(x)) continue; seen.add(x); depth[x] = d; graph.edges.filter((e) => e.from === x).forEach((e) => q.push([e.to, d + 1])); }
  common.sort((a, b) => (depth[a] ?? 1e9) - (depth[b] ?? 1e9));
  return common[0];
}
// Change a node's type without losing decision structure. Leaving 'decision' stashes its
// branches; returning to 'decision' restores them — falling back to the labels on the node's
// existing outgoing edges, so the Yes/No -> child connections always come back.
function retypeNode(n, type, edges) {
  if (n.type === type) return { ...n, type };
  if (type === "decision") {
    const edgeLabels = [...new Set(edges.filter((e) => e.from === n.id && e.label).map((e) => e.label))];
    const stash = n._stashBranches;
    const branches = stash && stash.length ? stash
      : edgeLabels.length ? edgeLabels
      : n.branches && n.branches.length ? n.branches : ["Yes", "No"];
    const { _stashBranches, ...rest } = n;
    return { ...rest, type, branches };
  }
  if (n.branches && n.branches.length) {
    const { branches, ...rest } = n;
    return { ...rest, type, _stashBranches: branches };
  }
  return { ...n, type };
}

/* ---- graph helpers ---- */
const parentMap = (g) => { const m = {}; g.edges.forEach((e) => (m[e.to] = e.from)); return m; };
const childEdges = (g, id) => g.edges.filter((e) => e.from === id);
function pathTo(g, id) {
  const parent = parentMap(g); const chain = []; const seen = new Set(); let c = id;
  while (c && !seen.has(c)) { seen.add(c); chain.unshift(c); c = parent[c]; }
  return chain;
}
// decisions that still have an unbuilt branch
function openBranches(g) {
  const out = [];
  for (const n of g.nodes) {
    if (n.type !== "decision" || !n.branches) continue;
    const built = new Set(childEdges(g, n.id).map((e) => e.label));
    for (const b of n.branches) if (!built.has(b)) out.push({ node: n, branch: b });
  }
  return out;
}

/* ---- exports ---- */
const sid = (id) => "N" + String(id).replace(/[^a-zA-Z0-9_]/g, "");
const mmLabel = (s) => `"${String(s).replace(/"/g, "'")}"`;
function toMermaid(g) {
  let out = "flowchart TD\n";
  for (const n of g.nodes) {
    const l = mmLabel(n.label);
    const shape = n.type === "decision" ? `{${l}}`
      : n.type === "manual" ? `[/${l}/]`
      : n.type === "start" || n.type === "end" ? `([${l}])`
      : `[${l}]`;
    out += `  ${sid(n.id)}${shape}\n`;
  }
  for (const e of g.edges) out += `  ${sid(e.from)} -->${e.label ? `|${mmLabel(e.label)}|` : ""} ${sid(e.to)}\n`;
  return out;
}
// deterministic tree layout + template-styled draw.io
function layoutFlow(g) {
  const nodes = g.nodes, edges = g.edges;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const kids = {}, parents = {}, indeg = {};
  nodes.forEach((n) => { kids[n.id] = []; parents[n.id] = []; indeg[n.id] = 0; });
  edges.forEach((e) => { if (byId[e.from] && byId[e.to]) { kids[e.from].push(e.to); parents[e.to].push(e.from); indeg[e.to]++; } });
  // layer = longest path from any root, via Kahn topological order (handles multiple starts + merges)
  const layer = {}; nodes.forEach((n) => (layer[n.id] = 0));
  const deg = { ...indeg }, q = nodes.filter((n) => deg[n.id] === 0).map((n) => n.id), seen = new Set();
  while (q.length) {
    const id = q.shift(); if (seen.has(id)) continue; seen.add(id);
    for (const c of kids[id]) { layer[c] = Math.max(layer[c], layer[id] + 1); if (--deg[c] === 0) q.push(c); }
  }
  // nodes left in cycles: place just below their deepest known parent
  nodes.forEach((n) => { if (!seen.has(n.id)) { const pl = parents[n.id].map((p) => layer[p] || 0); layer[n.id] = pl.length ? Math.max(...pl) + 1 : 0; } });
  // group into layers, order within each layer to cut crossings (down + up barycenter sweeps)
  const layers = {}; nodes.forEach((n) => { (layers[layer[n.id]] = layers[layer[n.id]] || []).push(n.id); });
  const depths = Object.keys(layers).map(Number).sort((a, b) => a - b);
  const pos = {}; depths.forEach((d) => layers[d].forEach((id, i) => (pos[id] = i)));
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0, seq = down ? depths : [...depths].reverse();
    for (const d of seq) {
      const nbPos = (id) => { const nb = (down ? parents[id] : kids[id]).filter((p) => layer[p] === d + (down ? -1 : 1)); return nb.length ? median(nb.map((p) => pos[p])) : pos[id]; };
      layers[d].sort((a, b) => nbPos(a) - nbPos(b)); layers[d].forEach((id, i) => (pos[id] = i));
    }
  }
  // x-coordinate alignment: pull each node toward the median x of its neighbours, resolve overlaps in order
  const COL = 210, ROW = 150, x = {}; depths.forEach((d) => layers[d].forEach((id, i) => (x[id] = i * COL)));
  for (let pass = 0; pass < 10; pass++) {
    const down = pass % 2 === 0, seq = down ? depths : [...depths].reverse();
    for (const d of seq) {
      const arr = layers[d];
      for (const id of arr) { const nb = down ? parents[id] : kids[id]; const xs = (nb.length ? nb : [...parents[id], ...kids[id]]).map((p) => x[p]); const m = median(xs); if (m != null) x[id] = m; }
      for (let i = 1; i < arr.length; i++) { const min = x[arr[i - 1]] + COL; if (x[arr[i]] < min) x[arr[i]] = min; }
      for (let i = arr.length - 2; i >= 0; i--) { const max = x[arr[i + 1]] - COL; if (x[arr[i]] > max) x[arr[i]] = max; }
    }
  }
  const minX = Math.min(...nodes.map((n) => x[n.id]));
  nodes.forEach((n) => { const d = layer[n.id]; n._d = d; n._c = (x[n.id] - minX) / COL; n.x = Math.round(x[n.id] - minX + 40); n.y = Math.round(d * ROW + 40); });
  // number process/step in BFS order from the roots
  let seq = 1; const bseen = new Set(), bq = nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id);
  while (bq.length) { const id = bq.shift(); if (bseen.has(id)) continue; bseen.add(id); const n = byId[id]; if (n && (n.type === "process" || n.type === "step")) n.seq = seq++; (kids[id] || []).forEach((c) => bq.push(c)); }
  return g;
}
const fillOf = (s) => (String(s).match(/fillColor=(#[0-9a-fA-F]{6}|none)/) || [])[1] || "#ffff00";
// Find maximal runs of non-branching steps (a chain: each step has one way in and one way out,
// none are start/end/decision). These can be folded into one block without changing the flow.
const MIN_CHAIN = 3;
function linearChains(graph) {
  const kids = {}, indeg = {}, outdeg = {}, parent = {};
  graph.nodes.forEach((n) => { kids[n.id] = []; indeg[n.id] = 0; outdeg[n.id] = 0; });
  graph.edges.forEach((e) => { if (kids[e.from] !== undefined && indeg[e.to] !== undefined) { kids[e.from].push(e.to); outdeg[e.from]++; indeg[e.to]++; parent[e.to] = e.from; } });
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const ok = (id) => { const n = byId[id]; return n && n.type !== "start" && n.type !== "end" && n.type !== "decision"; };
  const seen = new Set(), chains = [];
  for (const nn of graph.nodes) {
    const id = nn.id; if (seen.has(id) || !ok(id)) continue;
    let head = true; if (indeg[id] === 1) { const p = parent[id]; if (p && ok(p) && outdeg[p] === 1) head = false; }
    if (!head) continue;
    const chain = [id]; seen.add(id); let cur = id;
    while (outdeg[cur] === 1) { const nx = kids[cur][0]; if (ok(nx) && indeg[nx] === 1 && !seen.has(nx)) { chain.push(nx); seen.add(nx); cur = nx; } else break; }
    if (chain.length >= MIN_CHAIN) chains.push(chain);
  }
  return chains;
}
// Build a view graph where each collapsed chain is one "group" node; edges re-point to the group.
function buildDisplayGraph(graph, chains, collapsed) {
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const headOf = {}, chainByHead = {};
  chains.forEach((ch) => { chainByHead[ch[0]] = ch; if (collapsed.has(ch[0])) ch.forEach((id) => (headOf[id] = ch[0])); });
  const disp = (id) => (headOf[id] ? "grp:" + headOf[id] : id);
  const nodes = [], doneGrp = new Set();
  for (const n of graph.nodes) {
    if (headOf[n.id]) { const h = headOf[n.id]; if (doneGrp.has(h)) continue; doneGrp.add(h); const ch = chainByHead[h]; nodes.push({ id: "grp:" + h, type: "group", members: ch.slice(), count: ch.length, label: byId[ch[0]].label, lastLabel: byId[ch[ch.length - 1]].label }); }
    else nodes.push({ ...n });
  }
  const seenE = new Set(), edges = [];
  for (const e of graph.edges) {
    const a = disp(e.from), b = disp(e.to); if (a === b) continue;
    const key = a + ">" + b + ">" + (e.label || ""); if (seenE.has(key)) continue; seenE.add(key);
    edges.push({ from: a, to: b, label: e.label || "", rfrom: e.from, rto: e.to });
  }
  return { nodes, edges };
}
// Nodes dominated by D: reachable from D and NOT reachable from any root without passing through D.
// (So a step that also rejoins the flow elsewhere via a merge is NOT swallowed.)
function dominatedBy(graph, D) {
  const roots = graph.nodes.filter((n) => n.type === "start" || !graph.edges.some((e) => e.to === n.id)).map((n) => n.id);
  const without = new Set(), st = roots.filter((r) => r !== D);
  while (st.length) { const x = st.pop(); if (without.has(x) || x === D) continue; without.add(x); graph.edges.forEach((e) => { if (e.from === x && e.to !== D) st.push(e.to); }); }
  const fromD = new Set(), st2 = []; graph.edges.forEach((e) => { if (e.from === D) st2.push(e.to); });
  while (st2.length) { const x = st2.pop(); if (fromD.has(x)) continue; fromD.add(x); graph.edges.forEach((e) => { if (e.from === x) st2.push(e.to); }); }
  return [...fromD].filter((v) => v !== D && !without.has(v));
}
// Build a view graph from a list of collapse groups ({ id, members, label, count, kind }).
function buildGroupGraph(graph, groups) {
  const memberToGroup = {}, byGroup = {};
  groups.forEach((gp) => { byGroup[gp.id] = gp; gp.members.forEach((id) => { if (!memberToGroup[id]) memberToGroup[id] = gp.id; }); });
  const disp = (id) => memberToGroup[id] || id;
  const nodes = [], done = new Set();
  for (const n of graph.nodes) {
    const gid = memberToGroup[n.id];
    if (gid) { if (done.has(gid)) continue; done.add(gid); const gp = byGroup[gid]; nodes.push({ id: gid, type: "group", kind: gp.kind, members: gp.members.slice(), count: gp.count, label: gp.label }); }
    else nodes.push({ ...n });
  }
  const seenE = new Set(), edges = [];
  for (const e of graph.edges) {
    const a = disp(e.from), b = disp(e.to); if (a === b) continue;
    const key = a + ">" + b + ">" + (e.label || ""); if (seenE.has(key)) continue; seenE.add(key);
    edges.push({ from: a, to: b, label: e.label || "", rfrom: e.from, rto: e.to });
  }
  return { nodes, edges };
}
function styleFor(type) {
  switch (type) {
    case "information": return PROFILE.process.style;                 // yellow box
    case "process":     return (PROFILE.step && PROFILE.step.style) || PROFILE.process.style; // white box
    case "manual":      return PROFILE.decision.style;                // blue diamond
    case "decision":    return PROFILE.manual.style;                  // red diamond
    case "start":       return PROFILE.start.style;                   // purple
    case "end":         return PROFILE.start.style;                   // purple
    default:            return (PROFILE.step && PROFILE.step.style) || PROFILE.process.style;
  }
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const wrapLabel = (t) => esc(`<div style="font-size: 1px"><font style="font-size:15.52px;font-family:Arial;color:#000000;line-height:120%">${t}</font></div>`);
// size a node box to fit its label: cap the width and grow height as the text wraps
function sizeFor(n) {
  const label = String(n.label || "");
  if (n.type === "start" || n.type === "end") return [Math.min(300, Math.max(150, label.length * 8 + 44)), 56];
  const diamond = n.type === "decision" || n.type === "manual";
  const w = diamond ? 210 : 240;
  const perLine = Math.max(6, Math.floor((diamond ? w * 0.5 : w - 28) / 7.6));
  let lines = 0;
  for (const seg of label.split(/\n/)) lines += Math.max(1, Math.ceil((seg.length || 1) / perLine));
  const h = Math.max(diamond ? 104 : 60, lines * 19 + (diamond ? 62 : 30));
  return [w, h];
}
function toDrawio(graph) {
  const g = layoutFlow(JSON.parse(JSON.stringify(graph)));
  // size every node to its content, then re-space rows/columns so nothing overlaps
  g.nodes.forEach((n) => { const [w, h] = sizeFor(n); n._w = w; n._h = h; });
  const colUnit = Math.max(200, ...g.nodes.map((n) => n._w)) + 60;
  const depths = [...new Set(g.nodes.map((n) => n._d || 0))].sort((a, b) => a - b);
  const rowH = {}; depths.forEach((d) => { rowH[d] = Math.max(...g.nodes.filter((n) => (n._d || 0) === d).map((n) => n._h)); });
  const rowY = {}; let acc = 40; depths.forEach((d) => { rowY[d] = acc; acc += rowH[d] + 60; });
  g.nodes.forEach((n) => { n.x = Math.round((n._c || 0) * colUnit + 40); n.y = Math.round(rowY[n._d || 0] + (rowH[n._d || 0] - n._h) / 2); });
  const W = Math.max(0, ...g.nodes.map((n) => n.x + n._w)) + 80, H = acc + 80;
  let cells = `<mxCell id="0"/><mxCell id="1" parent="0"/>`;
  cells += `<mxCell id="bg" value="" style="fillColor=#ffffff;strokeColor=none;pointerEvents=0;" vertex="1" parent="1"><mxGeometry x="-40" y="-40" width="${W + 80}" height="${H + 80}" as="geometry"/></mxCell>`;
  const badge = PROFILE.numberBadgeYellow ? PROFILE.numberBadgeYellow.style : PROFILE.process.style;
  for (const n of g.nodes) {
    cells += `<mxCell id="n${esc(n.id)}" value="${wrapLabel(n.label)}" style="${styleFor(n.type)}" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="${n._w}" height="${n._h}" as="geometry"/></mxCell>`;
    if (n.seq != null) {
      const bs = badge.replace(/fillColor=(#[0-9a-fA-F]{6}|none)/, "fillColor=" + fillOf(styleFor(n.type)));
      cells += `<mxCell id="b${esc(n.id)}" value="${wrapLabel(n.seq)}" style="${bs}" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="52" height="28" as="geometry"/></mxCell>`;
    }
  }
  g.edges.forEach((e, i) => {
    cells += `<mxCell id="e${i}" value="${esc(e.label || "")}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeColor=#000000;fontSize=12;fontFamily=Arial;" edge="1" parent="1" source="n${esc(e.from)}" target="n${esc(e.to)}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  });
  return `<mxfile host="guided-builder"><diagram name="Process" id="p1"><mxGraphModel dx="900" dy="640" grid="1" gridSize="10" page="1" background="#ffffff"><root>${cells}</root></mxGraphModel></diagram></mxfile>`;
}
function download(name, text, type) {
  const b = new Blob([text], { type }); const u = URL.createObjectURL(b);
  const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u);
}
// Orthogonal elbow connector: down from source, across in the row-gap, down into target — so
// lines run between the boxes instead of slicing under them. Corners are rounded.
function orthPath(x1, y1, x2, y2, r = 9) {
  if (Math.abs(x1 - x2) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const ym = (y1 + y2) / 2, dir = x2 > x1 ? 1 : -1;
  r = Math.max(0, Math.min(r, Math.abs(x2 - x1) / 2, Math.abs(ym - y1), Math.abs(y2 - ym)));
  return `M ${x1} ${y1} L ${x1} ${ym - r} Q ${x1} ${ym} ${x1 + dir * r} ${ym} L ${x2 - dir * r} ${ym} Q ${x2} ${ym} ${x2} ${ym + r} L ${x2} ${y2}`;
}
function wrapSvg(text, max) {
  const words = String(text).split(" "); const lines = []; let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > max) { if (cur) lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) lines.push(cur); return lines.slice(0, 3);
}
// whole-flow flowchart (all branches) — the "expand" view; click a node to select it
function FullFlowSvg({ graph, cursor, onSelect, onEdgeInsert, fitKey, revealKey }) {
  const chains = React.useMemo(() => linearChains(graph), [graph]);
  const chainHeads = React.useMemo(() => new Set(chains.map((c) => c[0])), [chains]);
  const decisionIds = React.useMemo(() => new Set(graph.nodes.filter((n) => n.type === "decision").map((n) => n.id)), [graph]);
  const [collapsed, setCollapsed] = React.useState(() => new Set());
  const [collapsedDec, setCollapsedDec] = React.useState(() => new Set());
  // open collapsed from the top (like the mind map): all decisions folded, drill down by expanding
  React.useEffect(() => { setCollapsed(new Set(chainHeads)); setCollapsedDec(new Set(decisionIds)); }, [fitKey]);
  React.useEffect(() => { setCollapsed((prev) => { const s = new Set(); prev.forEach((h) => chainHeads.has(h) && s.add(h)); return s; }); setCollapsedDec((prev) => { const s = new Set(); prev.forEach((d) => decisionIds.has(d) && s.add(d)); return s; }); }, [chainHeads, decisionIds]);
  const groups = React.useMemo(() => {
    const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
    const assigned = new Set(), list = [];
    // decision subtrees first (largest first so an outer decision swallows inner ones)
    const subs = [...collapsedDec].map((D) => ({ D, dom: dominatedBy(graph, D) })).filter((x) => x.dom.length > 0).sort((a, b) => b.dom.length - a.dom.length);
    for (const { D, dom } of subs) {
      const members = dom.filter((id) => !assigned.has(id)); if (!members.length) continue;
      members.forEach((id) => assigned.add(id));
      list.push({ id: "sub:" + D, kind: "sub", members, count: members.length, label: (byId[D] && byId[D].label) || "branch" });
    }
    // linear chains on remaining nodes
    for (const ch of chains) {
      if (!collapsed.has(ch[0])) continue;
      const members = ch.filter((id) => !assigned.has(id)); if (members.length < 2) continue;
      members.forEach((id) => assigned.add(id));
      list.push({ id: "grp:" + ch[0], kind: "chain", members, count: members.length, label: (byId[members[0]] && byId[members[0]].label) || "steps" });
    }
    return list;
  }, [graph, chains, collapsed, collapsedDec]);
  const display = React.useMemo(() => buildGroupGraph(graph, groups), [graph, groups]);
  const g = React.useMemo(() => layoutFlow(JSON.parse(JSON.stringify(display))), [display]);
  const expandAllChains = () => { setCollapsed(new Set()); setCollapsedDec(new Set()); };
  const collapseAllChains = () => { setCollapsed(new Set(chainHeads)); setCollapsedDec(new Set(decisionIds)); };
  const allCollapsed = decisionIds.size > 0 && collapsedDec.size >= decisionIds.size;
  const collapseDecision = (id) => setCollapsedDec((prev) => new Set(prev).add(id));
  const expandGroup = (gid) => {
    if (gid.startsWith("sub:")) { const D = gid.slice(4); setCollapsedDec((prev) => { const s = new Set(prev); s.delete(D); return s; }); }
    else { const h = gid.slice(4); setCollapsed((prev) => { const s = new Set(prev); s.delete(h); return s; }); }
  };
  const shared = React.useMemo(() => { const s = new Set(); graph.nodes.forEach((n) => { if (n.refId) { s.add(n.refId); s.add(n.id); } }); return s; }, [graph]);
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const dim = (t) => (t === "decision" || t === "manual" ? [158, 92] : t === "start" || t === "end" ? [150, 46] : t === "group" ? [190, 62] : [188, 56]);
  const W = Math.max(0, ...g.nodes.map((n) => n.x)) + 260;
  const H = Math.max(0, ...g.nodes.map((n) => n.y)) + 150;
  const svgRef = React.useRef(null);
  const drag = React.useRef(null);
  const [t, setT] = React.useState({ x: 20, y: 20, k: 0.6 });
  const [q, setQ] = React.useState("");
  const centerOn = React.useCallback((n) => { const el = svgRef.current; if (!n || !el) return; const r = el.getBoundingClientRect(); setT((p) => ({ ...p, x: r.width / 2 - (n.x + 94) * p.k, y: r.height / 2 - (n.y + 28) * p.k })); }, []);
  const fit = React.useCallback(() => {
    const el = svgRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const k = Math.min(2, Math.max(0.08, Math.min((r.width - 40) / W, (r.height - 40) / H)));
    setT({ k, x: (r.width - W * k) / 2, y: 20 });
  }, [W, H]);
  const fitRef = React.useRef(fit);
  fitRef.current = fit;
  React.useEffect(() => { fitRef.current(); }, [fitKey]);
  // pan (keeping zoom) to bring the current cursor node into the centre of view
  const revRef = React.useRef({ byId, cursor });
  revRef.current = { byId, cursor };
  React.useEffect(() => { if (!revealKey) return; const { byId: b, cursor: cur } = revRef.current; centerOn(b[cur]); }, [revealKey, centerOn]);
  const ql = q.trim().toLowerCase();
  const matches = ql ? g.nodes.filter((n) => (n.type === "group" ? n.members.some((mid) => String((graph.nodes.find((x) => x.id === mid) || {}).label || "").toLowerCase().includes(ql)) : String(n.label || "").toLowerCase().includes(ql))).slice(0, 12) : [];
  const matchSet = new Set(matches.map((n) => n.id));
  const gotoMatch = (n) => { onSelect(n.type === "group" ? n.members[0] : n.id); centerOn(n); };
  const zoomBy = (f) => setT((p) => { const el = svgRef.current; const r = el ? el.getBoundingClientRect() : { width: 800, height: 600 }; const mx = r.width / 2, my = r.height / 2; const k2 = Math.min(2.2, Math.max(0.08, p.k * f)); return { k: k2, x: mx - ((mx - p.x) / p.k) * k2, y: my - ((my - p.y) / p.k) * k2 }; });
  const onWheel = (e) => { e.preventDefault(); const r = svgRef.current.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const k2 = Math.min(2.2, Math.max(0.08, t.k * (e.deltaY < 0 ? 1.12 : 0.89))); setT({ k: k2, x: mx - ((mx - t.x) / t.k) * k2, y: my - ((my - t.y) / t.k) * k2 }); };
  const onDown = (e) => { e.preventDefault(); drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, moved: false }; };
  const onMove = (e) => { if (!drag.current) return; drag.current.moved = true; setT((p) => ({ ...p, x: drag.current.tx + (e.clientX - drag.current.x), y: drag.current.ty + (e.clientY - drag.current.y) })); };
  const onUp = () => (drag.current = null);
  const zbtn = { ...sans, width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, cursor: "pointer" };
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#FCFBF8", userSelect: "none", WebkitUserSelect: "none" }}>
      <div style={{ position: "absolute", top: 12, left: 14, zIndex: 3, width: 250 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} placeholder="Search steps…"
          style={{ ...sans, width: "100%", boxSizing: "border-box", fontSize: 12.5, color: T.ink, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 8, padding: "7px 10px", outline: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }} />
        {q.trim() && (
          <div style={{ marginTop: 4, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 8, boxShadow: "0 4px 14px rgba(0,0,0,0.1)", maxHeight: 260, overflow: "auto" }}>
            {matches.length === 0 && <div style={{ ...sans, fontSize: 12, color: T.textDim, padding: "8px 10px" }}>No matching steps.</div>}
            {matches.map((n) => (
              <button key={n.id} onClick={() => gotoMatch(n)} title="Jump to this step"
                style={{ ...sans, display: "flex", alignItems: "center", gap: 7, width: "100%", textAlign: "left", cursor: "pointer", background: "transparent", border: "none", borderBottom: `1px solid ${T.paper}`, padding: "7px 9px", fontSize: 12, color: T.ink }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: (NT[n.type] || NT.step).bd, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trunc(n.label, 40)}</span>
                {n.seq != null && <span style={{ ...mono, fontSize: 9.5, color: T.textDim }}>#{n.seq}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ position: "absolute", top: 12, right: 16, zIndex: 2, display: "flex", gap: 6 }}>
        {(chains.length > 0 || decisionIds.size > 0) && (allCollapsed
          ? <button style={{ ...zbtn, width: "auto", padding: "0 10px", gap: 6, fontSize: 12.5 }} onClick={expandAllChains} title="Expand the whole flow">Expand all</button>
          : <button style={{ ...zbtn, width: "auto", padding: "0 10px", gap: 6, fontSize: 12.5 }} onClick={collapseAllChains} title="Collapse to the top level (drill down by expanding)">Collapse all</button>)}
        <button style={zbtn} onClick={() => zoomBy(1.2)} title="Zoom in">+</button>
        <button style={zbtn} onClick={() => zoomBy(0.83)} title="Zoom out">−</button>
        <button style={{ ...zbtn, width: "auto", padding: "0 10px", gap: 6, fontSize: 12.5 }} onClick={fit} title="Fit to screen"><Maximize2 size={13} /> Fit</button>
      </div>
      <div style={{ position: "absolute", bottom: 10, left: 14, zIndex: 2, ...mono, fontSize: 11, color: T.textDim }}>scroll to zoom · drag to pan · {Math.round(t.k * 100)}%</div>
      <svg ref={svgRef} width="100%" height="100%" onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        draggable={false} onDragStart={(e) => e.preventDefault()}
        style={{ display: "block", cursor: drag.current ? "grabbing" : "grab", userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none", touchAction: "none" }}>
      <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
      <defs><marker id="fa" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#9a958a" /></marker></defs>
      {g.edges.map((e, i) => {
        const s = byId[e.from], t = byId[e.to]; if (!s || !t) return null;
        const [sw, sh] = dim(s.type), [tw] = dim(t.type);
        const x1 = s.x + sw / 2, y1 = s.y + sh, x2 = t.x + tw / 2, y2 = t.y, my = (y1 + y2) / 2, mx = (x1 + x2) / 2;
        return (
          <g key={i}>
            <path d={orthPath(x1, y1, x2, y2)} fill="none" stroke="#B9B4A7" strokeWidth="1.4" markerEnd="url(#fa)" />
            {e.label && <text x={mx + 10} y={my - 3} fontSize="10.5" fill="#0e86b8" style={mono}>{e.label}</text>}
            {onEdgeInsert && s.type !== "group" && t.type !== "group" && (
              <g onClick={(ev) => { ev.stopPropagation(); onEdgeInsert(e.rfrom || e.from, e.rto || e.to, e.label); }} style={{ cursor: "pointer" }}>
                <circle cx={mx} cy={my} r="8" fill="#fff" stroke="#c9a24a" strokeWidth="1.3" />
                <line x1={mx - 4} y1={my} x2={mx + 4} y2={my} stroke="#8a5a1e" strokeWidth="1.5" />
                <line x1={mx} y1={my - 4} x2={mx} y2={my + 4} stroke="#8a5a1e" strokeWidth="1.5" />
                <title>Insert a step here</title>
              </g>
            )}
          </g>
        );
      })}
      {g.nodes.map((n) => {
        const [w, h] = dim(n.type); const c = FILL[n.type] || "#888"; const meta = NT[n.type] || NT.step; const sel = n.id === cursor;
        const cx = n.x + w / 2, cy = n.y + h / 2; const diamond = n.type === "decision" || n.type === "manual";
        const hit = matchSet.has(n.id); const stroke = sel ? T.amber : hit ? "#ff6a00" : c; const sw = sel ? 2.5 : hit ? 4 : 1.5;
        if (n.type === "group") {
          return (
            <g key={n.id} onClick={() => { if (!drag.current || !drag.current.moved) expandGroup(n.id); }} style={{ cursor: "pointer" }} title="Click to expand these steps">
              {hit && <rect x={n.x - 5} y={n.y - 5} width={w + 10} height={h + 10} rx={12} fill="none" stroke="#ffd21a" strokeWidth="9" opacity="0.75" />}
              <rect x={n.x + 4} y={n.y + 5} width={w} height={h} rx={9} fill="#ece7db" stroke="#c7bfad" />
              <rect x={n.x + 2} y={n.y + 3} width={w} height={h} rx={9} fill="#f1ece0" stroke="#c2baa6" />
              <rect x={n.x} y={n.y} width={w} height={h} rx={9} fill={hit ? "#fff2b0" : "#f7f3ea"} stroke={hit ? "#ff6a00" : "#b0a892"} strokeWidth={hit ? 3 : 1.5} strokeDasharray="5 3" />
              <text x={cx} y={cy - 7} textAnchor="middle" fontSize="12" fontWeight="700" fill="#5f5744" style={sans}>▸ {n.count} {n.kind === "sub" ? "steps ⑂" : "steps"}</text>
              <text x={cx} y={cy + 9} textAnchor="middle" fontSize="9.5" fill="#8a8272" style={sans}>{n.kind === "sub" ? "after this decision" : trunc(n.label, 24) + " …"}</text>
            </g>
          );
        }
        return (
          <g key={n.id} onClick={() => { if (!drag.current || !drag.current.moved) onSelect(n.id); }} style={{ cursor: "pointer" }}>
            {hit && (diamond
              ? <polygon points={`${cx},${n.y - 6} ${n.x + w + 6},${cy} ${cx},${n.y + h + 6} ${n.x - 6},${cy}`} fill="none" stroke="#ffd21a" strokeWidth="9" opacity="0.75" />
              : <rect x={n.x - 5} y={n.y - 5} width={w + 10} height={h + 10} rx={n.type === "start" || n.type === "end" ? (h + 10) / 2 : 11} fill="none" stroke="#ffd21a" strokeWidth="9" opacity="0.75" />)}
            {diamond
              ? <polygon points={`${cx},${n.y} ${n.x + w},${cy} ${cx},${n.y + h} ${n.x},${cy}`} fill={hit ? "#fff2b0" : meta.bg} stroke={stroke} strokeWidth={sw} />
              : <rect x={n.x} y={n.y} width={w} height={h} rx={n.type === "start" || n.type === "end" ? h / 2 : 8} fill={hit ? "#fff2b0" : meta.bg} stroke={stroke} strokeWidth={sw} />}
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill={meta.fg} style={sans}>
              {wrapSvg(n.label, diamond ? 15 : 24).map((ln, i, a) => <tspan key={i} x={cx} dy={i === 0 ? -(a.length - 1) * 6 : 12}>{ln}</tspan>)}
            </text>
            {n.seq != null && <text x={n.x + 5} y={n.y + 11} fontSize="9" fontWeight="700" fill={c} style={mono}>{n.seq}</text>}
            {shared.has(n.id) && <text x={n.x + w - 7} y={n.y + 12} textAnchor="end" fontSize="10" fill={c} style={sans}>🔗</text>}
            {n.type === "decision" && (
              <g onClick={(ev) => { ev.stopPropagation(); collapseDecision(n.id); }} style={{ cursor: "pointer" }}>
                <title>Collapse everything after this decision</title>
                <circle cx={n.x + w - 2} cy={cy} r="9" fill="#fff" stroke="#b85450" strokeWidth="1.4" />
                <line x1={n.x + w - 6} y1={cy} x2={n.x + w + 2} y2={cy} stroke="#b85450" strokeWidth="1.6" />
              </g>
            )}
          </g>
        );
      })}
      </g>
    </svg>
    </div>
  );
}

/* ---- save / resume (browser-local; per-device) ---- */
const LS_KEY = "guidedBuilder.savedFlows";
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; } };
const persistSaved = (list) => { try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch {} };
const relTime = (ts) => { const s = (Date.now() - ts) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return new Date(ts).toLocaleDateString(); };

/* ---- interactive mind map (spanning tree from the process, rooted at start) ---- */
function countDesc(t) { return t.children.reduce((s, c) => s + 1 + countDesc(c), 0); }
function buildTree(graph) {
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const succ = {}; graph.nodes.forEach((n) => (succ[n.id] = []));
  graph.edges.forEach((e) => { if (succ[e.from]) succ[e.from].push({ to: e.to, label: e.label || "" }); });
  const root = graph.nodes.find((n) => n.type === "start")
    || graph.nodes.find((n) => !graph.edges.some((e) => e.to === n.id)) || graph.nodes[0];
  if (!root) return null;
  const placed = new Set();
  const build = (id, edgeLabel) => {
    placed.add(id);
    const t = { id, node: byId[id], edgeLabel, children: [], refs: [] };
    for (const s of succ[id] || []) {
      if (placed.has(s.to)) t.refs.push({ to: s.to, label: s.label, target: byId[s.to] });
      else t.children.push(build(s.to, s.label));
    }
    return t;
  };
  return build(root.id, null);
}
function allBranchIds(t, acc = []) { if (t.children.length) { acc.push(t.id); t.children.forEach((c) => allBranchIds(c, acc)); } return acc; }
function layoutTree(root, collapsed) {
  const NW = 210, NH = 40, COLW = 250, ROWH = 52;
  let cursorY = 0;
  const place = (t, depth) => {
    t._x = depth * COLW; t._col = collapsed.has(t.id);
    const kids = t._col ? [] : t.children;
    if (!kids.length) { t._y = cursorY; cursorY += ROWH; }
    else { kids.forEach((k) => place(k, depth + 1)); t._y = (kids[0]._y + kids[kids.length - 1]._y) / 2; }
  };
  place(root, 0);
  const nodes = [], links = [];
  const collect = (t) => {
    nodes.push({ id: t.id, x: t._x, y: t._y, w: NW, h: NH, node: t.node, edgeLabel: t.edgeLabel,
      hasKids: t.children.length > 0, collapsed: t._col, descCount: t._col ? countDesc(t) : 0, refs: t.refs });
    if (!t._col) for (const k of t.children) { links.push({ x1: t._x + NW, y1: t._y + NH / 2, x2: k._x, y2: k._y + NH / 2 }); collect(k); }
  };
  collect(root);
  return { nodes, links, width: Math.max(0, ...nodes.map((n) => n.x + n.w)) + 40, height: cursorY + 40 };
}
function MindMapView({ graph }) {
  const tree = React.useMemo(() => buildTree(graph), [graph]);
  const [collapsed, setCollapsed] = React.useState(() => new Set());
  const [t, setT] = React.useState({ x: 30, y: 20, k: 0.85 });
  const svgRef = React.useRef(null);
  const drag = React.useRef(null);
  if (!tree) return null;
  const laidOut = layoutTree(tree, collapsed);

  const toggle = (id, hasKids) => { if (!hasKids) return; setCollapsed((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }); };
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allBranchIds(tree).filter((id) => id !== tree.id)));
  const reset = () => setT({ x: 30, y: 20, k: 0.85 });
  const onWheel = (e) => {
    e.preventDefault();
    const r = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k2 = Math.min(2.2, Math.max(0.2, t.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    const wx = (mx - t.x) / t.k, wy = (my - t.y) / t.k;
    setT({ k: k2, x: mx - wx * k2, y: my - wy * k2 });
  };
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y }; };
  const onMove = (e) => { if (!drag.current) return; setT((p) => ({ ...p, x: drag.current.tx + (e.clientX - drag.current.x), y: drag.current.ty + (e.clientY - drag.current.y) })); };
  const onUp = () => (drag.current = null);
  const btn = { ...sans, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "6px 11px", cursor: "pointer" };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#FCFBF8" }}>
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 2, display: "flex", gap: 8 }}>
        <button style={btn} onClick={expandAll}>Expand all</button>
        <button style={btn} onClick={collapseAll}>Collapse</button>
        <button style={btn} onClick={reset}><Maximize2 size={13} /> Reset view</button>
      </div>
      <div style={{ position: "absolute", bottom: 12, left: 12, zIndex: 2, ...mono, fontSize: 11, color: T.textDim }}>
        scroll to zoom · drag to pan · click a node to collapse/expand
      </div>
      <svg ref={svgRef} width="100%" height="100%" onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        style={{ cursor: drag.current ? "grabbing" : "grab", display: "block" }}>
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {laidOut.links.map((l, i) => (
            <path key={i} d={`M ${l.x1} ${l.y1} C ${l.x1 + 50} ${l.y1}, ${l.x2 - 50} ${l.y2}, ${l.x2} ${l.y2}`} fill="none" stroke="#CBC7BB" strokeWidth="1.5" />
          ))}
          {laidOut.nodes.map((nd) => {
            const c = FILL[nd.node.type] || "#888";
            return (
              <g key={nd.id} transform={`translate(${nd.x},${nd.y})`} onClick={() => toggle(nd.id, nd.hasKids)} style={{ cursor: nd.hasKids ? "pointer" : "default" }}>
                <rect width={nd.w} height={nd.h} rx="9" fill="#fff" stroke={c} strokeWidth="1.6" />
                <rect width="6" height={nd.h} rx="3" fill={c} />
                <circle cx="20" cy={nd.h / 2} r="4" fill={c} />
                <text x="32" y={nd.h / 2} dominantBaseline="middle" fontSize="12.5" fill={T.ink} style={sans}>
                  {trunc(nd.node.label, 26)}
                  <title>{nd.node.label}</title>
                </text>
                {nd.node.seq != null && (
                  <text x={nd.w - 10} y="13" textAnchor="end" fontSize="9.5" fill={T.textDim} style={mono}>{nd.node.seq}</text>
                )}
                {nd.hasKids && (
                  <g>
                    <circle cx={nd.w} cy={nd.h / 2} r="10" fill={nd.collapsed ? c : "#fff"} stroke={c} strokeWidth="1.6" />
                    <text x={nd.w} y={nd.h / 2 + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={nd.collapsed ? "8.5" : "13"} fontWeight="700" fill={nd.collapsed ? "#fff" : c} style={sans}>
                      {nd.collapsed ? `+${nd.descCount}` : "−"}
                    </text>
                  </g>
                )}
                {nd.refs && nd.refs.length > 0 && (
                  <text x="32" y={nd.h + 11} fontSize="9.5" fill="#9673a6" style={mono}>
                    ↩ {nd.refs.map((r) => trunc(r.target ? r.target.label : r.to, 16)).join(", ")}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function enumeratePaths(graph, cap = 500) {
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const out = {}; graph.nodes.forEach((n) => (out[n.id] = []));
  graph.edges.forEach((e) => { if (out[e.from]) out[e.from].push({ to: e.to, label: e.label || "" }); });
  const start = graph.nodes.find((n) => n.type === "start")
    || graph.nodes.find((n) => !graph.edges.some((e) => e.to === n.id)) || graph.nodes[0];
  if (!start) return { paths: [], truncated: false };
  const isTerminal = (id) => byId[id] && (byId[id].type === "end" || out[id].length === 0);
  const paths = []; let truncated = false, steps = 0; const budget = 400000;
  (function dfs(id, path, labels, visited) {
    if (paths.length >= cap || steps > budget) { truncated = true; return; }
    steps++;
    if (path.length > 1 && isTerminal(id)) { paths.push({ nodes: [...path], labels: [...labels] }); return; }
    for (const nx of out[id]) {
      if (visited.has(nx.to)) continue;
      visited.add(nx.to); path.push(nx.to); labels.push(nx.label);
      dfs(nx.to, path, labels, visited);
      visited.delete(nx.to); path.pop(); labels.pop();
      if (paths.length >= cap || steps > budget) { truncated = true; break; }
    }
  })(start.id, [start.id], [], new Set([start.id]));
  return { paths, truncated };
}

function PathsPanel({ laid, result, busy, selected, onSelect, query, onQuery, edits, setEdits, hasEdits, onApply, onRenameBranch, onInsert, onAppend, onRemove }) {
  const [focusId, setFocusId] = React.useState(null);
  if (busy) return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: T.paper, color: T.textDim }}>
      <div style={{ textAlign: "center" }}><Cpu size={24} className="ps-spin" style={{ opacity: 0.6 }} /><div style={{ marginTop: 10, fontSize: 13 }}>Tracing routes…</div></div>
    </div>
  );
  if (!result) return null;
  const byId = laid.byId;
  const labelOf = (id) => { const e = edits[id]; return e && e.label != null ? e.label : (byId[id] ? byId[id].label : ""); };
  const endLabel = (p) => labelOf(p.nodes[p.nodes.length - 1]);
  const decisions = (p) => p.labels.filter(Boolean);

  // search: rank paths by how many query terms appear across their step text + branches
  const q = (query || "").trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  let rows = result.paths.map((p, i) => ({ p, i }));
  if (terms.length) {
    rows = rows.map(({ p, i }) => {
      const hay = (p.nodes.map((id) => labelOf(id)).join(" ") + " " + p.labels.join(" ")).toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { p, i, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  }
  const sel = selected != null ? result.paths[selected] : null;
  const setLabel = (id, v) => setEdits((prev) => ({ ...prev, [id]: { ...prev[id], label: v } }));
  const setType = (id, v) => setEdits((prev) => ({ ...prev, [id]: { ...prev[id], type: v } }));
  const PROC_TYPES = ["start", "manual", "process", "decision", "information", "end"];

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", background: T.paper }}>
      {/* list + search */}
      <div style={{ width: 340, minWidth: 280, borderRight: `1px solid ${T.line}`, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.line}` }}>
          <input value={query} onChange={(e) => onQuery(e.target.value)} spellCheck={false}
            placeholder="Search paths, e.g. change of income with increase"
            style={{ ...sans, width: "100%", boxSizing: "border-box", fontSize: 12.5, color: T.ink, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px", outline: "none" }} />
          <div style={{ ...mono, fontSize: 11, color: T.textDim, marginTop: 8 }}>
            {rows.length}{result.truncated && !terms.length ? "+" : ""} {terms.length ? "matching" : "unique"} path{rows.length === 1 ? "" : "s"}
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {rows.length === 0 && <div style={{ ...sans, fontSize: 13, color: T.textDim, padding: 20 }}>No paths match “{query}”.</div>}
          {rows.map(({ p, i }) => {
            const on = i === selected;
            return (
              <button key={i} onClick={() => onSelect(i)}
                style={{ ...sans, display: "block", width: "100%", textAlign: "left", cursor: "pointer", background: on ? T.amberSoft : "transparent", border: "none", borderBottom: `1px solid ${T.line}`, borderLeft: `3px solid ${on ? T.amber : "transparent"}`, padding: "10px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>Path {i + 1} · {p.nodes.length} steps</div>
                <div style={{ ...mono, fontSize: 10.5, color: T.textDim, marginTop: 3 }}>{decisions(p).length ? decisions(p).slice(0, 6).join(" › ") : "no decisions"}</div>
                <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 3 }}>→ {trunc(endLabel(p), 42)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* detail: editable step-by-step */}
      <div style={{ flex: 1, position: "relative", overflow: "auto", background: "#fff" }}>
        {!sel && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: T.textDim }}>
            <div style={{ textAlign: "center" }}><Route size={26} style={{ opacity: 0.4 }} /><div style={{ marginTop: 10, fontSize: 13 }}>Select a path to view and edit its steps.</div></div>
          </div>
        )}
        {sel && (
          <div style={{ maxWidth: 780, margin: "0 auto", padding: "20px 30px 80px", ...sans }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: T.ink }}>Path {selected + 1}</div>
                <div style={{ ...mono, fontSize: 11.5, color: T.textDim, marginTop: 2 }}>{sel.nodes.length} steps · ends at “{trunc(endLabel(sel), 56)}”</div>
              </div>
              <button onClick={() => download(`path-${selected + 1}.txt`, pathToText(laid, sel, selected + 1, edits), "text/plain")}
                style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", flexShrink: 0 }}>
                <Download size={12} /> .txt
              </button>
            </div>
            <div style={{ ...sans, fontSize: 12, color: T.textDim, margin: "10px 0 16px", lineHeight: 1.5 }}>
              Edit any step's text below. Editing a step updates it everywhere it appears in the flow. Similar existing steps are suggested — click one to reuse its wording.
            </div>
            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {sel.nodes.map((id, i) => {
                const n = byId[id]; if (!n) return null;
                const val = labelOf(id);
                const branch = sel.labels[i];
                const e = edits[id];
                const curType = e && e.type != null ? e.type : n.type;
                const tag = TYPE_TAG[curType] || "#888";
                const dirty = e && ((e.label != null && e.label !== n.label) || (e.type != null && e.type !== n.type));
                const sims = focusId === id ? similarSteps(val, laid.nodes, id) : [];
                return (
                  <React.Fragment key={i}>
                  <li style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: `1px solid #F1EFE8` }}>
                    <span style={{ ...mono, fontSize: 12, color: T.textDim, minWidth: 22, textAlign: "right", paddingTop: 6 }}>{i + 1}</span>
                    <span style={{ marginTop: 8, width: 9, height: 9, borderRadius: 2, background: tag, flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ ...mono, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: tag }}>
                          step{n.seq != null ? ` ${n.seq}` : ""}{dirty ? " · edited" : ""}
                        </span>
                        <select value={curType} onChange={(ev) => setType(id, ev.target.value)}
                          style={{ ...mono, fontSize: 10.5, color: tag, background: "#fff", border: `1px solid ${dirty && e.type != null ? T.amber : T.line}`, borderRadius: 6, padding: "2px 4px", cursor: "pointer", textTransform: "uppercase" }}>
                          {PROC_TYPES.map((t) => <option key={t} value={t}>{(NT[t] && NT[t].name) || t}</option>)}
                        </select>
                        <div style={{ flex: 1 }} />
                        {onRemove && n.type !== "start" && (
                          <button onClick={() => onRemove(id)} title="Remove this step (reconnects the flow)"
                            style={{ display: "inline-flex", alignItems: "center", background: "transparent", border: "none", color: "#b85450", cursor: "pointer", padding: 2 }}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                      <textarea value={val} onFocus={() => setFocusId(id)} onBlur={() => setTimeout(() => setFocusId((f) => (f === id ? null : f)), 150)}
                        onChange={(ev) => setLabel(id, ev.target.value)} rows={Math.min(6, Math.max(1, Math.ceil(val.length / 70)))}
                        style={{ ...sans, width: "100%", boxSizing: "border-box", marginTop: 4, resize: "vertical", fontSize: 13.5, lineHeight: 1.5, color: T.ink, background: dirty ? "#FFFBF2" : "#fff", border: `1px solid ${dirty ? T.amber : "#E6E1D6"}`, borderRadius: 7, padding: "7px 9px", outline: "none" }} />
                      {sims.length > 0 && (
                        <div style={{ marginTop: 6, background: "#F6F4EE", border: `1px solid ${T.line}`, borderRadius: 8, padding: 8 }}>
                          <div style={{ ...mono, fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Similar steps — click to reuse</div>
                          {sims.map((s) => (
                            <button key={s.n.id} onMouseDown={(ev) => { ev.preventDefault(); setLabel(id, s.n.label); }}
                              style={{ ...sans, display: "block", width: "100%", textAlign: "left", cursor: "pointer", background: "#fff", border: `1px solid ${T.line}`, borderRadius: 6, padding: "6px 8px", marginBottom: 5, fontSize: 12, color: T.ink }}>
                              <span style={{ ...mono, fontSize: 9.5, color: "#0e86b8", marginRight: 6 }}>{Math.round(s.score * 100)}%</span>{trunc(s.n.label, 90)}
                            </button>
                          ))}
                        </div>
                      )}
                      {branch && (n.type === "decision" && onRenameBranch ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                          <span style={{ fontSize: 12.5, color: T.amber, fontWeight: 600 }}>→</span>
                          <input defaultValue={branch} spellCheck={false} title="Edit branch condition"
                            onBlur={(e) => onRenameBranch(id, branch, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                            style={{ ...sans, fontSize: 12.5, fontWeight: 600, color: "#0a4a63", background: "#fff", border: `1px solid ${T.line}`, borderRadius: 6, padding: "4px 8px", outline: "none", width: 140 }} />
                        </div>
                      ) : (
                        <div style={{ fontSize: 12.5, color: T.amber, fontWeight: 600, marginTop: 6 }}>→ {branch}</div>
                      ))}
                    </div>
                  </li>
                  {onInsert && i < sel.nodes.length - 1 && (
                    <li style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0 4px 34px" }}>
                      <div style={{ width: 2, height: 14, background: "#E6E1D6" }} />
                      <button onClick={() => onInsert(id, sel.nodes[i + 1], sel.labels[i])} title="Insert a step between these two"
                        style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: T.amber, background: T.amberSoft, border: `1px dashed ${T.amber}`, borderRadius: 7, padding: "3px 11px", cursor: "pointer" }}>
                        <Plus size={12} /> insert step here
                      </button>
                    </li>
                  )}
                </React.Fragment>
                );
              })}
            </ol>
            {onAppend && (
              <div style={{ marginTop: 6, paddingLeft: 34 }}>
                <button onClick={() => onAppend(sel)} title="Add a new step at the end of this path"
                  style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#1a1206", background: T.amber, border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}>
                  <Plus size={14} /> Add step to this path
                </button>
              </div>
            )}
          </div>
        )}
        {hasEdits && (
          <div style={{ position: "sticky", bottom: 0, display: "flex", alignItems: "center", gap: 12, padding: "12px 24px", background: "rgba(255,255,255,.96)", borderTop: `1px solid ${T.line}` }}>
            <span style={{ ...sans, fontSize: 12.5, color: T.textDim }}>{Object.keys(edits).length} step{Object.keys(edits).length === 1 ? "" : "s"} edited</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setEdits({})} style={{ ...sans, fontSize: 13, color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>Discard</button>
            <button onClick={onApply} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 600, color: "#1a1206", background: T.amber, border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer" }}>
              <Check size={15} /> Apply to diagram
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function pathToText(laid, p, num, edits = {}) {
  const byId = laid.byId;
  const lbl = (id) => { const e = edits[id]; return e && e.label != null ? e.label : (byId[id] ? byId[id].label : ""); };
  const typ = (id) => { const e = edits[id]; return e && e.type != null ? e.type : (byId[id] ? byId[id].type : ""); };
  let out = `Path ${num} — ${p.nodes.length} steps\n\n`;
  p.nodes.forEach((id, i) => {
    const n = byId[id]; if (!n) return;
    out += `${i + 1}. [${typ(id)}${n.seq != null ? ` step ${n.seq}` : ""}] ${lbl(id)}\n`;
    if (p.labels[i]) out += `      → ${p.labels[i]}\n`;
  });
  return out;
}

function DrawioFrame({ url, xml, onChange }) {
  const ref = useRef(null); const xmlRef = useRef(xml); xmlRef.current = xml;
  useEffect(() => {
    function onMsg(evt) {
      let m; try { m = JSON.parse(evt.data); } catch { return; }
      const w = ref.current && ref.current.contentWindow; if (!w) return;
      if (m.event === "init") w.postMessage(JSON.stringify({ action: "load", autosave: 1, xml: xmlRef.current }), "*");
      else if ((m.event === "autosave" || m.event === "save") && m.xml) onChange && onChange(m.xml);
    }
    window.addEventListener("message", onMsg); return () => window.removeEventListener("message", onMsg);
  }, [onChange]);
  useEffect(() => { const w = ref.current && ref.current.contentWindow; if (w) w.postMessage(JSON.stringify({ action: "load", autosave: 1, xml }), "*"); }, [xml]);
  const src = `${url}${url.includes("?") ? "&" : "?"}embed=1&proto=json&spin=1&noSaveBtn=1`;
  return <iframe ref={ref} title="draw.io" src={src} style={{ width: "100%", height: "100%", border: "none", background: "#fff" }} />;
}

/* ================================================================== */
export default function GuidedBuilder({ onRegister }) {
  const [flowName, setFlowName] = useState("Change of Address");
  const [graph, setGraph] = useState(() => ({ title: "Change of Address", nodes: [{ id: "start", label: "Change of Address", type: "start" }], edges: [] }));
  const [cursor, setCursor] = useState("start");
  const [pendingBranch, setPendingBranch] = useState(null);
  const [newType, setNewType] = useState("step");
  const [newLabel, setNewLabel] = useState("");
  const [newBranches, setNewBranches] = useState("Yes, No");
  const [newBranchName, setNewBranchName] = useState("");
  const [showPick, setShowPick] = useState(false);
  const [pickQuery, setPickQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState("build"); // build | mindmap | paths | drawio
  const [fullFlow, setFullFlow] = useState(false); // focused path vs whole flow
  const [fitKey, setFitKey] = useState(0); // bump to re-fit the full-flow view (import/open/new)
  const [revealKey, setRevealKey] = useState(0); // bump to pan the full-flow view to the cursor node
  const revealNode = (id) => { setCursor(id); setPendingBranch(null); setRevealKey((k) => k + 1); };
  const [pathResult, setPathResult] = useState(null);
  const [selPath, setSelPath] = useState(null);
  const [pathsBusy, setPathsBusy] = useState(false);
  const [pathQuery, setPathQuery] = useState("");
  const [edits, setEdits] = useState({});
  const [drawioUrl, setDrawioUrl] = useState("https://embed.diagrams.net/");

  const stateRef = useRef();
  stateRef.current = { flowName, graph, cursor, pendingBranch, newType, newLabel, newBranches, newBranchName, view, fullFlow };

  useEffect(() => {
    if (onRegister) {
      onRegister({
        getSaveData: () => ({
          title: stateRef.current.flowName,
          graph: stateRef.current.graph,
          cursor: stateRef.current.cursor,
          pendingBranch: stateRef.current.pendingBranch,
          newType: stateRef.current.newType,
          newLabel: stateRef.current.newLabel,
          newBranches: stateRef.current.newBranches,
          newBranchName: stateRef.current.newBranchName,
          view: stateRef.current.view,
          fullFlow: stateRef.current.fullFlow,
        }),
        loadData: (data) => {
          if (data.title) setFlowName(data.title);
          if (data.graph) setGraph(data.graph);
          if (data.cursor) setCursor(data.cursor);
          if (data.pendingBranch !== undefined) setPendingBranch(data.pendingBranch);
          if (data.newType) setNewType(data.newType);
          if (data.newLabel) setNewLabel(data.newLabel);
          if (data.newBranches) setNewBranches(data.newBranches);
          if (data.newBranchName) setNewBranchName(data.newBranchName);
          if (data.view) setView(data.view);
          if (data.fullFlow !== undefined) setFullFlow(data.fullFlow);
          setEdits({});
          setSelPath(null);
        }
      });
    }
  }, [onRegister]);


  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph]);
  const chain = useMemo(() => pathTo(graph, cursor), [graph, cursor]);
  const open = useMemo(() => openBranches(graph), [graph]);
  const cur = byId[cursor];
  // numbered layout (for paths seq + byId) and template-styled xml (for the draw.io view)
  const laidForPaths = useMemo(() => { const g = layoutFlow(JSON.parse(JSON.stringify(graph))); g.byId = Object.fromEntries(g.nodes.map((n) => [n.id, n])); return g; }, [graph]);
  // shared info blocks: masters that have linked instances, plus the instances themselves
  const sharedIds = useMemo(() => { const s = new Set(); graph.nodes.forEach((n) => { if (n.refId) { s.add(n.refId); s.add(n.id); } }); return s; }, [graph]);
  const infoMasters = useMemo(() => graph.nodes.filter((n) => n.type === "information" && !n.refId), [graph]);
  const xml = useMemo(() => toDrawio(graph), [graph]);
  const applyEdits = () => {
    if (!Object.keys(edits).length) return;
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => {
      const e = edits[n.id]; if (!e) return n;
      let nn = e.type != null && e.type !== n.type ? retypeNode(n, e.type, g.edges) : n;
      if (e.label != null) nn = { ...nn, label: e.label };
      return nn;
    }) }));
    setEdits({}); setSelPath(null);
  };
  // switch views, flushing any pending Paths edits into the graph so Build/Paths stay in sync
  const changeView = (k) => { if (view === "paths" && Object.keys(edits).length) applyEdits(); setView(k); };
  // insert a step between two nodes from the Paths tab — flushes pending label edits in the same update
  const pathInsert = (fromId, toId, label = "") => {
    const id = uid();
    setGraph((g) => {
      let nodes = g.nodes.map((n) => { const e = edits[n.id]; return e ? { ...n, label: e.label != null ? e.label : n.label, type: e.type != null ? e.type : n.type } : n; });
      nodes = [...nodes, { id, label: "New step", type: "process" }];
      const edges = [...g.edges.filter((e) => !(e.from === fromId && e.to === toId)), { from: fromId, to: id, label: label || "" }, { from: id, to: toId, label: "" }];
      return { ...g, nodes, edges };
    });
    setEdits({}); // keep the path selected so the new step is visible in place
  };
  // remove a step from the Paths tab — bridges parent(s) to child(ren) so the flow stays connected
  const pathRemove = (nodeId) => {
    if (nodeId === "start") return;
    setGraph((g) => {
      let nodes = g.nodes.map((n) => { const e = edits[n.id]; return e ? { ...n, label: e.label != null ? e.label : n.label, type: e.type != null ? e.type : n.type } : n; });
      const incoming = g.edges.filter((e) => e.to === nodeId);
      const outgoing = g.edges.filter((e) => e.from === nodeId);
      const bridges = [];
      for (const inE of incoming) for (const outE of outgoing) {
        if (inE.from !== outE.to && !g.edges.some((e) => e.from === inE.from && e.to === outE.to) && !bridges.some((b) => b.from === inE.from && b.to === outE.to))
          bridges.push({ from: inE.from, to: outE.to, label: inE.label || "" });
      }
      nodes = nodes.filter((n) => n.id !== nodeId);
      return { ...g, nodes, edges: [...g.edges.filter((e) => e.from !== nodeId && e.to !== nodeId), ...bridges] };
    });
    setEdits({});
  };
  const pathAppend = (p) => {
    const lastId = p.nodes[p.nodes.length - 1];
    const lastNode = graph.nodes.find((n) => n.id === lastId);
    if (lastNode && lastNode.type === "end" && p.nodes.length >= 2) {
      pathInsert(p.nodes[p.nodes.length - 2], lastId, p.labels[p.nodes.length - 2]);
    } else {
      const id = uid();
      setGraph((g) => {
        let nodes = g.nodes.map((n) => { const e = edits[n.id]; return e ? { ...n, label: e.label != null ? e.label : n.label, type: e.type != null ? e.type : n.type } : n; });
        nodes = [...nodes, { id, label: "New step", type: "process" }];
        return { ...g, nodes, edges: [...g.edges, { from: lastId, to: id, label: "" }] };
      });
      setEdits({});
    }
  };
  useEffect(() => {
    if (view !== "paths") return;
    setPathsBusy(true);
    const t = setTimeout(() => { setPathResult(enumeratePaths(laidForPaths)); setPathsBusy(false); }, 20);
    return () => clearTimeout(t);
  }, [view, laidForPaths]);
  const parent = parentMap(graph);

  const renameStart = (name) => {
    setFlowName(name);
    setGraph((g) => ({ ...g, title: name, nodes: g.nodes.map((n) => (n.id === "start" ? { ...n, label: name || "Start" } : n)) }));
  };
  const add = () => {
    const label = newLabel.trim() || NT[newType].name;
    const id = uid();
    const node = { id, label, type: newType };
    if (newType === "decision") node.branches = newBranches.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5) || ["Yes", "No"];
    setGraph((g) => ({ ...g, nodes: [...g.nodes, node], edges: [...g.edges, { from: cursor, to: id, label: pendingBranch || "" }] }));
    setCursor(id); setPendingBranch(null); setNewLabel(""); if (newType === "decision") setNewType("step");
  };
  const branchChild = (decId, b) => { const e = childEdges(graph, decId).find((x) => x.label === b); return e ? e.to : null; };
  const goBranch = (b) => { const c = branchChild(cursor, b); if (c) { setCursor(c); setPendingBranch(null); } else setPendingBranch(b); };
  const updateLabel = (id, label) => {
    setGraph((g) => {
      const node = g.nodes.find((n) => n.id === id);
      // shared info block: edit the master and every linked instance together
      if (node && (node.refId || g.nodes.some((n) => n.refId === id))) {
        const masterId = node.refId || id;
        return { ...g, nodes: g.nodes.map((n) => (n.id === masterId || n.refId === masterId ? { ...n, label } : n)) };
      }
      return { ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, label } : n)) };
    });
    if (id === "start") setFlowName(label);
  };
  // link a new instance of an existing info block at the cursor (shares content, own onward path)
  const addReference = (masterId) => {
    const master = graph.nodes.find((n) => n.id === masterId); if (!master) return;
    const id = uid();
    setGraph((g) => ({ ...g, nodes: [...g.nodes, { id, type: "information", label: master.label, refId: masterId }], edges: [...g.edges, { from: cursor, to: id, label: pendingBranch || "" }] }));
    setCursor(id); setPendingBranch(null); setNewLabel("");
  };
  const updateType = (id, type) => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? retypeNode(n, type, g.edges) : n)) }));
  // converting a branched decision to a single-path type is ambiguous — prompt with a resolver
  const [convertTo, setConvertTo] = useState(null);   // target type awaiting resolution
  const [keepBranch, setKeepBranch] = useState("");
  const requestType = (id, type) => {
    const n = byId[id];
    const kids = childEdges(graph, id);
    if (n && n.type === "decision" && type !== "decision" && kids.length > 0) {
      setConvertTo(type);
      setKeepBranch(kids[0].label || (n.branches && n.branches[0]) || "");
    } else {
      updateType(id, type);
    }
  };
  const cancelConvert = () => setConvertTo(null);
  useEffect(() => { setConvertTo(null); setBranchToRemove(null); }, [cursor]);
  // remove a decision branch, optionally deleting the steps that follow it
  const [branchToRemove, setBranchToRemove] = useState(null);
  const removeBranchResolved = (label, mode) => {
    setGraph((g) => {
      const branchEdge = g.edges.find((e) => e.from === cursor && (e.label || "") === label);
      let nodes = g.nodes.map((n) => (n.id === cursor ? { ...n, branches: (n.branches || []).filter((x) => x !== label) } : n));
      let edges = g.edges.filter((e) => !(e.from === cursor && (e.label || "") === label));
      let ng = { ...g, nodes, edges };
      if (mode === "delete" && branchEdge) {
        // keep only what's still reachable from the real entry points (roots computed BEFORE the cut,
        // so the branch's now-orphaned head isn't mistaken for a root); merged steps survive.
        const roots = g.nodes.filter((n) => n.type === "start" || !g.edges.some((e) => e.to === n.id)).map((n) => n.id);
        const keep = new Set([cursor]); roots.forEach((r) => reachableFrom(ng, r).forEach((id) => keep.add(id)));
        nodes = ng.nodes.filter((n) => keep.has(n.id));
        const keepIds = new Set(nodes.map((n) => n.id));
        ng = { ...ng, nodes, edges: ng.edges.filter((e) => keepIds.has(e.from) && keepIds.has(e.to)) };
      }
      return ng;
    });
    setBranchToRemove(null); setPendingBranch(null);
  };
  const confirmConvert = (mode) => {
    const type = convertTo;
    setGraph((g) => {
      const branchEdges = g.edges.filter((e) => e.from === cursor);
      let edges;
      if (mode === "clear") {
        edges = g.edges.filter((e) => e.from !== cursor);
      } else {
        const keepEdge = branchEdges.find((e) => (e.label || "") === keepBranch) || branchEdges[0];
        edges = g.edges.filter((e) => e.from !== cursor);
        if (keepEdge) edges = [...edges, { from: cursor, to: keepEdge.to, label: "" }];
      }
      let nodes = g.nodes.map((n) => { if (n.id !== cursor) return n; const { branches, _stashBranches, ...rest } = n; return { ...rest, type }; });
      let ng = { ...g, nodes, edges };
      if (mode === "collapse") {
        const start = ng.nodes.find((n) => n.type === "start") || ng.nodes[0];
        const reach = reachableFrom(ng, start ? start.id : null);
        const kept = ng.nodes.filter((n) => reach.has(n.id));
        const keepIds = new Set(kept.map((n) => n.id));
        ng = { ...ng, nodes: kept, edges: ng.edges.filter((e) => keepIds.has(e.from) && keepIds.has(e.to)) };
      }
      return ng;
    });
    setConvertTo(null); setPendingBranch(null);
  };
  const addBranch = (decId, label) => { const b = label.trim(); if (!b) return; setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === decId && !(n.branches || []).includes(b) ? { ...n, branches: [...(n.branches || []), b] } : n)) })); };
  // rename a branch condition — keeps the decision's branch list and its edge labels in sync
  const renameBranch = (decId, oldLabel, newLabel) => {
    const nl = (newLabel || "").trim(); if (!nl || nl === oldLabel) return;
    setGraph((g) => ({ ...g,
      nodes: g.nodes.map((n) => (n.id === decId && n.branches ? { ...n, branches: n.branches.map((b) => (b === oldLabel ? nl : b)) } : n)),
      edges: g.edges.map((e) => (e.from === decId && e.label === oldLabel ? { ...e, label: nl } : e)),
    }));
    if (pendingBranch === oldLabel) setPendingBranch(nl);
  };
  // splice a new step onto an existing connector (from -> to becomes from -> new -> to)
  const insertOnEdge = (fromId, toId, keepLabel = "") => {
    const id = uid(); const node = { id, label: "New step", type: "process" };
    setGraph((g) => ({ ...g, nodes: [...g.nodes, node],
      edges: [...g.edges.filter((e) => !(e.from === fromId && e.to === toId)), { from: fromId, to: id, label: keepLabel }, { from: id, to: toId, label: "" }] }));
    setCursor(id); setPendingBranch(null); setNewLabel("");
  };
  const insertBefore = () => { const e = graph.edges.find((x) => x.to === cursor); if (e) insertOnEdge(e.from, cursor, e.label); };
  const insertAfter = () => {
    const kids = childEdges(graph, cursor);
    if (kids.length === 1) { insertOnEdge(cursor, kids[0].to, kids[0].label); return; }
    if (kids.length === 0) {
      // tip: append a new step after this one
      const id = uid();
      setGraph((g) => ({ ...g, nodes: [...g.nodes, { id, label: "New step", type: "process" }], edges: [...g.edges, { from: cursor, to: id, label: "" }] }));
      setCursor(id); setPendingBranch(null); setNewLabel("");
    }
    // 2+ children (e.g. a decision): "after" is ambiguous — use a branch or the Full-flow connector inserts
  };
  // pick an existing step instead of creating a duplicate — links the flow to it
  const useExisting = (existingId) => {
    if (!existingId || existingId === cursor) return; // never link a step to itself
    setGraph((g) => (g.edges.some((e) => e.from === cursor && e.to === existingId) ? g : { ...g, edges: [...g.edges, { from: cursor, to: existingId, label: pendingBranch || "" }] }));
    setCursor(existingId); setPendingBranch(null); setNewLabel("");
  };
  const childOf = (id) => { const e = childEdges(graph, id)[0]; return e ? e.to : null; };
  const goNext = () => { const c = childOf(cursor); if (c) { setCursor(c); setPendingBranch(null); } };
  const goPrev = () => { const p = parent[cursor]; if (p) { setCursor(p); setPendingBranch(null); } };
  const jumpOpen = (decId, b) => { setCursor(decId); setPendingBranch(b); };
  const back = () => { const p = parent[cursor]; if (p) { setCursor(p); setPendingBranch(null); } };
  const removeCursor = () => {
    if (cursor === "start") return;
    const p = parent[cursor];
    setGraph((g) => {
      const incoming = g.edges.filter((e) => e.to === cursor);
      const outgoing = g.edges.filter((e) => e.from === cursor);
      const bridges = [];
      for (const inE of incoming) for (const outE of outgoing) {
        if (inE.from !== outE.to && !g.edges.some((e) => e.from === inE.from && e.to === outE.to) && !bridges.some((b) => b.from === inE.from && b.to === outE.to))
          bridges.push({ from: inE.from, to: outE.to, label: inE.label || "" });
      }
      return { ...g, nodes: g.nodes.filter((n) => n.id !== cursor), edges: [...g.edges.filter((e) => e.from !== cursor && e.to !== cursor), ...bridges] };
    });
    setCursor(p || "start"); setPendingBranch(null);
  };
  const copyMermaid = () => { try { navigator.clipboard.writeText(toMermaid(graph)); } catch {} setCopied(true); setTimeout(() => setCopied(false), 1200); };

  const [savedFlows, setSavedFlows] = useState(() => loadSaved());
  const [currentId, setCurrentId] = useState(null);
  const [savedTick, setSavedTick] = useState(false);
  const saveFlow = () => {
    const entry = { id: currentId || uid("f"), name: flowName || "Untitled", savedAt: Date.now(), cursor, graph };
    setSavedFlows((prev) => { const list = [entry, ...prev.filter((f) => f.id !== entry.id)].sort((a, b) => b.savedAt - a.savedAt); persistSaved(list); return list; });
    setCurrentId(entry.id); setSavedTick(true); setTimeout(() => setSavedTick(false), 1400);
  };
  const loadFlow = (f) => {
    setGraph(f.graph); setFlowName((f.graph && f.graph.title) || f.name);
    setCursor(f.graph && f.graph.nodes.some((n) => n.id === f.cursor) ? f.cursor : "start");
    setCurrentId(f.id); setPendingBranch(null); setView("build"); setFitKey((k) => k + 1);
  };
  const deleteFlow = (id, e) => { if (e) e.stopPropagation(); setSavedFlows((prev) => { const list = prev.filter((f) => f.id !== id); persistSaved(list); return list; }); if (currentId === id) setCurrentId(null); };
  const newFlow = () => { setGraph({ title: "Untitled flow", nodes: [{ id: "start", label: "Untitled flow", type: "start" }], edges: [] }); setFlowName("Untitled flow"); setCursor("start"); setCurrentId(null); setPendingBranch(null); setView("build"); setFitKey((k) => k + 1); };

  // ---- import a Visio (.vsdx): posts to the process backend, maps the returned graph into the builder ----
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");
  const vsdxRef = useRef(null);
  const jsonRef = useRef(null);
  const onImportJson = async (file) => {
    if (!file) return;
    setImporting(true); setImportErr("");
    try {
      const text = await file.text();
      let data; try { data = JSON.parse(text); } catch { throw new Error("Not valid JSON"); }
      const m = adaptJson(data);
      if (!m.nodes.length) throw new Error(`No flow steps found${Array.isArray(data) ? ` (${data.length} items, but none have text labels or explicit nodes/edges)` : ""}.`);
      setGraph({ title: m.title, nodes: m.nodes, edges: m.edges });
      setFlowName(m.title); setCursor(m.startId); setCurrentId(null); setPendingBranch(null); setView("build"); setFullFlow(true); setFitKey((k) => k + 1);
      const warn = [];
      if (!m.edges.length) warn.push("no connections found");
      if (m.unlabeled) warn.push(`${m.unlabeled} step(s) have no text`);
      setImportErr(warn.length ? `Loaded ${m.nodes.length} steps — ${warn.join(", ")}.` : "");
    } catch (e) { setImportErr(e.message || "Import failed"); }
    finally { setImporting(false); if (jsonRef.current) jsonRef.current.value = ""; }
  };
  const mapImported = (g) => {
    // backend types: start/step/process/manual/decision/end/information -> builder vocabulary
    const typeMap = { start: "start", end: "end", decision: "decision", manual: "manual", information: "information", process: "process", step: "process" };
    const nodes = (g.nodes || []).map((n) => ({ id: String(n.id), label: n.label || "(unnamed)", type: typeMap[n.type] || "process" }));
    const edges = (g.edges || []).map((e) => ({ from: String(e.from), to: String(e.to), label: e.label || "" }));
    const ids = new Set(nodes.map((n) => n.id));
    const clean = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    // derive branches on decisions from their outgoing edge labels (or default Yes/No)
    nodes.forEach((n) => {
      if (n.type === "decision") {
        const labs = [...new Set(clean.filter((e) => e.from === n.id && e.label).map((e) => e.label))];
        n.branches = labs.length ? labs : ["Yes", "No"];
      }
    });
    let start = nodes.find((n) => n.type === "start") || nodes.find((n) => !clean.some((e) => e.to === n.id)) || nodes[0];
    if (!start) { start = { id: "start", label: g.title || "Imported flow", type: "start" }; nodes.unshift(start); }
    return { title: g.title || "Imported flow", nodes, edges: clean, startId: start.id };
  };
  const onImportVsdx = async (file) => {
    if (!file) return;
    setImporting(true); setImportErr("");
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
      const r = await fetch("/diagram/api/process/vsdx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vsdx: b64 }) });
      if (!r.ok) throw new Error(`Import failed (${r.status})`);
      const g = await r.json();
      if (!g.nodes || !g.nodes.length) throw new Error("No shapes found in the .vsdx");
      const m = mapImported(g);
      setGraph({ title: m.title, nodes: m.nodes, edges: m.edges });
      setFlowName(m.title); setCursor(m.startId); setCurrentId(null); setPendingBranch(null); setView("build"); setFullFlow(true); setFitKey((k) => k + 1);
    } catch (e) { setImportErr(e.message || "Import failed"); }
    finally { setImporting(false); if (vsdxRef.current) vsdxRef.current.value = ""; }
  };

  const isDecisionCursor = cur && cur.type === "decision";
  const isEndCursor = cur && cur.type === "end";

  return (
    <div style={{ ...sans, display: "flex", height: "100vh", background: T.paper, color: T.ink }}>
      {/* collapsible panel */}
      {collapsed ? (
        <div style={{ width: 44, background: T.rail, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 14, borderRight: `1px solid ${T.railLine}` }}>
          <button onClick={() => setCollapsed(false)} title="Expand" style={{ background: "transparent", border: "none", color: T.inv, cursor: "pointer" }}><PanelLeftOpen size={18} /></button>
        </div>
      ) : (
        <section style={{ width: 340, minWidth: 300, background: T.rail, color: T.inv, display: "flex", flexDirection: "column", borderRight: `1px solid ${T.railLine}`, overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: `1px solid ${T.railLine}` }}>
            <GitBranch size={17} color={T.amber} />
            <span style={{ fontWeight: 650, fontSize: 14.5 }}>Guided Builder</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setCollapsed(true)} title="Collapse" style={{ background: "transparent", border: "none", color: T.invDim, cursor: "pointer" }}><PanelLeftClose size={17} /></button>
          </div>

          <div style={{ padding: "16px 16px 0" }}>
            <label style={{ ...mono, fontSize: 11, color: T.invDim, textTransform: "uppercase", letterSpacing: "0.07em" }}>Flow name</label>
            <input value={flowName} onChange={(e) => renameStart(e.target.value)} spellCheck={false}
              style={{ ...sans, width: "100%", boxSizing: "border-box", marginTop: 8, fontSize: 14, color: T.inv, background: T.railSoft, border: `1px solid ${T.railLine}`, borderRadius: 9, padding: "10px 12px", outline: "none" }} />
            <div style={{ ...sans, fontSize: 12, color: T.invDim, marginTop: 10, lineHeight: 1.5 }}>
              Build the flow one step at a time. When you add a <b style={{ color: T.inv }}>decision</b>, pick a branch to build or view that side — then switch to the other branch for the other side.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={saveFlow} style={{ ...sans, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "#1a1206", background: savedTick ? "#7ee0a0" : T.amber, border: "none", borderRadius: 9, padding: "9px 12px", cursor: "pointer" }}>
                {savedTick ? <Check size={14} /> : <Save size={14} />}{savedTick ? "Saved" : currentId ? "Update" : "Save"}
              </button>
              <button onClick={newFlow} style={{ ...sans, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 13, fontWeight: 600, color: T.inv, background: T.railSoft, border: `1px solid ${T.railLine}`, borderRadius: 9, padding: "9px 12px", cursor: "pointer" }}>
                <FilePlus2 size={14} /> New
              </button>
            </div>
            <input ref={vsdxRef} type="file" accept=".vsdx" style={{ display: "none" }} onChange={(e) => onImportVsdx(e.target.files[0])} />
            <input ref={jsonRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => onImportJson(e.target.files[0])} />
            <button onClick={() => vsdxRef.current && vsdxRef.current.click()} disabled={importing}
              style={{ ...sans, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8, fontSize: 13, fontWeight: 600, color: T.inv, background: T.railSoft, border: `1px solid ${T.railLine}`, borderRadius: 9, padding: "9px 12px", cursor: importing ? "default" : "pointer", opacity: importing ? 0.6 : 1 }}>
              {importing ? <Cpu size={14} /> : <Upload size={14} />}{importing ? "Importing…" : "Import Visio (.vsdx)"}
            </button>
            <button onClick={() => jsonRef.current && jsonRef.current.click()} disabled={importing}
              style={{ ...sans, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8, fontSize: 13, fontWeight: 600, color: T.inv, background: "transparent", border: `1px solid ${T.railLine}`, borderRadius: 9, padding: "9px 12px", cursor: importing ? "default" : "pointer", opacity: importing ? 0.6 : 1 }}>
              <Upload size={14} /> Import JSON
            </button>
            {importErr && <div style={{ ...sans, fontSize: 11.5, color: "#ffb4a8", marginTop: 6 }}>{importErr}</div>}
            <div style={{ ...sans, fontSize: 11, color: T.invDim, marginTop: 6, lineHeight: 1.45 }}>Imports a .vsdx into an editable flow — decisions, branches and steps are mapped in.</div>
          </div>

          {savedFlows.length > 0 && (
            <div style={{ padding: "16px 16px 0" }}>
              <div style={{ ...mono, fontSize: 11, color: T.invDim, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Saved flows</div>
              {savedFlows.map((f) => {
                const on = f.id === currentId;
                return (
                  <div key={f.id} onClick={() => loadFlow(f)}
                    style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", background: on ? T.railSoft : "transparent", border: `1px solid ${on ? "#3a4a6b" : T.railLine}`, borderRadius: 8, padding: "8px 10px", marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...sans, fontSize: 13, color: T.inv, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</div>
                      <div style={{ ...mono, fontSize: 10, color: T.invDim, marginTop: 2 }}>{(f.graph?.nodes?.length ?? 0)} nodes · {relTime(f.savedAt)}</div>
                    </div>
                    <button onClick={(e) => deleteFlow(f.id, e)} title="Delete" style={{ background: "transparent", border: "none", color: T.invDim, cursor: "pointer", flexShrink: 0 }}><Trash2 size={13} /></button>
                  </div>
                );
              })}
            </div>
          )}

          {open.length > 0 && (
            <div style={{ padding: "16px 16px 0" }}>
              <div style={{ ...mono, fontSize: 11, color: T.invDim, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Unbuilt branches</div>
              {open.map((o, i) => (
                <button key={i} onClick={() => jumpOpen(o.node.id, o.branch)}
                  style={{ ...sans, display: "block", width: "100%", textAlign: "left", cursor: "pointer", background: T.railSoft, border: `1px solid ${T.railLine}`, borderRadius: 8, padding: "8px 10px", marginBottom: 6, fontSize: 12.5, color: T.inv }}>
                  <span style={{ color: "#7fd4ff" }}>{o.branch}</span> · {o.node.label.length > 30 ? o.node.label.slice(0, 30) + "…" : o.node.label}
                </button>
              ))}
            </div>
          )}

          <div style={{ padding: "16px 16px 20px", marginTop: "auto" }}>
            <div style={{ ...mono, fontSize: 11, color: T.invDim, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Export ({graph.nodes.length} nodes)</div>
            <button onClick={() => download(`${flowName.replace(/\s+/g, "_")}.drawio`, toDrawio(graph), "application/xml")}
              style={{ ...sans, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13.5, fontWeight: 600, color: "#1a1206", background: T.amber, border: "none", borderRadius: 9, padding: "10px 14px", cursor: "pointer" }}>
              <Download size={15} /> draw.io (template style)
            </button>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={copyMermaid} style={{ ...sans, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12.5, color: T.inv, background: T.railSoft, border: `1px solid ${T.railLine}`, borderRadius: 9, padding: "9px 10px", cursor: "pointer" }}>
                {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Mermaid"}
              </button>
              <button onClick={() => download(`${flowName.replace(/\s+/g, "_")}.mmd`, toMermaid(graph), "text/plain")} style={{ ...sans, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12.5, color: T.inv, background: T.railSoft, border: `1px solid ${T.railLine}`, borderRadius: 9, padding: "9px 10px", cursor: "pointer" }}>
                <Download size={14} /> .mmd
              </button>
            </div>
          </div>
        </section>
      )}

      {/* builder canvas */}
      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* view toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderBottom: `1px solid ${T.line}`, background: T.panel }}>
          {[["build", "Build", Hammer], ["mindmap", "Mind map", Network], ["paths", "Paths", Route], ["drawio", "Draw.io", ExternalLink]].map(([k, label, Icon]) => {
            const on = view === k;
            return (
              <button key={k} onClick={() => changeView(k)}
                style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: on ? 600 : 500, color: on ? T.ink : T.textDim, background: on ? T.amberSoft : "transparent", border: `1px solid ${on ? "#eccf9f" : "transparent"}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>
                <Icon size={14} /> {label}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          {view === "build" && (
            <div style={{ display: "inline-flex", background: T.paper, border: `1px solid ${T.line}`, borderRadius: 8, padding: 2, marginRight: 10 }}>
              {[["focused", "Focused"], ["full", "Full flow"]].map(([k, label]) => {
                const on = (k === "full") === fullFlow;
                return (
                  <button key={k} onClick={() => setFullFlow(k === "full")}
                    style={{ ...sans, fontSize: 12, fontWeight: on ? 600 : 500, color: on ? T.ink : T.textDim, background: on ? T.panel : "transparent", border: `1px solid ${on ? T.line : "transparent"}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>{label}</button>
                );
              })}
            </div>
          )}
          <span style={{ ...mono, fontSize: 11, color: T.textDim }}>{graph.nodes.length} nodes</span>
        </div>

        {view === "mindmap" && <div style={{ flex: 1, position: "relative" }}><MindMapView graph={graph} /></div>}
        {view === "paths" && (
          <div style={{ flex: 1, position: "relative" }}>
            <PathsPanel laid={laidForPaths} result={pathResult} busy={pathsBusy}
              selected={selPath} onSelect={setSelPath} query={pathQuery} onQuery={setPathQuery}
              edits={edits} setEdits={setEdits} hasEdits={Object.keys(edits).length > 0} onApply={applyEdits} onRenameBranch={renameBranch} onInsert={pathInsert} onAppend={pathAppend} onRemove={pathRemove} />
          </div>
        )}
        {view === "drawio" && (
          <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: `1px solid ${T.line}`, background: T.panel }}>
              <span style={{ ...mono, fontSize: 11, color: T.textDim, whiteSpace: "nowrap" }}>draw.io host</span>
              <input value={drawioUrl} onChange={(e) => setDrawioUrl(e.target.value)} spellCheck={false}
                style={{ ...mono, flex: 1, boxSizing: "border-box", fontSize: 12, color: T.ink, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 7, padding: "6px 9px", outline: "none" }} />
              <button onClick={() => download(`${flowName.replace(/\s+/g, "_")}.drawio`, xml, "application/xml")} title="If the embed is blocked, download and open"
                style={{ ...sans, fontSize: 12, color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 7, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>Download</button>
            </div>
            <div style={{ flex: 1, position: "relative" }}><DrawioFrame url={drawioUrl} xml={xml} onChange={() => {}} /></div>
          </div>
        )}
        {view === "build" && (
        <>
        {/* breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "10px 18px", borderBottom: `1px solid ${T.line}`, background: T.panel }}>
          {chain.map((id, i) => {
            const n = byId[id]; const e = graph.edges.find((x) => x.to === id);
            return (
              <React.Fragment key={id}>
                {i > 0 && <ChevronRight size={13} color={T.textDim} />}
                {e && e.label && <span style={{ ...mono, fontSize: 10.5, color: "#0e86b8" }}>{e.label}</span>}
                <button onClick={() => { setCursor(id); setPendingBranch(null); }}
                  style={{ ...sans, fontSize: 12, cursor: "pointer", color: id === cursor ? T.ink : T.textDim, fontWeight: id === cursor ? 700 : 500, background: id === cursor ? T.amberSoft : "transparent", border: "none", borderRadius: 6, padding: "3px 8px" }}>
                  {n ? (n.label.length > 24 ? n.label.slice(0, 24) + "…" : n.label) : id}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* flow: focused path, or the whole flow when 'Full flow' is on */}
        <div style={{ flex: 1, position: "relative", overflow: fullFlow ? "hidden" : "auto", padding: fullFlow ? 0 : "28px 0 60px", background: "#FCFBF8" }}>
          {fullFlow ? (
            <FullFlowSvg graph={graph} cursor={cursor} onSelect={(id) => { setCursor(id); setPendingBranch(null); }} onEdgeInsert={insertOnEdge} fitKey={fitKey} revealKey={revealKey} />
          ) : (
          <div style={{ maxWidth: 460, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
            {chain.map((id, i) => {
              const n = byId[id]; if (!n) return null;
              const meta = NT[n.type] || NT.step; const isCur = id === cursor;
              const e = graph.edges.find((x) => x.to === id);
              return (
                <React.Fragment key={id}>
                  {i > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      {e && e.label && <span style={{ ...mono, fontSize: 11, color: "#0e86b8", margin: "1px 0" }}>{e.label}</span>}
                      <div style={{ width: 2, height: 18, background: "#CBC7BB" }} />
                      <div style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: "6px solid #CBC7BB", marginTop: -1 }} />
                    </div>
                  )}
                  <div onClick={() => { setCursor(id); setPendingBranch(null); }}
                    style={{ position: "relative", width: n.type === "decision" ? 300 : 340, cursor: "pointer",
                      background: meta.bg, color: meta.fg, border: `${isCur ? 2.5 : 1.5}px solid ${isCur ? T.amber : meta.bd}`,
                      borderRadius: n.type === "start" || n.type === "end" ? 22 : 10, padding: "12px 16px", textAlign: "center",
                      boxShadow: isCur ? "0 2px 10px rgba(217,119,6,.18)" : "none", transform: n.type === "decision" ? "none" : "none" }}>
                    <div style={{ ...mono, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.06em", color: meta.bd, marginBottom: 3 }}>{meta.name}{n.seq != null ? ` · ${n.seq}` : ""}{sharedIds.has(id) ? " · shared" : ""}</div>
                    <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4 }}>{n.label}</div>
                  </div>
                </React.Fragment>
              );
            })}

            {/* the flowchart is a visual guide only — selecting a step opens it in the Edit panel */}
            <div style={{ marginTop: 20, ...mono, fontSize: 11.5, color: T.textDim, textAlign: "center", maxWidth: 340 }}>
              {cursor && byId[cursor]
                ? <>Editing <b style={{ color: T.inkSoft }}>“{trunc(byId[cursor].label, 30)}”</b> in the panel on the right →</>
                : "Click any step to select and edit it →"}
            </div>
          </div>
          )}
        </div>
        </>
        )}
      </section>

      {/* EDIT SECTION — all step options + create-new-step live here, not on the chart */}
      {view === "build" && (
        <section style={{ width: 372, minWidth: 320, background: T.panel, borderLeft: `1px solid ${T.line}`, display: "flex", flexDirection: "column", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 16px", borderBottom: `1px solid ${T.line}` }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: (NT[byId[cursor]?.type] || NT.step).bd }} />
            <span style={{ ...sans, fontWeight: 650, fontSize: 14, color: T.ink }}>Edit step</span>
          </div>

          {byId[cursor] && (() => {
            const node = byId[cursor];
            const selDups = similarSteps(node.label, graph.nodes, cursor);
            return (
              <div style={{ padding: 16 }}>
                {/* step navigation */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  {parent[cursor] && (
                    <button onClick={goPrev} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: T.inkSoft, background: T.paper, border: `1px solid ${T.line}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}><ChevronLeft size={14} /> Prev</button>
                  )}
                  {node.type !== "decision" && childOf(cursor) && (
                    <button onClick={goNext} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: "#1a1206", background: T.amber, border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>Next <ChevronRight size={14} /></button>
                  )}
                </div>
                {/* insert in-between */}
                {cursor !== "start" && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                    {parent[cursor] && (
                      <button onClick={insertBefore} title="Insert a new step before this one" style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: T.inkSoft, background: T.panel, border: `1px dashed ${T.line}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}><Plus size={13} /> insert before</button>
                    )}
                    {node.type !== "decision" && childEdges(graph, cursor).length <= 1 && (
                      <button onClick={insertAfter} title="Insert a new step after this one" style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: T.inkSoft, background: T.panel, border: `1px dashed ${T.line}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}><Plus size={13} /> insert after</button>
                    )}
                  </div>
                )}
                {/* type */}
                <div style={{ ...mono, fontSize: 10.5, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 7 }}>Type</div>
                {cursor === "start" ? (
                  <div style={{ ...sans, fontSize: 12.5, color: T.textDim, marginBottom: 14 }}>Start — the flow entry point.</div>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                    {ADD_TYPES.map((t) => (
                      <button key={t} onClick={() => requestType(cursor, t)}
                        style={{ ...sans, fontSize: 11.5, fontWeight: 600, cursor: "pointer", color: node.type === t ? NT[t].fg : T.textDim, background: node.type === t ? NT[t].bg : "transparent", border: `1px solid ${node.type === t ? NT[t].bd : T.line}`, borderRadius: 7, padding: "5px 10px" }}>{NT[t].name}</button>
                    ))}
                  </div>
                )}

                {/* decision -> single-path resolver */}
                {convertTo && node.type === "decision" && (() => {
                  const branchEdges = childEdges(graph, cursor);
                  const join = reconvergePoint(graph, cursor);
                  return (
                    <div style={{ marginBottom: 16, background: "#FFF6E6", border: "1px solid #E7C878", borderRadius: 10, padding: 12 }}>
                      <div style={{ ...sans, fontSize: 13, fontWeight: 700, color: "#8a5a00", marginBottom: 4 }}>Convert to {NT[convertTo].name}?</div>
                      <div style={{ ...sans, fontSize: 12, color: "#7a5a20", lineHeight: 1.5, marginBottom: 10 }}>
                        This is a decision with {branchEdges.length} branch{branchEdges.length === 1 ? "" : "es"}. A {NT[convertTo].name} step has a single path forward — choose what to keep.
                      </div>
                      {join && byId[join] && (
                        <div style={{ ...sans, fontSize: 12, color: "#0a4a63", background: "#e7f3fb", border: "1px solid #bfe0ee", borderRadius: 7, padding: "7px 9px", marginBottom: 10 }}>
                          ↔ Branches rejoin at “{trunc(byId[join].label, 28)}” — you can collapse them to one path.
                        </div>
                      )}
                      <div style={{ ...mono, fontSize: 10, color: "#8a5a00", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Keep which path</div>
                      {branchEdges.map((e) => {
                        const on = (e.label || "") === keepBranch;
                        return (
                          <button key={e.to} onClick={() => setKeepBranch(e.label || "")}
                            style={{ ...sans, display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", cursor: "pointer", background: on ? "#fff" : "transparent", border: `1.5px solid ${on ? T.amber : T.line}`, borderRadius: 7, padding: "6px 9px", marginBottom: 5, fontSize: 12, color: T.ink }}>
                            <span style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${on ? T.amber : "#bbb"}`, background: on ? T.amber : "#fff", flexShrink: 0 }} />
                            <span style={{ fontWeight: 600, color: "#0a4a63" }}>{e.label || "(no label)"}</span>
                            <span style={{ color: T.textDim }}>→ {byId[e.to] ? trunc(byId[e.to].label, 20) : e.to}</span>
                          </button>
                        );
                      })}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {join && (
                          <button onClick={() => confirmConvert("collapse")} style={{ ...sans, fontSize: 12, fontWeight: 600, color: "#fff", background: "#0e86b8", border: "none", borderRadius: 7, padding: "7px 11px", cursor: "pointer" }}>Collapse to single path</button>
                        )}
                        <button onClick={() => confirmConvert("keep")} style={{ ...sans, fontSize: 12, fontWeight: 600, color: "#1a1206", background: T.amber, border: "none", borderRadius: 7, padding: "7px 11px", cursor: "pointer" }}>Keep selected, detach rest</button>
                        <button onClick={() => confirmConvert("clear")} style={{ ...sans, fontSize: 12, color: "#b85450", background: "#fff", border: "1px solid #e3b3b0", borderRadius: 7, padding: "7px 11px", cursor: "pointer" }}>Clear all branches</button>
                        <button onClick={cancelConvert} style={{ ...sans, fontSize: 12, color: T.inkSoft, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 7, padding: "7px 11px", cursor: "pointer" }}>Cancel</button>
                      </div>
                      <div style={{ ...mono, fontSize: 9.5, color: "#8a5a00", marginTop: 8 }}>detach keeps the sub-flow (orphaned) · collapse removes the redundant parallel steps</div>
                    </div>
                  );
                })()}

                {/* content + duplicate detection */}
                <div style={{ ...mono, fontSize: 10.5, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 7 }}>Content</div>
                <textarea value={node.label} onChange={(e) => updateLabel(cursor, e.target.value)} spellCheck={false}
                  rows={Math.min(6, Math.max(2, Math.ceil(node.label.length / 40)))}
                  style={{ ...sans, width: "100%", boxSizing: "border-box", resize: "vertical", fontSize: 13.5, lineHeight: 1.5, color: T.ink, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px", outline: "none" }} />
                {selDups.length > 0 && (
                  <div style={{ marginTop: 8, background: "#FFF6E6", border: "1px solid #E7C878", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ ...sans, fontSize: 11.5, fontWeight: 600, color: "#8a5a00", marginBottom: 5 }}>⚠ Similar step{selDups.length > 1 ? "s" : ""} elsewhere — click to jump there</div>
                    {selDups.map((s) => (
                      <button key={s.n.id} onClick={() => revealNode(s.n.id)} title="Go to this step in the flow"
                        style={{ ...sans, display: "flex", alignItems: "center", gap: 7, width: "100%", textAlign: "left", cursor: "pointer", background: "#fff", border: `1px solid ${T.line}`, borderRadius: 6, padding: "5px 8px", marginBottom: 4, fontSize: 11.5, color: T.ink }}>
                        <span style={{ ...mono, fontSize: 9.5, color: "#8a5a00", flexShrink: 0 }}>{s.exact ? "SAME" : Math.round(s.score * 100) + "%"}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>{trunc(s.n.label, 40)}</span>
                        <Route size={12} style={{ opacity: 0.55, flexShrink: 0 }} />
                      </button>
                    ))}
                    <div style={{ ...mono, fontSize: 9.5, color: "#8a5a00", marginTop: 2 }}>jumps to that step (centres it in Full-flow view)</div>
                  </div>
                )}

                {/* decision branches */}
                {node.type === "decision" && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ ...mono, fontSize: 10.5, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 7 }}>Branches — edit the condition, click to view or build</div>
                    {(node.branches || []).map((b) => {
                      const child = branchChild(cursor, b); const active = pendingBranch === b;
                      const confirming = branchToRemove === b;
                      return (
                        <div key={b} style={{ marginBottom: 6 }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input defaultValue={b} spellCheck={false} title="Edit branch condition"
                              onBlur={(e) => renameBranch(cursor, b, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                              style={{ ...sans, flex: "0 0 88px", boxSizing: "border-box", fontSize: 12, fontWeight: 600, color: "#0a4a63", background: "#fff", border: `1px solid ${T.line}`, borderRadius: 7, padding: "7px 8px", outline: "none" }} />
                            <button onClick={() => goBranch(b)}
                              style={{ ...sans, display: "flex", alignItems: "center", gap: 6, flex: 1, textAlign: "left", cursor: "pointer", fontSize: 12, fontWeight: 600,
                                color: child ? "#0a4a63" : active ? "#1a1206" : T.inkSoft, background: child ? "#d6ecf7" : active ? T.amberSoft : "#fff",
                                border: `1.5px solid ${child ? "#0e86b8" : active ? T.amber : T.line}`, borderRadius: 8, padding: "7px 9px" }}>
                              {child ? <CornerDownRight size={13} /> : <Plus size={13} />}
                              <span style={{ ...sans, fontWeight: 400, fontSize: 11.5 }}>{child ? trunc(byId[child].label, 16) : active ? "building…" : "empty — build"}</span>
                            </button>
                            <button onClick={() => setBranchToRemove(confirming ? null : b)} title="Remove this branch"
                              style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, color: "#b85450", background: confirming ? "#f8d7d5" : "transparent", border: "1px solid #e3b3b0", borderRadius: 7, cursor: "pointer" }}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                          {confirming && (
                            <div style={{ marginTop: 6, background: "#FFF6E6", border: "1px solid #E7C878", borderRadius: 8, padding: "8px 10px" }}>
                              <div style={{ ...sans, fontSize: 12, color: "#7a5a20", lineHeight: 1.5, marginBottom: 8 }}>
                                Remove the “{b}” branch{child ? ` — should the steps after “${trunc(byId[child].label, 22)}” remain, or be deleted?` : "?"}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {child ? (
                                  <>
                                    <button onClick={() => removeBranchResolved(b, "keep")} style={{ ...sans, fontSize: 12, fontWeight: 600, color: "#1a1206", background: T.amber, border: "none", borderRadius: 7, padding: "7px 11px", cursor: "pointer" }}>Keep the following steps</button>
                                    <button onClick={() => removeBranchResolved(b, "delete")} style={{ ...sans, fontSize: 12, fontWeight: 600, color: "#fff", background: "#b85450", border: "none", borderRadius: 7, padding: "7px 11px", cursor: "pointer" }}>Delete the following steps</button>
                                  </>
                                ) : (
                                  <button onClick={() => removeBranchResolved(b, "keep")} style={{ ...sans, fontSize: 12, fontWeight: 600, color: "#1a1206", background: T.amber, border: "none", borderRadius: 7, padding: "7px 11px", cursor: "pointer" }}>Remove branch</button>
                                )}
                                <button onClick={() => setBranchToRemove(null)} style={{ ...sans, fontSize: 12, color: T.inkSoft, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 7, padding: "7px 11px", cursor: "pointer" }}>Cancel</button>
                              </div>
                              <div style={{ ...mono, fontSize: 9.5, color: "#8a5a00", marginTop: 6 }}>delete removes only steps not reachable another way</div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <input value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} placeholder="New branch label" spellCheck={false}
                        onKeyDown={(e) => { if (e.key === "Enter") { addBranch(cursor, newBranchName); setNewBranchName(""); } }}
                        style={{ ...sans, flex: 1, boxSizing: "border-box", fontSize: 12, color: T.ink, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 7, padding: "6px 8px", outline: "none" }} />
                      <button onClick={() => { addBranch(cursor, newBranchName); setNewBranchName(""); }} style={{ ...sans, fontSize: 12, color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 7, padding: "6px 10px", cursor: "pointer" }}>Add</button>
                    </div>
                  </div>
                )}

                {cursor !== "start" && (
                  <button onClick={removeCursor} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, marginTop: 16, fontSize: 12.5, color: "#b85450", background: "transparent", border: `1px solid #e3b3b0`, borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>
                    <Trash2 size={13} /> Remove this step
                  </button>
                )}
              </div>
            );
          })()}

          {/* create new step */}
          {!isEndCursor && (
            <div style={{ padding: 16, borderTop: `1px solid ${T.line}`, marginTop: "auto" }}>
              <div style={{ ...mono, fontSize: 10.5, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Add next step{isDecisionCursor ? (pendingBranch ? ` — “${pendingBranch}” branch` : " — pick a branch above") : ""}
              </div>
              {(!isDecisionCursor || pendingBranch) && (
                <>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                    {ADD_TYPES.map((t) => (
                      <button key={t} onClick={() => setNewType(t)}
                        style={{ ...sans, fontSize: 11.5, fontWeight: 600, cursor: "pointer", color: newType === t ? NT[t].fg : T.textDim, background: newType === t ? NT[t].bg : "transparent", border: `1px solid ${newType === t ? NT[t].bd : T.line}`, borderRadius: 7, padding: "5px 10px" }}>{NT[t].name}</button>
                    ))}
                  </div>
                  {newType !== "end" && (
                    <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} spellCheck={false} placeholder={newType === "decision" ? "Decision question?" : "Step content"}
                      onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                      style={{ ...sans, width: "100%", boxSizing: "border-box", fontSize: 13, color: T.ink, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px", outline: "none" }} />
                  )}
                  {newType === "decision" && (
                    <input value={newBranches} onChange={(e) => setNewBranches(e.target.value)} spellCheck={false} placeholder="Branches, comma-separated"
                      style={{ ...sans, width: "100%", boxSizing: "border-box", marginTop: 8, fontSize: 12, color: T.inkSoft, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 8, padding: "7px 10px", outline: "none" }} />
                  )}
                  {newType === "information" && infoMasters.length > 0 && (
                    <div style={{ marginTop: 8, background: "#eef7fb", border: "1px solid #bfe0ee", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ ...mono, fontSize: 10, color: "#3a7d99", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Or reuse a shared info block</div>
                      {infoMasters.map((m) => (
                        <button key={m.id} onClick={() => addReference(m.id)} title="Link a shared instance of this info block"
                          style={{ ...sans, display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", cursor: "pointer", background: "#fff", border: `1px solid ${T.line}`, borderRadius: 6, padding: "6px 8px", marginBottom: 5, fontSize: 12, color: "#0a4a5e" }}>
                          <Link2 size={12} /> {trunc(m.label, 42)}
                        </button>
                      ))}
                      <div style={{ ...mono, fontSize: 10, color: "#3a7d99", marginTop: 2 }}>linked instances share content; each keeps its own onward path</div>
                    </div>
                  )}
                  {newLabel.trim() && (() => {
                    const nd = similarSteps(newLabel, graph.nodes, null);
                    return nd.length > 0 ? (
                      <div style={{ marginTop: 8, background: "#FFF6E6", border: "1px solid #E7C878", borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ ...sans, fontSize: 11.5, fontWeight: 600, color: "#8a5a00", marginBottom: 6 }}>
                          {nd.some((s) => s.exact) ? "⚠ This step already exists" : "⚠ Similar step exists — reuse it instead?"}
                        </div>
                        {nd.map((s) => (
                          <div key={s.n.id} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 5 }}>
                            <button onClick={() => useExisting(s.n.id)} title="Link the flow to this existing step instead of creating a duplicate"
                              style={{ ...sans, flex: 1, display: "flex", alignItems: "center", gap: 6, textAlign: "left", cursor: "pointer", background: "#fff", border: `1px solid ${s.exact ? "#c9a24a" : T.line}`, borderRadius: 6, padding: "5px 8px", fontSize: 11.5, color: T.ink }}>
                              <span style={{ ...mono, fontSize: 9.5, fontWeight: 700, color: "#8a5a00" }}>{s.exact ? "SAME" : Math.round(s.score * 100) + "%"}</span>
                              <span style={{ flex: 1, minWidth: 0 }}>{trunc(s.n.label, 34)}</span>
                              <Link2 size={11} style={{ opacity: 0.6, flexShrink: 0 }} />
                            </button>
                            <button onClick={() => setNewLabel(s.n.label)} title="Copy this wording into the box above"
                              style={{ ...sans, cursor: "pointer", background: T.panel, border: `1px solid ${T.line}`, borderRadius: 6, padding: "5px 8px", fontSize: 11, color: T.textDim }}>copy</button>
                          </div>
                        ))}
                        <div style={{ ...mono, fontSize: 10, color: "#8a5a00", marginTop: 2 }}>click the step to link to it (no duplicate) · “copy” just reuses the wording</div>
                      </div>
                    ) : null;
                  })()}
                  {/* route this branch / next step to a step that already exists */}
                  <button onClick={() => setShowPick((v) => !v)}
                    style={{ ...sans, display: "flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "center", marginTop: 8, fontSize: 12, color: T.inkSoft, background: "transparent", border: `1px dashed ${T.line}`, borderRadius: 8, padding: "7px 10px", cursor: "pointer" }}>
                    <Link2 size={13} /> {showPick ? "Hide existing steps" : "Or link to an existing step"}
                  </button>
                  {showPick && (() => {
                    const q = pickQuery.trim().toLowerCase();
                    const candidates = graph.nodes
                      .filter((n) => n.id !== cursor && n.id !== "start" && n.label)
                      .filter((n) => !q || n.label.toLowerCase().includes(q))
                      .slice(0, 40);
                    return (
                      <div style={{ marginTop: 8, background: "#F6F4EE", border: `1px solid ${T.line}`, borderRadius: 8, padding: 8 }}>
                        <input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} spellCheck={false} placeholder="Search existing steps…"
                          style={{ ...sans, width: "100%", boxSizing: "border-box", fontSize: 12.5, color: T.ink, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 7, padding: "7px 9px", outline: "none", marginBottom: 6 }} />
                        <div style={{ maxHeight: 190, overflow: "auto" }}>
                          {candidates.length === 0 && <div style={{ ...sans, fontSize: 12, color: T.textDim, padding: "6px 2px" }}>No matching steps.</div>}
                          {candidates.map((n) => (
                            <button key={n.id} onClick={() => { useExisting(n.id); setShowPick(false); setPickQuery(""); }} title="Route this branch to the existing step (no duplicate)"
                              style={{ ...sans, display: "flex", alignItems: "center", gap: 7, width: "100%", textAlign: "left", cursor: "pointer", background: "#fff", border: `1px solid ${T.line}`, borderRadius: 6, padding: "6px 8px", marginBottom: 5, fontSize: 12, color: T.ink }}>
                              <span style={{ width: 8, height: 8, borderRadius: 2, background: (NT[n.type] || NT.step).bd, flexShrink: 0 }} />
                              <span style={{ flex: 1, minWidth: 0 }}>{trunc(n.label, 40)}</span>
                              <span style={{ ...mono, fontSize: 9, color: T.textDim, textTransform: "uppercase" }}>{(NT[n.type] || {}).name || n.type}</span>
                            </button>
                          ))}
                        </div>
                        <div style={{ ...mono, fontSize: 10, color: T.textDim, marginTop: 2 }}>
                          links {isDecisionCursor && pendingBranch ? `the “${pendingBranch}” branch` : "this step"} to an existing one — flows can rejoin here
                        </div>
                      </div>
                    );
                  })()}
                  <button onClick={add} disabled={newType !== "end" && !newLabel.trim()}
                    style={{ ...sans, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 13.5, fontWeight: 600, marginTop: 8, color: "#1a1206", background: newType === "end" || newLabel.trim() ? T.amber : T.amberSoft, border: "none", borderRadius: 8, padding: "9px 12px", cursor: newType === "end" || newLabel.trim() ? "pointer" : "default" }}>
                    <Plus size={15} /> Add {NT[newType].name.toLowerCase()}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
