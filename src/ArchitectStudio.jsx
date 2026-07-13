import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Play, Settings, Copy, Check, Braces, LayoutGrid, FileCode2,
  ExternalLink, Cpu, AlertCircle, Workflow, Download, Radio, X, MessageSquare, Wand2, FileText
} from "lucide-react";

/* ------------------------------------------------------------------ *
 *  Architect Studio — prompt → Graph JSON → layout → mxGraph
 *  A self-contained prototype. The mock "Bedrock" call is swappable
 *  for a real endpoint (see CONTRACT below). The draw.io embed points
 *  at a configurable URL so you can drop in a self-hosted build.
 * ------------------------------------------------------------------ */

const T = {
  rail: "#0F1830", railLine: "#27324E", railSoft: "#172238",
  paper: "#FBFAF7", panel: "#FFFFFF", line: "#E6E1D6", grid: "#E9EEF7",
  ink: "#15213B", inkSoft: "#3A465F",
  amber: "#D97706", amberSoft: "#FBE7C6",
  teal: "#0E7C7B",
  textDim: "#737B8E",
  inv: "#EAEEF8", invDim: "#8B97B6",
};

const CAT = {
  client:   { fill: "#DAE8FC", stroke: "#6C8EBF", label: "Client" },
  edge:     { fill: "#FFF2CC", stroke: "#D6B656", label: "Edge / Network" },
  compute:  { fill: "#D5E8D4", stroke: "#82B366", label: "Compute" },
  ai:       { fill: "#E1D5E7", stroke: "#9673A6", label: "AI / ML" },
  data:     { fill: "#FFE6CC", stroke: "#D79B00", label: "Data / Storage" },
  event:    { fill: "#F1F1F1", stroke: "#999999", label: "Event / Queue" },
  external: { fill: "#F8CECC", stroke: "#B85450", label: "External" },
  default:  { fill: "#FFFFFF", stroke: "#9AA3B2", label: "Service" },
};

function categoryOf(type = "") {
  const t = String(type).toLowerCase();
  if (CAT[t]) return t;
  if (/client|user|browser|ui|frontend|caseworker|trainee|agent ui/.test(t)) return "client";
  if (/cloudfront|api ?gateway|apigw|gateway|edge|cdn|route ?53|alb|elb|nat|load.?bal|network/.test(t)) return "edge";
  if (/lambda|ec2|fargate|compute|ecs|glue|etl|function|proxy|step ?function/.test(t)) return "compute";
  if (/bedrock|sagemaker|nova|claude|titan|model|llm|embedding|inference|agent/.test(t)) return "ai";
  if (/s3|dynamo|rds|aurora|opensearch|vector|store|database|\bdb\b|kb|knowledge|registry|feature/.test(t)) return "data";
  if (/eventbridge|sqs|sns|kafka|event|queue|stream/.test(t)) return "event";
  if (/external|third|elevenlabs|openai|saas|partner|siebel/.test(t)) return "external";
  return "default";
}

/* ------------------------------------------------------------------ *
 *  Containment: container node types, their SVG styling, and the
 *  AWS stencil registry (the deterministic "service -> picture" map).
 * ------------------------------------------------------------------ */
const CONTAINERS = new Set([
  "account", "region", "vpc", "az", "public_subnet", "private_subnet", "security_group",
]);
const isContainer = (type = "") => CONTAINERS.has(String(type).toLowerCase());

// SVG styling for containers — dashed, tinted, labelled top-left
const GROUP = {
  account:        { stroke: "#C2640A", label: "AWS account" },
  region:         { stroke: "#3A465F", label: "Region" },
  vpc:            { stroke: "#7F77DD", label: "VPC" },
  az:             { stroke: "#888780", label: "Availability zone" },
  public_subnet:  { stroke: "#639922", label: "Public subnet" },
  private_subnet: { stroke: "#185FA5", label: "Private subnet" },
  security_group: { stroke: "#A32D2D", label: "Security group" },
};
const groupOf = (type) => GROUP[String(type).toLowerCase()] || { stroke: "#5F5E5A", label: "Group" };

// draw.io AWS group stencils (containers). Names may need tweaking per drawio version.
const GROUP_STENCIL = {
  account:        "mxgraph.aws4.group_aws_cloud_alt",
  region:         "mxgraph.aws4.group_region",
  vpc:            "mxgraph.aws4.group_vpc",
  az:            "mxgraph.aws4.group_availability_zone",
  public_subnet:  "mxgraph.aws4.group_public_subnet",
  private_subnet: "mxgraph.aws4.group_private_subnet",
  security_group: "mxgraph.aws4.group_security_group",
};

// draw.io AWS resource icons (leaves). Anything not here falls back to a coloured box.
const STENCIL = {
  lambda: "mxgraph.aws4.lambda",
  ec2: "mxgraph.aws4.ec2",
  s3: "mxgraph.aws4.s3",
  dynamodb: "mxgraph.aws4.dynamodb",
  rds: "mxgraph.aws4.rds",
  aurora: "mxgraph.aws4.aurora",
  apigateway: "mxgraph.aws4.api_gateway",
  cloudfront: "mxgraph.aws4.cloudfront",
  elb: "mxgraph.aws4.elastic_load_balancing",
  natgateway: "mxgraph.aws4.nat_gateway",
  bedrock: "mxgraph.aws4.bedrock",
  sagemaker: "mxgraph.aws4.sagemaker",
  opensearch: "mxgraph.aws4.opensearch_service",
  eventbridge: "mxgraph.aws4.eventbridge",
  sqs: "mxgraph.aws4.simple_queue_service_sqs",
  cloudwatch: "mxgraph.aws4.cloudwatch",
};
const STENCIL_REV = Object.fromEntries(Object.entries(STENCIL).map(([k, v]) => [v, k]));
const GROUP_REV = Object.fromEntries(Object.entries(GROUP_STENCIL).map(([k, v]) => [v, k]));

// Official AWS resource-icon category colours (aws4). The white glyph renders
// on these solid tiles — pastel fills make the icon disappear.
const CATEGORY_COLOR = {
  compute:    { fill: "#ED7100", grad: "#F78E04" },
  networking: { fill: "#8C4FFF", grad: "#945DF2" },
  storage:    { fill: "#277116", grad: "#60A337" },
  database:   { fill: "#C925D1", grad: "#E330EE" },
  ml:         { fill: "#01A88D", grad: "#19C9AF" },
  appint:     { fill: "#E7157B", grad: "#F050A0" },
  mgmt:       { fill: "#E7157B", grad: "#F050A0" },
  security:   { fill: "#DD344C", grad: "#EB5E6E" },
  analytics:  { fill: "#8C4FFF", grad: "#945DF2" },
  general:    { fill: "#232F3E", grad: "#414B5C" },
};
const SERVICE_CATEGORY = {
  lambda: "compute", ec2: "compute", fargate: "compute",
  cloudfront: "networking", elb: "networking", apigateway: "networking", natgateway: "networking",
  s3: "storage",
  dynamodb: "database", rds: "database", aurora: "database",
  bedrock: "ml", sagemaker: "ml",
  opensearch: "analytics", glue: "analytics", kinesis: "analytics",
  eventbridge: "appint", sqs: "appint", sns: "appint", stepfunctions: "appint",
  cloudwatch: "mgmt",
  kms: "security", cognito: "security", secretsmanager: "security",
};
const awsFill = (type) =>
  CATEGORY_COLOR[SERVICE_CATEGORY[String(type).toLowerCase()] || "general"] || CATEGORY_COLOR.general;
const ICON_W = 78, ICON_LABEL = 20;  // resource icons are square; reserve label room below

// Edge routing: pick which side of each box the edge leaves/enters, based on
// the boxes' relative positions. This is what stops the arrows tangling when
// the layout stacks things vertically. Single source of truth for both the
// SVG preview and the draw.io exit/entry hints.
const isIconLeaf = (n) => !n._container && !!STENCIL[String(n.type).toLowerCase()];
const visRect = (n) => ({ x: n.x, y: n.y, w: n.w, h: isIconLeaf(n) ? ICON_W : n.h });
function edgeAttach(s, t) {
  const a = visRect(s), b = visRect(t);
  const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
  const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
  if (Math.abs(dx) >= Math.abs(dy))
    return dx >= 0 ? { ex: 1, ey: 0.5, nx: 0, ny: 0.5 } : { ex: 0, ey: 0.5, nx: 1, ny: 0.5 };
  return dy >= 0 ? { ex: 0.5, ey: 1, nx: 0.5, ny: 0 } : { ex: 0.5, ey: 0, nx: 0.5, ny: 1 };
}
function orthPath(s, t) {
  const a = visRect(s), b = visRect(t), at = edgeAttach(s, t);
  const ex = a.x + at.ex * a.w, ey = a.y + at.ey * a.h;
  const nx = b.x + at.nx * b.w, ny = b.y + at.ny * b.h;
  if (at.ey === 0.5) { const m = (ex + nx) / 2; return { d: `M ${ex} ${ey} H ${m} V ${ny} H ${nx}`, lx: m, ly: (ey + ny) / 2 }; }
  const m = (ey + ny) / 2;
  return { d: `M ${ex} ${ey} V ${m} H ${nx} V ${ny}`, lx: (ex + nx) / 2, ly: m };
}

