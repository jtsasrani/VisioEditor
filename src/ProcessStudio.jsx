import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Play, Cpu, Wand2, Upload, Download, Copy, Check, LayoutGrid, Braces,
  FileCode2, ExternalLink, AlertCircle, Workflow, Settings, X, MessageSquare, Route, Network, Maximize2,
} from "lucide-react";
import PROFILE from "./template-profile.json";

/* ------------------------------------------------------------------ *
 *  Process Studio — business scenario -> numbered draw.io flowchart,
 *  rendered in the uploaded template's house style (styles lifted from
 *  template-profile.json). Same engine shape as Architect Studio:
 *  extract (LLM) -> number + layout (deterministic) -> render -> refine.
 * ------------------------------------------------------------------ */

const T = {
  rail: "#0F1830", railLine: "#27324E", railSoft: "#172238",
  paper: "#FBFAF7", panel: "#FFFFFF", line: "#E6E1D6",
  ink: "#15213B", inkSoft: "#3A465F", amber: "#D97706", amberSoft: "#FBE7C6",
  textDim: "#737B8E", inv: "#EAEEF8", invDim: "#8B97B6",
};
const mono = { fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" };
const sans = { fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" };

/* ---- process vocabulary: role -> template style + preview colour ---- */
// types: start, step (white), process (yellow), manual (red), decision (blue), end
const FILL = { start: "#7030a0", process: "#ffff00", step: "#FFFFFF", manual: "#ff0000", decision: "#00b0f0", end: "#7f7f7f" };
const fillOf = (s) => (String(s).match(/fillColor=(#[0-9a-fA-F]{6}|none)/) || [])[1] || "#ffff00";

function styleFor(type) {
  if (type === "end") return (PROFILE.start?.style || "").replace(/fillColor=#[0-9a-fA-F]{6}/, "fillColor=#7f7f7f");
  return (PROFILE[type] && PROFILE[type].style) || PROFILE.process.style;
}
function badgeStyleFor(type) {
  const base = PROFILE.numberBadgeYellow ? PROFILE.numberBadgeYellow.style : PROFILE.process.style;
  return base.replace(/fillColor=(#[0-9a-fA-F]{6}|none)/, "fillColor=" + fillOf(styleFor(type)));
}
const isNumbered = (type) => type === "process" || type === "step";     // yellow + white only
const isDiamond = (type) => type === "decision" || type === "manual";
const isPill = (type) => type === "start" || type === "end";

/* ---- deterministic top-to-bottom layout + flow-order numbering ---- */
const COLW = 300, ROWH = 210, PAD = 40;
function layoutProcess(graph) {
  const nodes = graph.nodes.map((n) => ({ ...n }));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges = graph.edges.filter((e) => byId[e.from] && byId[e.to]);
  const adj = {}, indeg = {};
  nodes.forEach((n) => { adj[n.id] = []; indeg[n.id] = 0; });
  edges.forEach((e) => { adj[e.from].push(e.to); indeg[e.to]++; });

  // rank = longest path from a source
  const rank = {}, indc = { ...indeg }, order = [];
  nodes.forEach((n) => { if (indeg[n.id] === 0) { rank[n.id] = 0; order.push(n.id); } });
  for (let i = 0; i < order.length; i++)
    adj[order[i]].forEach((v) => { rank[v] = Math.max(rank[v] ?? 0, (rank[order[i]] ?? 0) + 1); if (--indc[v] === 0) order.push(v); });
  nodes.forEach((n) => { if (rank[n.id] == null) rank[n.id] = 0; });

  const rows = [];
  nodes.forEach((n) => { (rows[rank[n.id]] = rows[rank[n.id]] || []).push(n); });
  const maxRow = Math.max(1, ...rows.map((r) => (r ? r.length : 0)));
  const width = PAD * 2 + maxRow * COLW;
  rows.forEach((row, r) => {
    if (!row) return;
    const x0 = (width - row.length * COLW) / 2;
    row.forEach((n, i) => {
      n.w = isDiamond(n.type) ? 170 : isPill(n.type) ? 140 : 220;
      n.h = isDiamond(n.type) ? 120 : isPill(n.type) ? 56 : 90;
      n.x = Math.round(x0 + i * COLW + (COLW - n.w) / 2);
      n.y = Math.round(PAD + r * ROWH);
    });
  });

  // number process/step boxes in flow order (BFS from start)
  const start = nodes.find((n) => n.type === "start") || nodes.find((n) => indeg[n.id] === 0) || nodes[0];
  let seq = 1; const seen = new Set(), q = start ? [start.id] : [];
  while (q.length) {
    const id = q.shift(); if (seen.has(id)) continue; seen.add(id);
    const n = byId[id]; if (n && isNumbered(n.type)) n.seq = seq++;
    (adj[id] || []).forEach((t) => { if (!seen.has(t)) q.push(t); });
  }
  nodes.forEach((n) => { if (isNumbered(n.type) && n.seq == null) n.seq = seq++; });

  return { nodes, edges, byId, width, height: PAD * 2 + rows.length * ROWH };
}

/* ---- render to draw.io mxGraph using the template stencils ---- */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const wrapLabel = (t) =>
  esc(`<div style="font-size: 1px"><font style="font-size:15.52px;font-family:Arial;color:#000000;line-height:120%">${t}</font></div>`);

function toDrawio(laid) {
  let cells = `<mxCell id="0"/><mxCell id="1" parent="0"/>`;
  // white background so the page is white regardless of theme
  cells += `<mxCell id="bg" value="" style="fillColor=#ffffff;strokeColor=none;pointerEvents=0;" vertex="1" parent="1"><mxGeometry x="-40" y="-40" width="${laid.width + 80}" height="${laid.height + 80}" as="geometry"/></mxCell>`;
  for (const n of laid.nodes) {
    cells += `<mxCell id="n${esc(n.id)}" value="${wrapLabel(n.label)}" style="${styleFor(n.type)}" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" as="geometry"/></mxCell>`;
    if (n.seq != null) {
      cells += `<mxCell id="b${esc(n.id)}" value="${wrapLabel(n.seq)}" style="${badgeStyleFor(n.type)}" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="52" height="28" as="geometry"/></mxCell>`;
    }
  }
  laid.edges.forEach((e, i) => {
    const st = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeColor=#000000;fontSize=12;fontFamily=Arial;";
    cells += `<mxCell id="e${i}" value="${esc(e.label || "")}" style="${st}" edge="1" parent="1" source="n${esc(e.from)}" target="n${esc(e.to)}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  });
  const model = `<mxGraphModel dx="900" dy="640" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="850" math="0" shadow="0" background="#ffffff"><root>${cells}</root></mxGraphModel>`;
  return `<mxfile host="process-studio"><diagram name="Process" id="p1">${model}</diagram></mxfile>`;
}

/* ---- schematic SVG preview (matches the roles; real stencils show in draw.io) ---- */
function wrapText(text, max) {
  const words = String(text).split(" "); const lines = []; let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > max) { if (cur) lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) lines.push(cur); return lines.slice(0, 4);
}
function SvgProcess({ laid }) {
  if (!laid) return null;
  const byId = laid.byId;
  return (
    <svg viewBox={`0 0 ${laid.width} ${laid.height}`} style={{ width: "100%", height: "100%" }} preserveAspectRatio="xMidYMid meet">
      <defs><marker id="pa" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#000" /></marker></defs>
      {laid.edges.map((e, i) => {
        const s = byId[e.from], t = byId[e.to]; if (!s || !t) return null;
        const sx = s.x + s.w / 2, sy = s.y + s.h, tx = t.x + t.w / 2, ty = t.y;
        const my = (sy + ty) / 2;
        const d = sx === tx ? `M ${sx} ${sy} L ${tx} ${ty}` : `M ${sx} ${sy} V ${my} H ${tx} V ${ty}`;
        return (<g key={i}>
          <path d={d} fill="none" stroke="#000" strokeWidth="1.4" markerEnd="url(#pa)" opacity="0.85" />
          {e.label && <text x={(sx + tx) / 2 + 6} y={my - 4} fontSize="11" fill="#555" style={mono}>{e.label}</text>}
        </g>);
      })}
      {laid.nodes.map((n) => {
        const fill = FILL[n.type] || "#ffff00";
        const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
        const label = (
          <text x={cx} y={cy} fontSize="12.5" fill={n.type === "manual" || n.type === "start" || n.type === "end" ? "#fff" : "#000"}
            textAnchor="middle" dominantBaseline="middle" style={{ ...sans, fontWeight: 500 }}>
            {wrapText(n.label, isDiamond(n.type) ? 14 : 24).map((ln, i, a) => (
              <tspan key={i} x={cx} dy={i === 0 ? -(a.length - 1) * 7 : 14}>{ln}</tspan>))}
          </text>);
        return (
          <g key={n.id}>
            {isDiamond(n.type) && (
              <polygon points={`${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}`}
                fill={fill} stroke="#000" strokeWidth="1.5" />
            )}
            {isPill(n.type) && (
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.h / 2} fill={fill} stroke="#000" strokeWidth="1.5" />
            )}
            {!isDiamond(n.type) && !isPill(n.type) && (
              <rect x={n.x} y={n.y} width={n.w} height={n.h} fill={fill} stroke="#000" strokeWidth="1.5" />
            )}
            {label}
            {n.seq != null && (
              <g>
                <rect x={n.x} y={n.y} width="46" height="26" fill={fill} stroke="#000" strokeWidth="1.5" />
                <text x={n.x + 23} y={n.y + 13} fontSize="12" fill={n.type === "manual" ? "#fff" : "#000"}
                  textAnchor="middle" dominantBaseline="middle" style={{ ...sans, fontWeight: 700 }}>{n.seq}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ---- enumerate every distinct route start -> end (simple paths, capped) ---- */
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
const TYPE_TAG = { start: "#82b366", end: "#7f7f7f", process: "#c99700", step: "#8a8a8a", manual: "#b85450", decision: "#0e86b8" };
const trunc = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);

// word-set (Jaccard) similarity to surface near-duplicate steps for reuse
function similarSteps(text, nodes, excludeId, k = 5) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const a = new Set(norm(text)); if (!a.size) return [];
  return nodes.filter((n) => n.id !== excludeId && n.label)
    .map((n) => { const b = new Set(norm(n.label)); const inter = [...a].filter((w) => b.has(w)).length; const uni = new Set([...a, ...b]).size; return { n, score: uni ? inter / uni : 0 }; })
    .filter((x) => x.score >= 0.3).sort((x, y) => y.score - x.score).slice(0, k);
}

function PathsPanel({ laid, result, busy, selected, onSelect, query, onQuery, edits, setEdits, hasEdits, onApply }) {
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
  const PROC_TYPES = ["start", "step", "process", "manual", "decision", "end"];

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
              <button onClick={() => downloadText(`path-${selected + 1}.txt`, pathToText(laid, sel, selected + 1, edits), "text/plain")}
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
                  <li key={i} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: `1px solid #F1EFE8` }}>
                    <span style={{ ...mono, fontSize: 12, color: T.textDim, minWidth: 22, textAlign: "right", paddingTop: 6 }}>{i + 1}</span>
                    <span style={{ marginTop: 8, width: 9, height: 9, borderRadius: 2, background: tag, flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ ...mono, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: tag }}>
                          step{n.seq != null ? ` ${n.seq}` : ""}{dirty ? " · edited" : ""}
                        </span>
                        <select value={curType} onChange={(ev) => setType(id, ev.target.value)}
                          style={{ ...mono, fontSize: 10.5, color: tag, background: "#fff", border: `1px solid ${dirty && e.type != null ? T.amber : T.line}`, borderRadius: 6, padding: "2px 4px", cursor: "pointer", textTransform: "uppercase" }}>
                          {PROC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
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
                      {branch && <div style={{ fontSize: 12.5, color: T.amber, fontWeight: 600, marginTop: 6 }}>→ {branch}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
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

/* ---- small UI atoms ---- */
function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { try { navigator.clipboard.writeText(text); } catch {} setDone(true); setTimeout(() => setDone(false), 1200); }}
      style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 7, padding: "5px 10px", cursor: "pointer" }}>
      {done ? <Check size={13} /> : <Copy size={13} />}{done ? "Copied" : "Copy"}
    </button>
  );
}
function CodePane({ title, text }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "#0F1830" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: `1px solid ${T.railLine}` }}>
        <span style={{ ...mono, fontSize: 12.5, color: T.inv }}>{title}</span><div style={{ flex: 1 }} /><CopyBtn text={text} />
      </div>
      <pre style={{ ...mono, flex: 1, margin: 0, overflow: "auto", padding: 16, fontSize: 12.5, lineHeight: 1.6, color: "#cdd6ef", whiteSpace: "pre" }}>{text}</pre>
    </div>
  );
}
function downloadText(name, text, type) {
  const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- mock generator (offline) ---- */
function mockProcess() {
  return {
    title: "Change of Income",
    nodes: [
      { id: "s", label: "Inbound call", type: "start" },
      { id: "ch", label: "Select Call or Post as the request channel", type: "step" },
      { id: "id", label: "Manually verify identity documents", type: "manual" },
      { id: "nrp", label: "Select the NRP and view last assessed income", type: "process" },
      { id: "d1", label: "RTI present?", type: "decision" },
      { id: "rti", label: "Load RTI income into the assessment", type: "process" },
      { id: "ev", label: "Request evidence from the customer", type: "process" },
      { id: "d2", label: "Evidence received in tolerance?", type: "decision" },
      { id: "upd", label: "Update the income assessment", type: "process" },
      { id: "close", label: "Close the service request", type: "end" },
    ],
    edges: [
      { from: "s", to: "ch" }, { from: "ch", to: "id" }, { from: "id", to: "nrp" }, { from: "nrp", to: "d1" },
      { from: "d1", to: "rti", label: "Yes" }, { from: "d1", to: "ev", label: "No" },
      { from: "rti", to: "upd" }, { from: "ev", to: "d2" },
      { from: "d2", to: "upd", label: "Yes" }, { from: "d2", to: "close", label: "No" }, { from: "upd", to: "close" },
    ],
  };
}

/* ================================================================== */
export default function ProcessStudio({ onRegister }) {
  const [prompt, setPrompt] = useState(
    "A change-of-income process: an inbound call comes in, the caseworker selects the channel, " +
    "manually verifies identity, selects the NRP and views last assessed income. If RTI is present, " +
    "load it; otherwise request evidence and check it's within tolerance. Update the assessment and close the request."
  );
  const [laid, setLaid] = useState(null);
  const [graph, setGraph] = useState(null);
  const [xml, setXml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState("diagram"); // diagram | json | xml | editor
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refining, setRefining] = useState(false);
  const [history, setHistory] = useState([]);
  const [pathResult, setPathResult] = useState(null);
  const [selPath, setSelPath] = useState(null);
  const [pathsBusy, setPathsBusy] = useState(false);
  const [pathQuery, setPathQuery] = useState("");
  const [edits, setEdits] = useState({});

  const [showCfg, setShowCfg] = useState(false);
  const [mode, setMode] = useState("mock");
  const [endpoint, setEndpoint] = useState("/diagram/api/process");
  const [drawioUrl, setDrawioUrl] = useState("https://embed.diagrams.net/");
  const fileRef = useRef(null);

  const stateRef = useRef();
  stateRef.current = { prompt, graph, laid, xml, view, history };

  useEffect(() => {
    if (onRegister) {
      onRegister({
        getSaveData: () => ({
          title: stateRef.current.graph ? (stateRef.current.graph.title || "Scenario Flow") : "Scenario Flow",
          prompt: stateRef.current.prompt,
          graph: stateRef.current.graph,
          laid: stateRef.current.laid,
          xml: stateRef.current.xml,
          view: stateRef.current.view,
          history: stateRef.current.history,
        }),
        loadData: (data) => {
          if (data.prompt) setPrompt(data.prompt);
          if (data.graph) setGraph(data.graph);
          if (data.laid) setLaid(data.laid);
          if (data.xml) setXml(data.xml);
          if (data.view) setView(data.view);
          if (data.history) setHistory(data.history);
          setEdits({});
          setSelPath(null);
          setPathResult(null);
        }
      });
    }
  }, [onRegister]);

  const render = useCallback((g) => {
    const l = layoutProcess(g); setGraph(g); setLaid(l); setXml(toDrawio(l));
    setPathResult(null); setSelPath(null); setEdits({});
  }, []);

  // push edited step text/type back into the graph, then re-layout/number/serialise
  const applyEdits = useCallback(() => {
    if (!graph || !Object.keys(edits).length) return;
    const ng = { ...graph, nodes: graph.nodes.map((n) => {
      const e = edits[n.id]; if (e == null) return n;
      return { ...n, label: e.label != null ? e.label : n.label, type: e.type != null ? e.type : n.type };
    }) };
    render(ng);
  }, [graph, edits, render]);

  // enumerate paths lazily the first time the Paths tab is opened for a graph
  useEffect(() => {
    if (view === "paths" && laid && !pathResult) {
      setPathsBusy(true);
      const t = setTimeout(() => { setPathResult(enumeratePaths(laid)); setPathsBusy(false); }, 20);
      return () => clearTimeout(t);
    }
  }, [view, laid, pathResult]);

  const generate = useCallback(async () => {
    setBusy(true); setError(null); setHistory([]);
    try {
      const g = mode === "live" ? await callEndpoint(endpoint, { prompt }) : (await sleep(300), mockProcess());
      render(g); setView("diagram");
    } catch (e) { setError(e.message || "Generation failed"); } finally { setBusy(false); }
  }, [mode, endpoint, prompt, render]);

  const refine = useCallback(async () => {
    const instruction = refinePrompt.trim(); if (!instruction || !graph || refining) return;
    setRefining(true); setError(null);
    try {
      let g;
      if (mode === "live") g = await callEndpoint(endpoint, { instruction, currentGraph: graph });
      else { g = mockRefine(graph, instruction); await sleep(250); }
      render(g); setHistory((h) => [...h, instruction]); setRefinePrompt(""); setView("diagram");
    } catch (e) { setError(e.message || "Refine failed"); } finally { setRefining(false); }
  }, [refinePrompt, graph, mode, endpoint, refining, render]);

  const onUpload = useCallback(async (file) => {
    if (!file) return;
    setBusy(true); setError(null); setHistory([]);
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
      const url = endpoint.replace(/process$/, "process/vsdx");
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vsdx: b64 }) });
      if (!r.ok) throw new Error(`Import failed (${r.status})`);
      const g = await r.json(); if (!g.nodes || !g.nodes.length) throw new Error("No shapes found in the .vsdx");
      render(g); setView("diagram");
    } catch (e) { setError(e.message || "Import failed"); } finally { setBusy(false); }
  }, [endpoint, render]);

  const tabs = [
    { k: "diagram", label: "Diagram", icon: LayoutGrid },
    { k: "mindmap", label: "Mind map", icon: Network },
    { k: "paths", label: "Paths", icon: Route },
    { k: "json", label: "Process JSON", icon: Braces },
    { k: "xml", label: "draw.io XML", icon: FileCode2 },
    { k: "editor", label: "Edit in draw.io", icon: ExternalLink },
  ];

  return (
    <div style={{ ...sans, display: "flex", flexDirection: "column", height: "100vh", background: T.paper, color: T.ink }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", background: T.rail, color: T.inv, borderBottom: `1px solid ${T.railLine}` }}>
        <Workflow size={18} color={T.amber} />
        <span style={{ fontWeight: 650, fontSize: 15 }}>Process Studio</span>
        <span style={{ ...mono, fontSize: 11, color: T.invDim }}>scenario → numbered flow</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowCfg(true)} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: T.inv, background: T.railSoft, border: `1px solid ${T.railLine}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>
          <Settings size={14} /> Endpoint <span style={{ ...mono, fontSize: 10, color: mode === "live" ? "#7ee0a0" : T.invDim }}>{mode === "live" ? "LIVE" : "MOCK"}</span>
        </button>
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }} className="ps-body">
        {/* console */}
        <section className="ps-console" style={{ width: 380, minWidth: 300, maxWidth: "45%", display: "flex", flexDirection: "column", background: T.rail, color: T.inv, overflowY: "auto", borderRight: `1px solid ${T.railLine}` }}>
          <div style={{ padding: "16px 18px 0" }}>
            <label style={{ ...mono, fontSize: 11, color: T.invDim, textTransform: "uppercase", letterSpacing: "0.08em" }}>Business scenario</label>
          </div>
          <div style={{ padding: "8px 18px 0" }}>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} spellCheck={false}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); generate(); } }}
              placeholder="Describe the process in prose — the steps, the manual actions, and the decisions…"
              style={{ ...sans, width: "100%", height: 150, boxSizing: "border-box", resize: "vertical", lineHeight: 1.55, fontSize: 14, color: T.inv, background: T.railSoft, border: `1px solid ${T.railLine}`, borderRadius: 10, padding: 14, outline: "none" }} />
          </div>
          <div style={{ padding: "12px 18px 8px" }}>
            {error && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 12, fontSize: 12.5, color: "#ffd2cc", background: "#3a1d1d", border: "1px solid #5a2a2a", borderRadius: 9, padding: "9px 11px" }}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span>
              </div>
            )}
            <button onClick={generate} disabled={busy || refining}
              style={{ ...sans, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, fontSize: 14.5, fontWeight: 600, color: "#1a1206", background: busy ? T.amberSoft : T.amber, border: "none", borderRadius: 10, padding: "12px 14px", cursor: busy ? "default" : "pointer" }}>
              {busy ? <Cpu size={16} className="ps-spin" /> : <Play size={16} />}{busy ? "Working…" : "Generate flow"}
            </button>
            <input ref={fileRef} type="file" accept=".vsdx" style={{ display: "none" }} onChange={(e) => onUpload(e.target.files[0])} />
            <button onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}
              style={{ ...sans, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, fontWeight: 600, marginTop: 9, color: T.inv, background: "transparent", border: `1px solid ${T.railLine}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}>
              <Upload size={15} /> Import a Visio (.vsdx)
            </button>
            <div style={{ ...mono, fontSize: 10.5, color: T.invDim, textAlign: "center", marginTop: 9 }}>⌘↵ to generate</div>
          </div>

          {laid && (
            <div style={{ padding: "14px 18px 20px", borderTop: `1px solid ${T.railLine}` }}>
              <label style={{ ...mono, fontSize: 11, color: T.invDim, textTransform: "uppercase", letterSpacing: "0.08em" }}>Correct the flow</label>
              <textarea value={refinePrompt} onChange={(e) => setRefinePrompt(e.target.value)} spellCheck={false}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); refine(); } }}
                placeholder="e.g. add a manual approval step after step 3 · the RTI branch should loop back to the assessment"
                style={{ ...sans, width: "100%", height: 70, boxSizing: "border-box", resize: "vertical", marginTop: 8, lineHeight: 1.5, fontSize: 13.5, color: T.inv, background: T.railSoft, border: `1px solid ${T.railLine}`, borderRadius: 10, padding: 12, outline: "none" }} />
              <button onClick={refine} disabled={refining || busy || !refinePrompt.trim()}
                style={{ ...sans, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13.5, fontWeight: 600, marginTop: 10, color: T.inv, background: refinePrompt.trim() ? T.railSoft : "transparent", border: `1px solid ${refinePrompt.trim() ? "#3a4a6b" : T.railLine}`, borderRadius: 10, padding: "10px 14px", cursor: refining || !refinePrompt.trim() ? "default" : "pointer", opacity: refinePrompt.trim() ? 1 : 0.55 }}>
                {refining ? <Cpu size={15} className="ps-spin" /> : <Wand2 size={15} />}{refining ? "Applying…" : "Apply change"}
              </button>
              {history.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ ...mono, fontSize: 10.5, color: T.invDim, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 9 }}>Change history</div>
                  {history.map((h, i) => (
                    <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 7 }}>
                      <span style={{ ...mono, fontSize: 10.5, color: "#1a1206", background: T.amber, borderRadius: 5, minWidth: 18, height: 18, display: "grid", placeItems: "center", marginTop: 1, flexShrink: 0 }}>{i + 1}</span>
                      <div style={{ ...sans, fontSize: 12.5, color: T.inv, lineHeight: 1.4 }}>{h}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* canvas */}
        <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: T.paper }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 12px", borderBottom: `1px solid ${T.line}`, background: T.panel }}>
            {tabs.map((tab) => {
              const on = view === tab.k; const Icon = tab.icon;
              return (
                <button key={tab.k} onClick={() => setView(tab.k)} disabled={!laid}
                  style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: on ? 600 : 500, color: on ? T.ink : T.textDim, background: on ? T.amberSoft : "transparent", border: `1px solid ${on ? "#eccf9f" : "transparent"}`, borderRadius: 8, padding: "6px 11px", cursor: laid ? "pointer" : "default", opacity: laid ? 1 : 0.5 }}>
                  <Icon size={14} /> {tab.label}
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            {laid && (
              <button onClick={() => downloadText("process.drawio", xml, "application/xml")}
                style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "6px 11px", cursor: "pointer" }}>
                <Download size={13} /> .drawio
              </button>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
            {!laid && (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: T.textDim }}>
                <div style={{ textAlign: "center" }}>
                  <Workflow size={30} style={{ opacity: 0.4 }} />
                  <div style={{ marginTop: 12, fontSize: 14 }}>Describe a process or import a Visio file.</div>
                </div>
              </div>
            )}
            {laid && view === "diagram" && (
              <div style={{ position: "absolute", inset: 0, overflow: "auto", background: "#fff" }}>
                <div style={{ width: laid.width, minHeight: laid.height, margin: "0 auto", padding: 12 }}>
                  <SvgProcess laid={laid} />
                </div>
              </div>
            )}
            {laid && view === "json" && <CodePane title={graph.title || "process"} text={JSON.stringify(graph, null, 2)} />}
            {laid && view === "xml" && <CodePane title="draw.io mxGraph" text={xml} />}
            {laid && view === "editor" && <DrawioFrame url={drawioUrl} xml={xml} onChange={() => {}} />}
            {laid && view === "mindmap" && <MindMapView graph={graph} />}
            {laid && view === "paths" && (
              <PathsPanel laid={laid} result={pathResult} busy={pathsBusy}
                selected={selPath} onSelect={setSelPath}
                query={pathQuery} onQuery={setPathQuery}
                edits={edits} setEdits={setEdits}
                hasEdits={Object.keys(edits).length > 0} onApply={applyEdits} />
            )}
          </div>
        </section>
      </div>

      {showCfg && (
        <div onClick={() => setShowCfg(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,24,48,.5)", display: "flex", justifyContent: "flex-end", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...sans, width: 440, maxWidth: "92vw", height: "100%", background: T.panel, borderLeft: `1px solid ${T.line}`, padding: 20, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <span style={{ fontSize: 15, fontWeight: 650 }}>Endpoint</span><div style={{ flex: 1 }} />
              <button onClick={() => setShowCfg(false)} style={{ background: "none", border: "none", cursor: "pointer", color: T.textDim }}><X size={18} /></button>
            </div>
            <div style={{ ...mono, fontSize: 11, color: T.textDim, textTransform: "uppercase", marginBottom: 8 }}>Source</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {["mock", "live"].map((m) => (
                <button key={m} onClick={() => setMode(m)} style={{ ...sans, flex: 1, fontSize: 13, fontWeight: 600, padding: 10, borderRadius: 9, cursor: "pointer", color: mode === m ? T.ink : T.textDim, background: mode === m ? T.amberSoft : T.panel, border: `1px solid ${mode === m ? "#eccf9f" : T.line}` }}>{m === "mock" ? "Mock" : "Live (Bedrock)"}</button>
              ))}
            </div>
            <div style={{ ...mono, fontSize: 11, color: T.textDim, textTransform: "uppercase", marginBottom: 8 }}>Process endpoint (POST)</div>
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} spellCheck={false}
              style={{ ...mono, width: "100%", boxSizing: "border-box", fontSize: 12.5, color: T.ink, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "10px 12px", outline: "none", marginBottom: 16 }} />
            <div style={{ ...mono, fontSize: 11, color: T.textDim, textTransform: "uppercase", marginBottom: 8 }}>draw.io base URL</div>
            <input value={drawioUrl} onChange={(e) => setDrawioUrl(e.target.value)} spellCheck={false}
              style={{ ...mono, width: "100%", boxSizing: "border-box", fontSize: 12.5, color: T.ink, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "10px 12px", outline: "none" }} />
            <div style={{ ...sans, fontSize: 12, color: T.textDim, marginTop: 8, lineHeight: 1.5 }}>Point at your self-hosted drawio build so the embedded editor stays in-boundary. Import posts the .vsdx to {"{endpoint}/vsdx"}.</div>
          </div>
        </div>
      )}

      <style>{`
        .ps-spin { animation: ps-rot .9s linear infinite; }
        @keyframes ps-rot { to { transform: rotate(360deg); } }
        @media (max-width: 760px) { .ps-body { flex-direction: column !important; } .ps-console { width: 100% !important; max-width: 100% !important; border-right: none !important; } }
        textarea:focus, input:focus { border-color: ${T.amber} !important; }
      `}</style>
    </div>
  );
}