/* ------------------------------------------------------------------ *
 *  Mock "Bedrock" — returns Graph JSON. Replace with callEndpoint().
 * ------------------------------------------------------------------ */
const TEMPLATES = {
  voice: {
    title: "Caseworker Voice Training Simulator",
    nodes: [
      { id: "browser", label: "Trainee Browser", type: "client" },
      { id: "cf", label: "CloudFront", type: "edge" },
      { id: "ws", label: "WebSocket Proxy (EC2)", type: "compute" },
      { id: "eleven", label: "ElevenLabs Conversational AI", type: "external" },
      { id: "transcripts", label: "Transcript Store (S3)", type: "data" },
      { id: "evalfn", label: "Post-call Eval Lambda", type: "compute" },
      { id: "nova", label: "Bedrock Nova Pro", type: "ai" },
      { id: "scores", label: "Scorecards (DynamoDB)", type: "data" },
    ],
    edges: [
      { from: "browser", to: "cf" }, { from: "cf", to: "ws" },
      { from: "ws", to: "eleven", label: "voice stream" },
      { from: "ws", to: "transcripts" },
      { from: "transcripts", to: "evalfn" },
      { from: "evalfn", to: "nova", label: "evaluate" },
      { from: "nova", to: "scores" },
    ],
  },
  ml: {
    title: "QLoRA Fine-tuning Pipeline",
    nodes: [
      { id: "raw", label: "Raw Corpus (S3)", type: "data" },
      { id: "ebridge", label: "EventBridge Trigger", type: "event" },
      { id: "glue", label: "Glue ETL", type: "compute" },
      { id: "feat", label: "Feature Store", type: "data" },
      { id: "train", label: "SageMaker Training (Phi-3 QLoRA)", type: "ai" },
      { id: "ragas", label: "RAGAS Eval (Claude judge)", type: "ai" },
      { id: "registry", label: "Model Registry", type: "data" },
      { id: "endpoint", label: "SageMaker Endpoint", type: "ai" },
    ],
    edges: [
      { from: "ebridge", to: "glue" }, { from: "raw", to: "glue" },
      { from: "glue", to: "feat" }, { from: "feat", to: "train" },
      { from: "train", to: "ragas" }, { from: "ragas", to: "registry" },
      { from: "registry", to: "endpoint" },
    ],
  },
  rag: {
    title: "RAG Knowledge Service",
    nodes: [
      { id: "docs", label: "Source Docs (S3)", type: "data" },
      { id: "ingest", label: "Ingestion Lambda", type: "compute" },
      { id: "embed", label: "Titan Embeddings", type: "ai" },
      { id: "vector", label: "OpenSearch Vector", type: "data" },
      { id: "user", label: "Caseworker Query", type: "client" },
      { id: "api", label: "API Gateway", type: "edge" },
      { id: "retrieve", label: "Retriever Lambda", type: "compute" },
      { id: "claude", label: "Bedrock Claude", type: "ai" },
    ],
    edges: [
      { from: "docs", to: "ingest" }, { from: "ingest", to: "embed" },
      { from: "embed", to: "vector" }, { from: "user", to: "api" },
      { from: "api", to: "retrieve" }, { from: "retrieve", to: "vector", label: "kNN" },
      { from: "retrieve", to: "claude" },
    ],
  },
  default: {
    title: "Caseworker Support AI Service",
    nodes: [
      { id: "ui", label: "Caseworker UI", type: "client" },
      { id: "cf", label: "CloudFront", type: "edge" },
      { id: "api", label: "API Gateway", type: "edge" },
      { id: "orch", label: "Orchestrator Lambda", type: "compute" },
      { id: "agent", label: "Bedrock Agent (Nova Pro)", type: "ai" },
      { id: "rules", label: "Rules Engine (JSON)", type: "compute" },
      { id: "kb", label: "Knowledge Base", type: "data" },
      { id: "sessions", label: "Sessions (DynamoDB)", type: "data" },
    ],
    edges: [
      { from: "ui", to: "cf" }, { from: "cf", to: "api" }, { from: "api", to: "orch" },
      { from: "orch", to: "agent" }, { from: "agent", to: "rules", label: "verdict" },
      { from: "agent", to: "kb", label: "retrieve" }, { from: "orch", to: "sessions" },
    ],
  },
  network: {
    title: "Networked CMS Service (VPC)",
    nodes: [
      { id: "cf", label: "CloudFront", type: "cloudfront" },
      { id: "vpc", label: "VPC 10.0.0.0/16", type: "vpc" },
      { id: "pub", label: "Public subnet", type: "public_subnet", parent: "vpc" },
      { id: "prv", label: "Private subnet", type: "private_subnet", parent: "vpc" },
      { id: "alb", label: "Load balancer", type: "elb", parent: "pub" },
      { id: "nat", label: "NAT gateway", type: "natgateway", parent: "pub" },
      { id: "lam", label: "Orchestrator", type: "lambda", parent: "prv" },
      { id: "rds", label: "Sessions DB", type: "rds", parent: "prv" },
    ],
    edges: [
      { from: "cf", to: "alb" },
      { from: "alb", to: "lam" },
      { from: "lam", to: "rds" },
      { from: "lam", to: "nat", label: "egress" },
    ],
  },
};