/* ---- endpoint call (generate + refine share one route) ---- */
async function callEndpoint(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Endpoint returned ${r.status}`);
  const d = await r.json();
  if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) throw new Error("Response must contain nodes[] and edges[]");
  return d;
}

/* ---- mock refine: apply simple structural edits (offline) ---- */
function mockRefine(graph, instruction) {
  const g = JSON.parse(JSON.stringify(graph));
  const low = instruction.toLowerCase();
  const clean = (s) => s.replace(/[.?!]+$/, "").trim();
  const find = (q) => { q = clean(q); return g.nodes.find((n) => n.label.toLowerCase().includes(q)); };
  const preds = (id) => g.edges.filter((e) => e.to === id).map((e) => e.from);
  const succs = (id) => g.edges.filter((e) => e.from === id).map((e) => e.to);
  const uid = (b) => { let id = b, i = 1; while (g.nodes.some((n) => n.id === id)) id = `${b}_${++i}`; return id; };
  let m;
  if ((m = low.match(/^(?:remove|delete)\s+(?:the\s+)?(.+)/))) {
    const t = find(m[1]); if (!t) return g;
    const ps = preds(t.id), ss = succs(t.id);
    g.edges = g.edges.filter((e) => e.from !== t.id && e.to !== t.id);
    ps.forEach((p) => ss.forEach((s) => { if (!g.edges.some((e) => e.from === p && e.to === s)) g.edges.push({ from: p, to: s }); }));
    g.nodes = g.nodes.filter((n) => n.id !== t.id); return g;
  }
  if (low.startsWith("add")) {
    const rm = low.match(/add\s+(?:an?\s+)?(?:(manual|decision|step|process)\s+)?(?:step\s+)?(.+?)(?:\s+(after|before)\s+(.+))?$/);
    const type = rm && rm[1] ? (rm[1] === "step" ? "step" : rm[1]) : "process";
    const name = clean(rm ? rm[2] : instruction);
    const id = uid("n"); g.nodes.push({ id, label: name.charAt(0).toUpperCase() + name.slice(1), type });
    if (rm && rm[3] && rm[4]) {
      const anchor = find(rm[4]);
      if (anchor) {
        if (rm[3] === "after") { const ss = succs(anchor.id); g.edges = g.edges.filter((e) => e.from !== anchor.id); g.edges.push({ from: anchor.id, to: id }); ss.forEach((s) => g.edges.push({ from: id, to: s })); }
        else { const ps = preds(anchor.id); g.edges = g.edges.filter((e) => e.to !== anchor.id); ps.forEach((p) => g.edges.push({ from: p, to: id })); g.edges.push({ from: id, to: anchor.id }); }
        return g;
      }
    }
    const sink = g.nodes.find((n) => n.id !== id && succs(n.id).length === 0);
    if (sink) g.edges.push({ from: sink.id, to: id });
    return g;
  }
  if ((m = low.match(/^rename\s+(?:the\s+)?(.+?)\s+to\s+(.+)/))) {
    const t = find(m[1]); if (t) t.label = clean(m[2]); return g;
  }
  return g;
}