function mockBedrock(prompt) {
  const p = (prompt || "").toLowerCase();
  let key = "default";
  if (/vpc|subnet|network|availability zone|\bvpc\b|private subnet|public subnet/.test(p)) key = "network";
  else if (/voice|call|simulat|eleven|speech/.test(p)) key = "voice";
  else if (/fine.?tun|qlora|sagemaker|train|lora|phi-3|model registry/.test(p)) key = "ml";
  else if (/rag|retriev|knowledge|vector|embedding|opensearch/.test(p)) key = "rag";
  const base = TEMPLATES[key];
  // clone so edits never mutate the template
  return new Promise((res) =>
    setTimeout(() => res(JSON.parse(JSON.stringify(base))), 420)
  );
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* Mock refiner: takes the CURRENT graph + an instruction and returns an
   edited graph. Real backends do this with the model; here we parse intent
   so the round-trip is demonstrable. Returns { graph, summary }. */
function mockRefine(graph, instruction) {
  const g = JSON.parse(JSON.stringify(graph));
  const low = instruction.trim().toLowerCase();
  const clean = (s) => s.replace(/[.?!]+$/, "").trim();
  const find = (q) => {
    q = clean(q);
    return g.nodes.find((n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase() === q)
        || g.nodes.find((n) => q.includes(n.label.toLowerCase()));
  };
  const preds = (id) => g.edges.filter((e) => e.to === id).map((e) => e.from);
  const succs = (id) => g.edges.filter((e) => e.from === id).map((e) => e.to);
  const uid = (base) => { let id = base, i = 1; while (g.nodes.some((n) => n.id === id)) id = `${base}_${++i}`; return id; };
  const dropNode = (id) => { g.nodes = g.nodes.filter((n) => n.id !== id); g.edges = g.edges.filter((e) => e.from !== id && e.to !== id); };

  let m;
  // REMOVE — and bridge the gap so flow stays intact
  if ((m = low.match(/^(?:remove|delete|drop)\s+(?:the\s+)?(.+)/))) {
    const t = find(m[1]);
    if (!t) return { graph: g, summary: `No match for “${clean(m[1])}”.` };
    const ps = preds(t.id), ss = succs(t.id);
    dropNode(t.id);
    ps.forEach((p) => ss.forEach((s) => { if (!g.edges.some((e) => e.from === p && e.to === s)) g.edges.push({ from: p, to: s }); }));
    return { graph: g, summary: `Removed “${t.label}”, bridged its connections.` };
  }
  // SPLIT — fan predecessors/successors across the new services
  if (low.startsWith("split")) {
    m = low.match(/^split\s+(?:the\s+)?(.+?)\s+into\s+(.+)/) || low.match(/^split\s+(?:the\s+)?(.+)/);
    const t = m && find(m[1]);
    if (!t) return { graph: g, summary: `No match to split.` };
    let names = m[2] ? clean(m[2]).replace(/\band\b/g, ",").split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (names.length < 2) names = [`${t.label} A`, `${t.label} B`];
    const ps = preds(t.id), ss = succs(t.id);
    dropNode(t.id);
    const made = names.slice(0, 3).map((nm) => {
      const id = uid(`${t.id}_s`);
      g.nodes.push({ id, label: cap(nm), type: t.type });
      ps.forEach((p) => g.edges.push({ from: p, to: id }));
      ss.forEach((s) => g.edges.push({ from: id, to: s }));
      return id;
    });
    return { graph: g, summary: `Split “${t.label}” into ${made.length}.` };
  }
  // RENAME
  if ((m = low.match(/^rename\s+(?:the\s+)?(.+?)\s+to\s+(.+)/))) {
    const t = find(m[1]);
    if (!t) return { graph: g, summary: `No match for “${clean(m[1])}”.` };
    t.label = cap(clean(m[2]));
    return { graph: g, summary: `Renamed to “${t.label}”.` };
  }
  // CONNECT
  if ((m = low.match(/^(?:connect|link)\s+(?:the\s+)?(.+?)\s+(?:to|->|with|and)\s+(.+)/))) {
    const a = find(m[1]), b = find(m[2]);
    if (!a || !b) return { graph: g, summary: `Couldn't find both endpoints.` };
    if (!g.edges.some((e) => e.from === a.id && e.to === b.id)) g.edges.push({ from: a.id, to: b.id });
    return { graph: g, summary: `Linked “${a.label}” → “${b.label}”.` };
  }
  // ADD — optionally positioned after/before an anchor
  if (low.startsWith("add")) {
    const rest = low.replace(/^add\s+(?:an?\s+|the\s+)?/, "");
    const rm = rest.match(/^(.+?)\s+(after|before)\s+(.+)$/);
    const name = clean(rm ? rm[1] : rest);
    const id = uid("n");
    g.nodes.push({ id, label: cap(name), type: categoryOf(rest) });
    if (rm) {
      const anchor = find(rm[3]);
      if (anchor) {
        if (rm[2] === "after") {
          const ss = succs(anchor.id);
          g.edges = g.edges.filter((e) => e.from !== anchor.id);
          g.edges.push({ from: anchor.id, to: id });
          ss.forEach((s) => g.edges.push({ from: id, to: s }));
        } else {
          const ps = preds(anchor.id);
          g.edges = g.edges.filter((e) => e.to !== anchor.id);
          ps.forEach((p) => g.edges.push({ from: p, to: id }));
          g.edges.push({ from: id, to: anchor.id });
        }
        return { graph: g, summary: `Added “${cap(name)}” ${rm[2]} “${anchor.label}”.` };
      }
    }
    const sink = g.nodes.find((n) => n.id !== id && succs(n.id).length === 0);
    if (sink) g.edges.push({ from: sink.id, to: id });
    return { graph: g, summary: `Added “${cap(name)}”.` };
  }
  return { graph: g, summary: "Couldn't map that — try add / remove / split / rename / connect." };
}

/* ------------------------------------------------------------------ *
 *  Real endpoint. CONTRACT:
 *  POST { prompt: string }  ->  { title?, nodes[], edges[] }
 *  node: { id, label, type }   edge: { from, to, label? }
 * ------------------------------------------------------------------ */
async function callEndpoint(url, prompt) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!r.ok) throw new Error(`Endpoint returned ${r.status}`);
  const data = await r.json();
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges))
    throw new Error("Response must contain nodes[] and edges[]");
  return data;
}

async function callEndpointRefine(url, instruction, currentGraph) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction, currentGraph }),
  });
  if (!r.ok) throw new Error(`Endpoint returned ${r.status}`);
  const data = await r.json();
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges))
    throw new Error("Response must contain nodes[] and edges[]");
  return data;
}

/* ------------------------------------------------------------------ *
 *  Deterministic layout (the "Layout" stage). Now containment-aware:
 *  leaves are sized fixed, containers are sized bottom-up to bound
 *  their children, and children are positioned relative to the parent.
 *  LLM decides what's in the graph + the parent pointers; this decides
 *  every coordinate and every container size.
 * ------------------------------------------------------------------ */
const NW = 150, NH = 66, GX = 64, GY = 26, PAD = 22, HEAD = 30, MARGIN = 24;

// Layered placement of variably-sized items. Returns relative top-left
// positions (origin 0,0) plus the bounding width/height.
function layeredPlace(items, edges) {
  if (items.length === 0) return { pos: {}, width: 0, height: 0 };
  const by = Object.fromEntries(items.map((it) => [it.id, it]));
  const adj = {}, indeg = {};
  items.forEach((it) => { adj[it.id] = []; indeg[it.id] = 0; });
  edges.forEach((e) => { if (by[e.from] && by[e.to]) { adj[e.from].push(e.to); indeg[e.to]++; } });

  const layer = {}, indc = { ...indeg }, order = [];
  items.forEach((it) => { if (indeg[it.id] === 0) { layer[it.id] = 0; order.push(it.id); } });
  for (let i = 0; i < order.length; i++) {
    const u = order[i];
    adj[u].forEach((v) => { layer[v] = Math.max(layer[v] ?? 0, (layer[u] ?? 0) + 1); if (--indc[v] === 0) order.push(v); });
  }
  items.forEach((it) => { if (layer[it.id] == null) layer[it.id] = 0; });

  const maxL = Math.max(...items.map((it) => layer[it.id]));
  const layers = Array.from({ length: maxL + 1 }, () => []);
  items.forEach((it) => layers[layer[it.id]].push(it.id));

  const pidx = {};
  layers.forEach((L) => L.forEach((id, i) => (pidx[id] = i)));
  for (let l = 1; l < layers.length; l++) {
    const prev = layers[l - 1];
    layers[l].sort((a, b) => bary(a) - bary(b));
    layers[l].forEach((id, i) => (pidx[id] = i));
    function bary(id) {
      const ps = edges.filter((e) => e.to === id && prev.includes(e.from)).map((e) => prev.indexOf(e.from));
      return ps.length ? ps.reduce((x, y) => x + y, 0) / ps.length : pidx[id];
    }
  }

  const colW = layers.map((L) => Math.max(0, ...L.map((id) => by[id].w)));
  const colX = []; let cx = 0;
  for (let l = 0; l < layers.length; l++) { colX[l] = cx; cx += colW[l] + GX; }
  const width = Math.max(0, cx - GX);

  const layerH = layers.map((L) => L.reduce((h, id, i) => h + by[id].h + (i ? GY : 0), 0));
  const height = Math.max(0, ...layerH);

  const pos = {};
  layers.forEach((L, l) => {
    let y = (height - layerH[l]) / 2;
    L.forEach((id) => { pos[id] = { x: colX[l] + (colW[l] - by[id].w) / 2, y }; y += by[id].h + GY; });
  });
  return { pos, width, height };
}

function layout(graph) {
  const nodes = graph.nodes.map((n) => ({ ...n }));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  nodes.forEach((n) => { if (!(n.parent && byId[n.parent])) n.parent = null; });
  const edges = graph.edges.filter((e) => byId[e.from] && byId[e.to]);

  const kids = { __root: [] };
  nodes.forEach((n) => { const p = n.parent || "__root"; (kids[p] = kids[p] || []).push(n); });

  // walk up from nodeId until we find the ancestor whose parent === key
  const ancestorAt = (nodeId, key) => {
    let cur = nodeId;
    while (cur) {
      const par = byId[cur].parent || "__root";
      if (par === key) return cur;
      cur = par === "__root" ? null : par;
    }
    return null;
  };
  // edges between the direct children of `key` (lifting deeper endpoints)
  const liftedEdges = (key) => {
    const out = [], seen = new Set();
    edges.forEach((e) => {
      const a = ancestorAt(e.from, key), b = ancestorAt(e.to, key);
      if (a && b && a !== b) { const k = `${a}->${b}`; if (!seen.has(k)) { seen.add(k); out.push({ from: a, to: b }); } }
    });
    return out;
  };

  // recursively size + position. returns { w, h } of the container/leaf.
  const place = (key) => {
    const children = kids[key] || [];
    const items = children.map((c) => {
      if ((kids[c.id] || []).length || isContainer(c.type)) { const s = place(c.id); return { id: c.id, w: s.w, h: s.h }; }
      if (STENCIL[String(c.type).toLowerCase()]) { c.w = ICON_W; c.h = ICON_W + ICON_LABEL; }
      else { c.w = NW; c.h = NH; }
      return { id: c.id, w: c.w, h: c.h };
    });
    const { pos, width, height } = layeredPlace(items, liftedEdges(key));
    const root = key === "__root";
    const offX = root ? 0 : PAD, offY = root ? 0 : HEAD;
    children.forEach((c) => { c.rx = pos[c.id].x + offX; c.ry = pos[c.id].y + offY; });
    if (root) return { w: width, h: height };
    const n = byId[key];
    n.w = Math.max(150, width + PAD * 2);
    n.h = height + HEAD + PAD;
    return { w: n.w, h: n.h };
  };
  const rootSize = place("__root");

  // relative -> absolute (for the SVG preview; mxGraph keeps it relative)
  const setAbs = (key, ox, oy) => (kids[key] || []).forEach((c) => {
    c.x = ox + c.rx; c.y = oy + c.ry; setAbs(c.id, c.x, c.y);
  });
  setAbs("__root", MARGIN, MARGIN);

  const depth = (n) => { let d = 0, cur = n; while (cur.parent) { d++; cur = byId[cur.parent]; } return d; };
  nodes.forEach((n) => {
    n._depth = depth(n);
    n._container = isContainer(n.type) || (kids[n.id] || []).length > 0;
  });

  return {
    nodes, edges, byId,
    width: rootSize.w + MARGIN * 2,
    height: rootSize.h + MARGIN * 2,
  };
}

/* ------------------------------------------------------------------ *
 *  mxGraph serialiser (the "mxGraph" stage).
 * ------------------------------------------------------------------ */
const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toMxGraph(laid) {
  let cells = `<mxCell id="0"/><mxCell id="1" parent="0"/>`;
  // parents before children so ids resolve
  const ordered = [...laid.nodes].sort((a, b) => (a._depth || 0) - (b._depth || 0));
  ordered.forEach((n) => {
    const parent = n.parent || "1";
    // geometry is RELATIVE to the parent in mxGraph (that's how nesting renders)
    const x = Math.round(n.rx ?? n.x ?? 0), y = Math.round(n.ry ?? n.y ?? 0);
    let style;
    if (n._container) {
      const g = GROUP_STENCIL[String(n.type).toLowerCase()] || "mxgraph.aws4.group";
      const col = groupOf(n.type).stroke;
      style = `points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;collapsible=0;pointerEvents=0;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=${col};strokeColor=${col};dashed=1;shape=mxgraph.aws4.group;grIcon=${g};`;
    } else {
      const res = STENCIL[String(n.type).toLowerCase()];
      if (res) {
        const col = awsFill(n.type);
        style = `sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;gradientColor=${col.grad};gradientDirection=north;fillColor=${col.fill};strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=${res};`;
      } else {
        const c = CAT[categoryOf(n.type)] || CAT.default;
        style = `rounded=1;whiteSpace=wrap;html=1;fillColor=${c.fill};strokeColor=${c.stroke};fontColor=#15213B;fontSize=12;arcSize=12;`;
      }
    }
    // resource icons emit a square 78x78 geometry; everything else uses its box
    const isIcon = !n._container && !!STENCIL[String(n.type).toLowerCase()];
    const w = isIcon ? ICON_W : Math.round(n.w);
    const h = isIcon ? ICON_W : Math.round(n.h);
    cells += `<mxCell id="${esc(n.id)}" value="${esc(n.label)}" style="${style}" vertex="1" parent="${esc(parent)}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
  });
  const byId = laid.byId || Object.fromEntries(laid.nodes.map((n) => [n.id, n]));
  laid.edges.forEach((e, i) => {
    const a = byId[e.from], b = byId[e.to];
    const at = a && b ? edgeAttach(a, b) : null;
    const pts = at
      ? `exitX=${at.ex};exitY=${at.ey};exitDx=0;exitDy=0;entryX=${at.nx};entryY=${at.ny};entryDx=0;entryDy=0;`
      : "";
    const style = `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#3A465F;endArrow=block;endFill=1;jettySize=auto;${pts}fontColor=#737B8E;fontSize=10;`;
    cells += `<mxCell id="edge_${i}" value="${esc(e.label || "")}" style="${style}" edge="1" parent="1" source="${esc(e.from)}" target="${esc(e.to)}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  });
  return `<mxGraphModel dx="900" dy="640" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="800" math="0" shadow="0"><root>${cells}</root></mxGraphModel>`;
}
const wrapMxFile = (xml) =>
  `<mxfile host="architect-studio"><diagram name="Architecture" id="arch-1">${xml}</diagram></mxfile>`;

/* mxGraph XML -> Graph JSON. Lets refine run against a diagram that was
   hand-edited in draw.io: category is recovered from the fill colour. */
const FILL_TO_CAT = Object.fromEntries(
  Object.entries(CAT).map(([k, c]) => [c.fill.toLowerCase(), k])
);
function fromMxGraph(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const cells = Array.from(doc.getElementsByTagName("mxCell"));
  const nodes = [], edges = [];
  cells.forEach((c) => {
    const style = c.getAttribute("style") || "";
    if (c.getAttribute("vertex") === "1") {
      let type;
      const gm = style.match(/grIcon=([^;]+)/i);
      const rm = style.match(/resIcon=([^;]+)/i);
      const fm = style.match(/fillColor=([^;]+)/i);
      if (gm) type = GROUP_REV[gm[1]] || "vpc";
      else if (rm) type = STENCIL_REV[rm[1]] || "compute";
      else type = fm ? (FILL_TO_CAT[fm[1].toLowerCase()] || "default") : "default";
      const par = c.getAttribute("parent");
      const parent = par && par !== "1" && par !== "0" ? par : null;
      const label = (c.getAttribute("value") || c.getAttribute("id") || "")
        .replace(/<[^>]+>/g, " ").trim();
      const node = { id: c.getAttribute("id"), label, type };
      if (parent) node.parent = parent;
      nodes.push(node);
    } else if (c.getAttribute("edge") === "1") {
      const from = c.getAttribute("source"), to = c.getAttribute("target");
      if (from && to) {
        const label = (c.getAttribute("value") || "").replace(/<[^>]+>/g, " ").trim();
        edges.push(label ? { from, to, label } : { from, to });
      }
    }
  });
  return { title: "Edited diagram", nodes, edges };
}

/* ------------------------------------------------------------------ *
 *  draw.io embed. Drop in a self-hosted URL via Settings.
 * ------------------------------------------------------------------ */
function DrawioFrame({ url, xml, onChange }) {
  const ref = useRef(null);
  const xmlRef = useRef(xml);
  xmlRef.current = xml;

  useEffect(() => {
    function onMsg(evt) {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      const w = ref.current && ref.current.contentWindow;
      if (!w) return;
      if (msg.event === "init") {
        w.postMessage(JSON.stringify({ action: "load", autosave: 1, xml: xmlRef.current }), "*");
      } else if (msg.event === "autosave" || msg.event === "save") {
        if (msg.xml) onChange && onChange(msg.xml);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onChange]);

  // push new diagrams into an already-open editor
  useEffect(() => {
    const w = ref.current && ref.current.contentWindow;
    if (w) w.postMessage(JSON.stringify({ action: "load", autosave: 1, xml }), "*");
  }, [xml]);

  const src = `${url}${url.includes("?") ? "&" : "?"}embed=1&proto=json&spin=1&libraries=1&noSaveBtn=1&saveAndExit=0`;
  return (
    <iframe
      ref={ref}
      title="draw.io editor"
      src={src}
      style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
    />
  );
}

// Read-only draw.io render (lightbox) — used inside the document preview.
function DrawioView({ url, xml }) {
  const ref = useRef(null);
  const xmlRef = useRef(xml);
  xmlRef.current = xml;

  useEffect(() => {
    function onMsg(evt) {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      const w = ref.current && ref.current.contentWindow;
      if (w && msg.event === "init") {
        w.postMessage(JSON.stringify({ action: "load", xml: xmlRef.current }), "*");
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    const w = ref.current && ref.current.contentWindow;
    if (w) w.postMessage(JSON.stringify({ action: "load", xml }), "*");
  }, [xml]);

  const src = `${url}${url.includes("?") ? "&" : "?"}embed=1&proto=json&lightbox=1&chrome=0&nav=0&toolbar=0&edit=0&layers=0&libraries=0`;
  return (
    <iframe
      ref={ref}
      title="draw.io diagram"
      src={src}
      style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
    />
  );
}

/* ------------------------------------------------------------------ *
 *  SVG preview — always-on render of the laid-out graph.
 * ------------------------------------------------------------------ */
function SvgPreview({ laid }) {
  if (!laid) return null;
  const byId = laid.byId || Object.fromEntries(laid.nodes.map((n) => [n.id, n]));
  const containers = laid.nodes.filter((n) => n._container).sort((a, b) => a._depth - b._depth);
  const leaves = laid.nodes.filter((n) => !n._container);
  return (
    <svg
      viewBox={`0 0 ${laid.width} ${laid.height}`}
      style={{ width: "100%", height: "100%" }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3"
          orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,3 L0,6 Z" fill={T.inkSoft} />
        </marker>
      </defs>

      {/* containers, shallow first so deeper nesting paints on top */}
      {containers.map((n) => {
        const g = groupOf(n.type);
        return (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="10"
              fill={g.stroke} fillOpacity="0.05" stroke={g.stroke} strokeWidth="1.2"
              strokeDasharray="6 4" />
            <text x={n.x + 12} y={n.y + 19} fontSize="11.5" fill={g.stroke}
              style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 600 }}>
              {n.label}
            </text>
          </g>
        );
      })}

      {/* edges */}
      {laid.edges.map((e, i) => {
        const s = byId[e.from], t = byId[e.to];
        if (!s || !t || s.x == null || t.x == null) return null;
        const p = orthPath(s, t);
        return (
          <g key={`e${i}`}>
            <path d={p.d} fill="none" stroke={T.inkSoft} strokeWidth="1.5"
              markerEnd="url(#arrow)" opacity="0.85" />
            {e.label && (
              <text x={p.lx} y={p.ly - 5} fontSize="10" fill={T.textDim}
                textAnchor="middle" style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
                {e.label}
              </text>
            )}
          </g>
        );
      })}

      {/* leaf services */}
      {leaves.map((n) => {
        const res = STENCIL[String(n.type).toLowerCase()];
        if (res) {
          const col = awsFill(n.type);
          return (
            <g key={n.id}>
              <rect x={n.x} y={n.y} width={ICON_W} height={ICON_W} rx="8"
                fill={col.fill} stroke="#ffffff" strokeWidth="1.5" />
              <rect x={n.x + 14} y={n.y + 14} width={ICON_W - 28} height={ICON_W - 28} rx="4"
                fill="none" stroke="#ffffff" strokeWidth="1.4" opacity="0.85" />
              <text x={n.x + ICON_W / 2} y={n.y + ICON_W + 13} fontSize="11.5" fill={T.ink}
                textAnchor="middle"
                style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontWeight: 500 }}>
                {n.label}
              </text>
            </g>
          );
        }
        const c = CAT[categoryOf(n.type)] || CAT.default;
        return (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="9"
              fill={c.fill} stroke={c.stroke} strokeWidth="1.5" />
            <text x={n.x + n.w / 2} y={n.y + n.h / 2} fontSize="12.5"
              fill={T.ink} textAnchor="middle" dominantBaseline="middle"
              style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontWeight: 500 }}>
              {wrapText(n.label, 20).map((line, i, a) => (
                <tspan key={i} x={n.x + n.w / 2}
                  dy={i === 0 ? -(a.length - 1) * 7 : 14}>{line}</tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
function wrapText(text, max) {
  const words = String(text).split(" ");
  const lines = []; let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) { if (cur) lines.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/* ------------------------------------------------------------------ *
 *  Small UI atoms
 * ------------------------------------------------------------------ */
const mono = { fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" };
const sans = { fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" };

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        try { navigator.clipboard.writeText(text); } catch {}
        setDone(true); setTimeout(() => setDone(false), 1200);
      }}
      style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 12, color: T.inkSoft, background: T.panel,
        border: `1px solid ${T.line}`, borderRadius: 7, padding: "5px 10px", cursor: "pointer" }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

const STAGES = [
  { key: "prompt",  label: "Prompt",     icon: MessageSquare },
  { key: "graph",   label: "Graph JSON", icon: Braces },
  { key: "layout",  label: "Layout",     icon: LayoutGrid },
  { key: "mxgraph", label: "mxGraph",    icon: FileCode2 },
];
const stageRank = (k) => STAGES.findIndex((s) => s.key === k);

/* ------------------------------------------------------------------ *
 *  App
 * ------------------------------------------------------------------ */
export default function ArchitectStudio() {
  const [prompt, setPrompt] = useState(
    "A networked caseworker service inside a VPC: CloudFront fronts a load balancer in " +
    "the public subnet, which calls an orchestrator Lambda in the private subnet; the " +
    "Lambda reads a sessions database (RDS) and egresses through a NAT gateway."
  );
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(null);
  const [graph, setGraph] = useState(null);
  const [laid, setLaid] = useState(null);
  const [xml, setXml] = useState("");
  const [edited, setEdited] = useState(false);
  const [view, setView] = useState("diagram"); // diagram | json | xml | document
  const [doc, setDoc] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [docError, setDocError] = useState(null);
  const [error, setError] = useState(null);

  const [refinePrompt, setRefinePrompt] = useState("");
  const [refining, setRefining] = useState(false);
  const [history, setHistory] = useState([]);

  const [showCfg, setShowCfg] = useState(false);
  const [mode, setMode] = useState("mock"); // mock | live
  const [endpoint, setEndpoint] = useState("/diagram/api/extract");
  const [drawioUrl, setDrawioUrl] = useState("https://embed.diagrams.net/");
  const [useDrawio, setUseDrawio] = useState(false);

  const run = useCallback(async () => {
    setBusy(true); setError(null); setEdited(false); setStage("prompt"); setHistory([]); setDoc("");
    try {
      const g = mode === "live" ? await callEndpoint(endpoint, prompt) : await mockBedrock(prompt);
      setGraph(g); setStage("graph"); await sleep(220);
      const l = layout(g); setLaid(l); setStage("layout"); await sleep(220);
      const x = toMxGraph(l); setXml(x); setStage("mxgraph");
      setView("diagram");
    } catch (e) {
      setError(e.message || "Generation failed");
      setStage(null);
    } finally {
      setBusy(false);
    }
  }, [prompt, mode, endpoint]);

  const refine = useCallback(async () => {
    const instruction = refinePrompt.trim();
    if (!instruction || !laid || busy || refining) return;
    setRefining(true); setError(null); setStage("graph");
    try {
      // source of truth: if the user hand-edited in draw.io, parse that back
      const base = edited ? fromMxGraph(xml) : graph;
      let next, summary;
      if (mode === "live") {
        next = await callEndpointRefine(endpoint, instruction, base);
        summary = "Applied via endpoint.";
      } else {
        const r = mockRefine(base, instruction);
        next = r.graph; summary = r.summary;
        await sleep(320);
      }
      setGraph(next); setStage("layout"); await sleep(180);
      const l = layout(next); setLaid(l);
      setXml(toMxGraph(l)); setStage("mxgraph"); setEdited(false);
      setHistory((h) => [...h, { instruction, summary }]);
      setRefinePrompt(""); setView("diagram");
    } catch (e) {
      setError(e.message || "Refine failed"); setStage("mxgraph");
    } finally {
      setRefining(false);
    }
  }, [refinePrompt, laid, busy, refining, edited, xml, graph, mode, endpoint]);

  const genDoc = useCallback(async () => {
    if (!laid || !graph || docBusy) return;
    setDocBusy(true); setDocError(null);
    try {
      let md;
      if (mode === "live") {
        const url = endpoint.replace(/extract$/, "document");
        const r = await fetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, graph }),
        });
        if (!r.ok) throw new Error(`Endpoint returned ${r.status}`);
        const d = await r.json();
        md = d.markdown || "";
        if (!md) throw new Error("No document returned");
      } else {
        md = buildDocMarkdown(prompt, graph);
        await sleep(220);
      }
      setDoc(md);
    } catch (e) {
      setDocError(e.message || "Document generation failed");
    } finally {
      setDocBusy(false);
    }
  }, [laid, graph, prompt, mode, endpoint, docBusy]);

  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); }
  };

  const done = stageRank(stage);

  return (
    <div style={{ ...sans, display: "flex", flexDirection: "column", height: "100vh",
      background: T.paper, color: T.ink }}>
      {/* ---- Top bar : title + pipeline rail (the signature) ---- */}
      <header style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
        padding: "12px 18px", background: T.rail, color: T.inv,
        borderBottom: `1px solid ${T.railLine}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Workflow size={18} color={T.amber} />
          <span style={{ fontWeight: 650, letterSpacing: "-0.01em", fontSize: 15 }}>
            Architect Studio
          </span>
          <span style={{ ...mono, fontSize: 11, color: T.invDim, marginLeft: 2 }}>
            prompt → diagram
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 280, display: "flex", alignItems: "center",
          justifyContent: "center", gap: 0 }}>
          {STAGES.map((s, i) => {
            const active = stage === s.key;
            const complete = done > i && !busy ? true : done >= i && stage != null;
            const reached = done >= i && stage != null;
            const Icon = s.icon;
            return (
              <React.Fragment key={s.key}>
                <div style={{ display: "flex", alignItems: "center", gap: 7,
                  opacity: reached ? 1 : 0.4, transition: "opacity .25s" }}>
                  <span style={{ display: "grid", placeItems: "center", width: 26, height: 26,
                    borderRadius: 7, background: active ? T.amber : reached ? T.railSoft : "transparent",
                    border: `1px solid ${active ? T.amber : T.railLine}`,
                    color: active ? "#1a1206" : T.inv, transition: "all .25s" }}>
                    <Icon size={14} />
                  </span>
                  <span style={{ ...mono, fontSize: 11.5,
                    color: active ? T.amber : reached ? T.inv : T.invDim }}>
                    {s.key === "prompt" && refining ? "Refine" : s.label}</span>
                </div>
                {i < STAGES.length - 1 && (
                  <div style={{ width: 26, height: 1.5, margin: "0 6px",
                    background: done > i && stage != null ? T.amber : T.railLine,
                    transition: "background .25s" }} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        <button onClick={() => setShowCfg(true)}
          style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13,
            color: T.inv, background: T.railSoft, border: `1px solid ${T.railLine}`,
            borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>
          <Settings size={14} /> Endpoint
          <span style={{ ...mono, fontSize: 10, color: mode === "live" ? "#7ee0a0" : T.invDim }}>
            {mode === "live" ? "LIVE" : "MOCK"}
          </span>
        </button>
      </header>

      {/* ---- Body : console (left) + drawing board (right) ---- */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, flexDirection: "row" }}
        className="as-body">
        {/* LEFT — input console */}
        <section style={{ width: 380, minWidth: 300, maxWidth: "45%", display: "flex",
          flexDirection: "column", background: T.rail, color: T.inv, overflowY: "auto",
          borderRight: `1px solid ${T.railLine}` }} className="as-console">
          <div style={{ padding: "16px 18px 0" }}>
            <label style={{ ...mono, fontSize: 11, color: T.invDim, textTransform: "uppercase",
              letterSpacing: "0.08em" }}>Solution design</label>
          </div>
          <div style={{ padding: "8px 18px 0" }}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onKey}
              spellCheck={false}
              placeholder="Describe the system in prose. Mention services, data stores, and how requests flow…"
              style={{ ...sans, width: "100%", height: 150, boxSizing: "border-box",
                resize: "vertical", lineHeight: 1.55, fontSize: 14, color: T.inv,
                background: T.railSoft, border: `1px solid ${T.railLine}`,
                borderRadius: 10, padding: 14, outline: "none" }}
            />
          </div>

          <div style={{ padding: "12px 18px 16px" }}>
            {error && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 12,
                fontSize: 12.5, color: "#ffd2cc", background: "#3a1d1d",
                border: "1px solid #5a2a2a", borderRadius: 9, padding: "9px 11px" }}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            )}
            <button
              onClick={run}
              disabled={busy || refining}
              style={{ ...sans, width: "100%", display: "inline-flex", alignItems: "center",
                justifyContent: "center", gap: 9, fontSize: 14.5, fontWeight: 600,
                color: "#1a1206", background: busy ? T.amberSoft : T.amber,
                border: "none", borderRadius: 10, padding: "12px 14px",
                cursor: busy ? "default" : "pointer", transition: "background .2s" }}>
              {busy ? <Cpu size={16} className="as-spin" /> : <Play size={16} />}
              {busy ? "Generating…" : "Generate architecture"}
            </button>
            <div style={{ ...mono, fontSize: 10.5, color: T.invDim, textAlign: "center",
              marginTop: 9 }}>⌘↵ to run · mock picks a template from keywords</div>
          </div>

          {laid && (
            <div style={{ padding: "16px 18px 20px", borderTop: `1px solid ${T.railLine}` }}>
              <label style={{ ...mono, fontSize: 11, color: T.invDim, textTransform: "uppercase",
                letterSpacing: "0.08em" }}>Refine</label>
              <div style={{ ...sans, fontSize: 12, color: T.invDim, margin: "7px 0 10px",
                lineHeight: 1.5 }}>
                Change the current diagram in place — it's sent back as context, not regenerated.
              </div>
              <textarea
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); refine(); } }}
                spellCheck={false}
                placeholder="e.g. split the orchestrator Lambda into two · add a DLQ after the eval Lambda · remove the rules engine · rename the knowledge base to Procedures KB"
                style={{ ...sans, width: "100%", height: 72, boxSizing: "border-box",
                  resize: "vertical", lineHeight: 1.5, fontSize: 13.5, color: T.inv,
                  background: T.railSoft, border: `1px solid ${T.railLine}`,
                  borderRadius: 10, padding: 12, outline: "none" }}
              />
              <button
                onClick={refine}
                disabled={refining || busy || !refinePrompt.trim()}
                style={{ ...sans, width: "100%", display: "inline-flex", alignItems: "center",
                  justifyContent: "center", gap: 8, fontSize: 13.5, fontWeight: 600, marginTop: 10,
                  color: T.inv, background: refinePrompt.trim() ? T.railSoft : "transparent",
                  border: `1px solid ${refinePrompt.trim() ? "#3a4a6b" : T.railLine}`,
                  borderRadius: 10, padding: "10px 14px",
                  cursor: refining || !refinePrompt.trim() ? "default" : "pointer",
                  opacity: refinePrompt.trim() ? 1 : 0.55, transition: "all .2s" }}>
                {refining ? <Cpu size={15} className="as-spin" /> : <Wand2 size={15} />}
                {refining ? "Applying…" : "Apply change"}
              </button>

              {history.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ ...mono, fontSize: 10.5, color: T.invDim, textTransform: "uppercase",
                    letterSpacing: "0.07em", marginBottom: 9 }}>Change history</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {history.map((h, i) => (
                      <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                        <span style={{ ...mono, fontSize: 10.5, color: "#1a1206", background: T.amber,
                          borderRadius: 5, minWidth: 18, height: 18, display: "grid",
                          placeItems: "center", marginTop: 1, flexShrink: 0 }}>{i + 1}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ ...sans, fontSize: 12.5, color: T.inv, lineHeight: 1.4 }}>{h.instruction}</div>
                          <div style={{ ...mono, fontSize: 10.5, color: T.invDim, marginTop: 2 }}>{h.summary}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* RIGHT — drawing board */}
        <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
          background: T.paper }}>
          {/* view tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 12px",
            borderBottom: `1px solid ${T.line}`, background: T.panel }}>
            {[
              { k: "diagram", label: "Diagram", icon: LayoutGrid },
              { k: "json", label: "Graph JSON", icon: Braces },
              { k: "xml", label: "mxGraph XML", icon: FileCode2 },
              { k: "document", label: "Document", icon: FileText },
            ].map((tab) => {
              const on = view === tab.k;
              const Icon = tab.icon;
              return (
                <button key={tab.k} onClick={() => setView(tab.k)}
                  style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 7,
                    fontSize: 13, fontWeight: on ? 600 : 500,
                    color: on ? T.ink : T.textDim, background: on ? T.amberSoft : "transparent",
                    border: `1px solid ${on ? "#eccf9f" : "transparent"}`,
                    borderRadius: 8, padding: "6px 11px", cursor: "pointer" }}>
                  <Icon size={14} /> {tab.label}
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            {view === "diagram" && laid && (
              <button onClick={() => setUseDrawio((v) => !v)}
                style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 7,
                  fontSize: 12.5, color: useDrawio ? T.ink : T.inkSoft,
                  background: useDrawio ? T.amberSoft : T.panel,
                  border: `1px solid ${useDrawio ? "#eccf9f" : T.line}`,
                  borderRadius: 8, padding: "6px 11px", cursor: "pointer" }}>
                <ExternalLink size={13} />
                {useDrawio ? "Editing in draw.io" : "Edit in draw.io"}
              </button>
            )}
            {view === "document" && doc && (
              <button onClick={() => downloadText("architecture.md", doc, "text/markdown")}
                style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 7,
                  fontSize: 12.5, color: T.inkSoft, background: T.panel,
                  border: `1px solid ${T.line}`, borderRadius: 8, padding: "6px 11px",
                  cursor: "pointer" }}>
                <Download size={13} /> .md
              </button>
            )}
            {laid && (
              <button onClick={() => downloadDrawio(xml)}
                style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 7,
                  fontSize: 12.5, color: T.inkSoft, background: T.panel,
                  border: `1px solid ${T.line}`, borderRadius: 8, padding: "6px 11px",
                  cursor: "pointer" }}>
                <Download size={13} /> .drawio
              </button>
            )}
          </div>

          {/* canvas */}
          <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
            {!laid && (
              <EmptyState />
            )}

            {laid && view === "diagram" && !useDrawio && (
              <div style={{ position: "absolute", inset: 0, overflow: "auto",
                backgroundColor: T.paper,
                backgroundImage:
                  `linear-gradient(${T.grid} 1px, transparent 1px), linear-gradient(90deg, ${T.grid} 1px, transparent 1px)`,
                backgroundSize: "22px 22px" }}>
                <div style={{ minWidth: laid.width + 48, minHeight: laid.height + 48,
                  padding: 24, boxSizing: "border-box" }}>
                  <div style={{ width: laid.width, height: laid.height, margin: "0 auto" }}>
                    <SvgPreview laid={laid} />
                  </div>
                </div>
                <Legend />
              </div>
            )}

            {laid && view === "diagram" && useDrawio && (
              <DrawioFrame url={drawioUrl} xml={wrapMxFile(xml)}
                onChange={(x) => { setXml(stripMxFile(x)); setEdited(true); }} />
            )}

            {laid && view === "json" && (
              <CodePane
                title={graph.title || "graph"}
                badge={mode === "live" ? "from endpoint" : "from mock"}
                text={JSON.stringify(graph, null, 2)} />
            )}

            {laid && view === "xml" && (
              <CodePane
                title="mxGraphModel"
                badge={edited ? "edited in draw.io" : "generated"}
                text={xml} />
            )}

            {laid && view === "document" && (
              <DocPane
                doc={doc} busy={docBusy} error={docError} mode={mode}
                onGenerate={genDoc} xml={xml} drawioUrl={drawioUrl} />
            )}
          </div>
        </section>
      </div>

      {showCfg && (
        <ConfigDrawer
          onClose={() => setShowCfg(false)}
          mode={mode} setMode={setMode}
          endpoint={endpoint} setEndpoint={setEndpoint}
          drawioUrl={drawioUrl} setDrawioUrl={setDrawioUrl}
        />
      )}

      <style>{`
        .as-spin { animation: as-rot 0.9s linear infinite; }
        @keyframes as-rot { to { transform: rotate(360deg); } }
        @media (max-width: 760px) {
          .as-body { flex-direction: column !important; }
          .as-console { width: 100% !important; max-width: 100% !important;
            border-right: none !important; }
        }
        @media (prefers-reduced-motion: reduce) { .as-spin { animation: none; } }
        textarea:focus { border-color: ${T.amber} !important; }
        button:focus-visible { outline: 2px solid ${T.amber}; outline-offset: 2px; }
      `}</style>
    </div>
  );
}

/* ---- subcomponents ---- */
function EmptyState() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
      backgroundColor: T.paper,
      backgroundImage:
        `linear-gradient(${T.grid} 1px, transparent 1px), linear-gradient(90deg, ${T.grid} 1px, transparent 1px)`,
      backgroundSize: "22px 22px" }}>
      <div style={{ textAlign: "center", color: T.textDim, ...sans }}>
        <LayoutGrid size={30} style={{ opacity: 0.4 }} />
        <div style={{ marginTop: 12, fontSize: 14 }}>The drawing board is empty.</div>
        <div style={{ ...mono, fontSize: 11.5, marginTop: 5, opacity: 0.8 }}>
          Write a design on the left and run the pipeline.
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div style={{ position: "absolute", right: 12, bottom: 12, display: "flex", gap: 10,
      flexWrap: "wrap", maxWidth: 420, justifyContent: "flex-end",
      background: "rgba(255,255,255,.92)", border: `1px solid ${T.line}`,
      borderRadius: 9, padding: "8px 10px" }}>
      {Object.entries(CAT).filter(([k]) => k !== "default").map(([k, c]) => (
        <span key={k} style={{ ...mono, fontSize: 10.5, color: T.inkSoft,
          display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: c.fill,
            border: `1.5px solid ${c.stroke}` }} />
          {c.label}
        </span>
      ))}
    </div>
  );
}

function CodePane({ title, badge, text }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      background: "#0F1830" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
        borderBottom: `1px solid ${T.railLine}` }}>
        <span style={{ ...mono, fontSize: 12.5, color: T.inv }}>{title}</span>
        {badge && (
          <span style={{ ...mono, fontSize: 10, color: "#1a1206", background: T.amber,
            borderRadius: 5, padding: "2px 7px" }}>{badge}</span>
        )}
        <div style={{ flex: 1 }} />
        <CopyBtn text={text} />
      </div>
      <pre style={{ ...mono, flex: 1, margin: 0, overflow: "auto", padding: 16,
        fontSize: 12.5, lineHeight: 1.6, color: "#cdd6ef", whiteSpace: "pre",
        tabSize: 2 }}>{text}</pre>
    </div>
  );
}

function ConfigDrawer({ onClose, mode, setMode, endpoint, setEndpoint, drawioUrl, setDrawioUrl }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,24,48,.5)",
      display: "flex", justifyContent: "flex-end", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...sans, width: 460, maxWidth: "92vw",
        height: "100%", background: T.panel, borderLeft: `1px solid ${T.line}`,
        display: "flex", flexDirection: "column", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px",
          borderBottom: `1px solid ${T.line}` }}>
          <span style={{ fontSize: 15, fontWeight: 650 }}>Wire up the endpoint</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "none", border: "none",
            cursor: "pointer", color: T.textDim }}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <div style={cfgLabel}>Source</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["mock", "live"].map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  style={{ ...sans, flex: 1, fontSize: 13, fontWeight: 600,
                    padding: "10px", borderRadius: 9, cursor: "pointer",
                    color: mode === m ? T.ink : T.textDim,
                    background: mode === m ? T.amberSoft : T.panel,
                    border: `1px solid ${mode === m ? "#eccf9f" : T.line}` }}>
                    {m === "mock" ? "Mock Bedrock" : "Live endpoint"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={cfgLabel}>Endpoint URL <span style={{ color: T.textDim }}>(POST)</span></div>
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
              spellCheck={false} style={inputStyle} />
            <div style={{ ...mono, fontSize: 11.5, color: T.textDim, marginTop: 10,
              background: "#F6F4EE", border: `1px solid ${T.line}`, borderRadius: 8,
              padding: 12, lineHeight: 1.6 }}>
              <div style={{ color: T.ink, marginBottom: 6 }}>Contract</div>
              → generate {`{ "prompt": "…" }`}<br />
              → refine&nbsp;&nbsp;&nbsp;{`{ "instruction": "…", "currentGraph": {…} }`}<br />
              ← response {`{ "title?", "nodes": [`}<br />
              &nbsp;&nbsp;&nbsp;{`{ "id", "label", "type" } ],`}<br />
              &nbsp;&nbsp;{`"edges": [ { "from", "to", "label?" } ] }`}<br />
              <span style={{ color: T.textDim }}>
                type ∈ client · edge · compute · ai · data · event · external
              </span>
            </div>
          </div>

          <div>
            <div style={cfgLabel}>draw.io base URL</div>
            <input value={drawioUrl} onChange={(e) => setDrawioUrl(e.target.value)}
              spellCheck={false} style={inputStyle} />
            <div style={{ ...sans, fontSize: 12, color: T.textDim, marginTop: 8, lineHeight: 1.55 }}>
              Point this at your self-hosted build (e.g. the drawio static export on
              S3/CloudFront, or an EC2 container) so nothing leaves the DWP network.
              The embed protocol params are appended automatically.
            </div>
          </div>

          <div style={{ ...mono, fontSize: 11.5, color: T.textDim, lineHeight: 1.65,
            borderTop: `1px solid ${T.line}`, paddingTop: 16 }}>
            <div style={{ color: T.ink, ...sans, fontWeight: 600, marginBottom: 6, fontSize: 12.5 }}>
              System-prompt hint for the model
            </div>
            Ask Bedrock to return only the Graph JSON above — never coordinates.
            The layered layout in this app assigns geometry deterministically, so the
            model never has to reason about pixels.
          </div>
        </div>
      </div>
    </div>
  );
}

const cfgLabel = { ...mono, fontSize: 11, color: T.textDim, textTransform: "uppercase",
  letterSpacing: "0.07em", marginBottom: 8 };
const inputStyle = { ...mono, width: "100%", boxSizing: "border-box", fontSize: 12.5,
  color: T.ink, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8,
  padding: "10px 12px", outline: "none" };

/* ---- helpers ---- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripMxFile = (x) => {
  const m = x.match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/);
  return m ? m[0] : x;
};
function downloadDrawio(xml) {
  downloadText("architecture.drawio", wrapMxFile(xml), "application/xml");
}
function downloadText(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ---- Technical Architecture Document ---- */
function roleGuess(n) {
  const m = {
    client: "User entry point", edge: "Traffic entry / routing",
    compute: "Application logic", ai: "Model inference / orchestration",
    data: "Data persistence", event: "Asynchronous messaging",
    external: "Third-party integration",
  };
  return m[categoryOf(n.type)] || "Service component";
}
// Deterministic offline document (mock mode / fallback). Live mode gets a
// richer narrative from the model via /document.
function buildDocMarkdown(prompt, graph) {
  const nodes = (graph && graph.nodes) || [];
  const edges = (graph && graph.edges) || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const title = (graph && graph.title) || "Technical Architecture";
  const isC = (n) => isContainer(n.type) || nodes.some((m) => m.parent === n.id);
  const leaves = nodes.filter((n) => !isC(n));
  const conts = nodes.filter(isC);
  const placement = (n) => (n.parent && byId[n.parent] ? byId[n.parent].label : "—");
  const svc = (t) => (STENCIL[String(t).toLowerCase()] ? String(t) : (t || "service"));
  let md = `# ${title}\n\n`;
  md += `## 1. Introduction\n\nThis document describes the technical architecture for ${title}. `;
  md += `It is intended for design authority and governance review.\n\n`;
  md += `**Scope:** the components, network placement, and data flows shown in the architecture diagram.\n\n`;
  md += `## 2. Architecture Overview\n\n`;
  if (prompt && prompt.trim()) md += `${prompt.trim()}\n\n`;
  md += `The solution comprises ${leaves.length} service component(s)`;
  md += conts.length ? ` across ${conts.length} network boundary/boundaries.\n\n` : `.\n\n`;
  md += `## 3. Component Inventory\n\n`;
  md += `| Component | AWS service | Placement | Responsibility |\n|---|---|---|---|\n`;
  leaves.forEach((n) => { md += `| ${n.label} | ${svc(n.type)} | ${placement(n)} | ${roleGuess(n)} |\n`; });
  md += `\n## 4. Network Topology and Containment\n\n`;
  if (conts.length) {
    conts.forEach((c) => {
      const kids = nodes.filter((n) => n.parent === c.id).map((n) => n.label);
      md += `- **${c.label}** (${c.type}) contains: ${kids.join(", ") || "—"}\n`;
    });
  } else {
    md += `No explicit network containers were defined; components sit in the default scope.\n`;
  }
  md += `\n## 5. Data and Request Flows\n\n`;
  if (edges.length) {
    edges.forEach((e, i) => {
      const s = byId[e.from], t = byId[e.to];
      md += `${i + 1}. **${s ? s.label : e.from} → ${t ? t.label : e.to}**${e.label ? ` — ${e.label}` : ""}\n`;
    });
  } else md += `No flows were defined.\n`;
  md += `\n## 6. Security Considerations\n\n`;
  md += `- Resources in private subnets are not directly reachable from the internet; ingress is mediated by public-subnet components.\n`;
  md += `- Apply least-privilege IAM roles to each compute component.\n`;
  md += `- Enforce encryption in transit (TLS) and at rest for data stores.\n`;
  md += `- Manage secrets via a dedicated secrets store rather than configuration.\n\n`;
  md += `## 7. Assumptions and Dependencies\n\n`;
  md += `- All components are deployed within a single AWS region.\n`;
  md += `- Network boundaries shown are logical; CIDR ranges are indicative.\n`;
  md += `- Identity, logging, and monitoring services are assumed present at account level.\n\n`;
  md += `## 8. Non-Functional Considerations\n\n`;
  md += `- **Availability:** deploy across multiple availability zones where supported.\n`;
  md += `- **Scalability:** stateless compute scales horizontally; data stores scale per service limits.\n`;
  md += `- **Cost:** managed services are billed per use; review sizing against expected load.\n`;
  return md;
}

// Minimal Markdown renderer (headings, tables, bullets, bold) for the panel.
function DocPane({ doc, busy, error, mode, onGenerate, xml, drawioUrl }) {
  if (busy) return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
      background: T.paper, ...sans, color: T.textDim }}>
      <div style={{ textAlign: "center" }}>
        <Cpu size={26} className="as-spin" style={{ opacity: 0.6 }} />
        <div style={{ marginTop: 10, fontSize: 13.5 }}>Writing the document…</div>
      </div>
    </div>
  );
  if (!doc) return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
      background: T.paper }}>
      <div style={{ textAlign: "center", ...sans, color: T.textDim, maxWidth: 380, padding: 20 }}>
        <FileText size={30} style={{ opacity: 0.4 }} />
        <div style={{ marginTop: 12, fontSize: 14, color: T.ink }}>
          Technical Architecture Document
        </div>
        <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>
          Generated from the prompt and the current diagram —
          {mode === "live" ? " via Bedrock Claude." : " assembled locally (mock mode)."}
        </div>
        {error && (
          <div style={{ ...mono, fontSize: 11.5, color: "#b85450", marginTop: 12 }}>{error}</div>
        )}
        <button onClick={onGenerate}
          style={{ ...sans, marginTop: 16, display: "inline-flex", alignItems: "center", gap: 8,
            fontSize: 13.5, fontWeight: 600, color: "#1a1206", background: T.amber,
            border: "none", borderRadius: 9, padding: "10px 16px", cursor: "pointer" }}>
          <FileText size={15} /> Generate document
        </button>
      </div>
    </div>
  );
  // splice the diagram figure in just before section 3 (Component Inventory)
  const cut = doc.search(/\n#{1,3}\s*3[.\s]/);
  const head = cut >= 0 ? doc.slice(0, cut) : doc;
  const tail = cut >= 0 ? doc.slice(cut) : "";
  const figure = xml && drawioUrl ? (
    <div style={{ margin: "20px 0 26px" }}>
      <div style={{ fontWeight: 700, fontSize: 19, marginTop: 26, marginBottom: 10, color: T.ink,
        borderBottom: `1px solid ${T.line}`, paddingBottom: 6 }}>Architecture Diagram</div>
      <div style={{ height: 460, border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden",
        background: "#fff" }}>
        <DrawioView url={drawioUrl} xml={wrapMxFile(xml)} />
      </div>
      <div style={{ ...mono, fontSize: 11, color: T.textDim, marginTop: 6 }}>
        Figure 1 — rendered from the current diagram.
      </div>
    </div>
  ) : null;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", background: T.paper }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "36px 44px 60px", ...sans,
        color: T.ink, fontSize: 14.5, lineHeight: 1.6 }}>
        {renderMarkdown(head)}
        {figure}
        {tail && renderMarkdown(tail)}
      </div>
    </div>
  );
}
function renderMarkdown(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0, key = 0;
  const inline = (s) => {
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
    return parts.map((p, j) => {
      if (p.startsWith("**") && p.endsWith("**")) return <strong key={j}>{p.slice(2, -2)}</strong>;
      if (p.startsWith("`") && p.endsWith("`"))
        return <code key={j} style={{ ...mono, fontSize: "0.9em", background: "#F1EFE8", padding: "1px 4px", borderRadius: 4 }}>{p.slice(1, -1)}</code>;
      return <span key={j}>{p}</span>;
    });
  };
  while (i < lines.length) {
    const ln = lines[i];
    if (/^#{1,4}\s/.test(ln)) {
      const lvl = ln.match(/^#+/)[0].length;
      const txt = ln.replace(/^#+\s/, "");
      const sizes = { 1: 26, 2: 19, 3: 16, 4: 14.5 };
      out.push(<div key={key++} style={{ fontWeight: 700, fontSize: sizes[lvl] || 14.5,
        marginTop: lvl === 1 ? 0 : 26, marginBottom: 10, color: T.ink,
        borderBottom: lvl <= 2 ? `1px solid ${T.line}` : "none", paddingBottom: lvl <= 2 ? 6 : 0 }}>{inline(txt)}</div>);
      i++; continue;
    }
    if (/^\|/.test(ln) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] || "")) {
      const header = ln.split("|").slice(1, -1).map((s) => s.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(lines[i].split("|").slice(1, -1).map((s) => s.trim())); i++;
      }
      out.push(
        <table key={key++} style={{ borderCollapse: "collapse", width: "100%", margin: "12px 0", fontSize: 13 }}>
          <thead><tr>{header.map((h, j) => (
            <th key={j} style={{ textAlign: "left", padding: "7px 10px", background: "#F1EFE8",
              border: `1px solid ${T.line}`, fontWeight: 600 }}>{inline(h)}</th>))}</tr></thead>
          <tbody>{rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => (
              <td key={ci} style={{ padding: "7px 10px", border: `1px solid ${T.line}`, verticalAlign: "top" }}>{inline(c)}</td>))}</tr>))}</tbody>
        </table>
      );
      continue;
    }
    if (/^[-*]\s/.test(ln)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s/, "")); i++; }
      out.push(<ul key={key++} style={{ margin: "8px 0", paddingLeft: 22 }}>
        {items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{inline(it)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s/.test(ln)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s/, "")); i++; }
      out.push(<ol key={key++} style={{ margin: "8px 0", paddingLeft: 22 }}>
        {items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{inline(it)}</li>)}</ol>);
      continue;
    }
    if (ln.trim() === "") { i++; continue; }
    out.push(<p key={key++} style={{ margin: "8px 0" }}>{inline(ln)}</p>);
    i++;
  }
  return out;
}
