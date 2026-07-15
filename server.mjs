/*
 * Architect Studio — single-origin server for the EC2 (static app + API).
 *
 *   browser ──► CloudFront ──► this service (EC2) ──► Bedrock
 *
 * Serves the built React app AND the extraction API from one Node process, so
 * no nginx is needed — CloudFront forwards everything under /diagram here.
 * Authenticates to Bedrock with the EC2 instance role (no keys, eu-west-2).
 *
 * Install on the instance:
 *   mkdir -p /opt/architect && cd /opt/architect
 *   npm init -y && npm i @aws-sdk/client-bedrock-runtime
 *   # copy this file in + put the built app in STATIC_DIR, run via systemd
 *
 * Env:
 *   PORT          default 8080
 *   HOST          default 0.0.0.0   (lock the SG to CloudFront — see DEPLOY.md)
 *   BASE_PATH     default /diagram
 *   STATIC_DIR    default /var/www/diagram   (the built app: index.html, assets/)
 *   AWS_REGION    default eu-west-2
 *   MODEL_ID      Bedrock model / inference-profile id, e.g. eu.anthropic.claude-...
 *   MAX_TOKENS    default 4096
 *   ORIGIN_SECRET optional; if set, every non-health request must carry header
 *                 x-origin-secret with this value (set it as a CloudFront custom
 *                 origin header so the origin can't be hit directly)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const BASE = process.env.BASE_PATH || "/diagram";
const STATIC_DIR = process.env.STATIC_DIR || "/var/www/diagram";
const REGION = process.env.AWS_REGION || "eu-west-2";
const MODEL_ID = process.env.MODEL_ID || "eu.anthropic.claude-sonnet-4-6-v1:0";
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 4096);
const ORIGIN_SECRET = process.env.ORIGIN_SECRET || "";

const client = new BedrockRuntimeClient({ region: REGION });
const BUCKET_NAME = "cg-process-flow";
const s3 = new S3Client({ region: REGION });

/* --- closed vocabulary: keep in sync with ArchitectStudio.jsx --- */
const SERVICE_TYPES = [
  "lambda", "ec2", "fargate", "s3", "dynamodb", "rds", "aurora", "apigateway",
  "cloudfront", "elb", "natgateway", "bedrock", "sagemaker", "opensearch",
  "eventbridge", "sqs", "sns", "cloudwatch", "kms", "cognito", "stepfunctions",
  "glue", "kinesis", "secretsmanager",
];
const CATEGORY_TYPES = ["client", "compute", "ai", "data", "edge", "event", "external"];
const CONTAINER_TYPES = ["account", "region", "vpc", "az", "public_subnet", "private_subnet", "security_group"];
const ALL = new Set([...SERVICE_TYPES, ...CATEGORY_TYPES, ...CONTAINER_TYPES]);
const KEYWORD_FALLBACK = [
  [/client|user|browser|ui|frontend|portal/, "client"],
  [/gateway|cdn|route ?53|alb|load.?bal|nat|edge/, "edge"],
  [/lambda|ec2|fargate|ecs|compute|function|glue|etl|proxy/, "compute"],
  [/bedrock|sagemaker|nova|claude|titan|model|llm|embedding|inference/, "ai"],
  [/s3|dynamo|rds|aurora|opensearch|vector|db|database|store|bucket/, "data"],
  [/eventbridge|sqs|sns|kafka|queue|stream|event/, "event"],
  [/external|third|saas|partner|siebel|elevenlabs|openai/, "external"],
];

const SYSTEM_PROMPT = `You are an AWS solution architect. You read a design document and extract its architecture as a structured graph. You do NOT draw, position, or produce any XML — you only identify components, how they connect, and where they sit. A separate deterministic system handles all layout and rendering.

Return ONLY a JSON object, no prose, no markdown fences. Schema:
{
  "title": "<short architecture title>",
  "nodes": [ { "id": "<short_slug>", "label": "<human name>", "type": "<type below>", "parent": "<container id, optional>" } ],
  "edges": [ { "from": "<node id>", "to": "<node id>", "label": "<optional, short>" } ]
}

Rules:
- "type" MUST be one of these. Prefer the specific AWS service when identifiable:
  services   : ${SERVICE_TYPES.join(", ")}
  generic    : ${CATEGORY_TYPES.join(", ")}   (only when no specific service fits)
  containers : ${CONTAINER_TYPES.join(", ")}
- Containers (vpc, subnets, az, account, security_group) are themselves nodes.
- Every resource the document places inside a network boundary MUST set "parent" to the id of its IMMEDIATE container. Containers nest via their own "parent".
- public_subnet vs private_subnet: internet-facing resources (ALB, NAT, bastion) -> public_subnet; otherwise private_subnet.
- "edges" express request/data flow direction (caller -> callee).
- ids are short lowercase slugs, unique. Do not invent components the document doesn't imply. Prefer fewer, clearer nodes.
- If ambiguous, pick the closest allowed type and continue.`;

const REFINE_SUFFIX = `

You will be given the CURRENT graph and a change instruction. Apply the change and return the COMPLETE updated graph in the same schema — never a diff. Preserve ids and parent pointers for everything you are not changing.`;

const DOC_SYSTEM_PROMPT = `You are a solution architect writing a Technical Architecture Document (TAD) for a UK government (DWP) audience. You are given the original design intent (the prompt) and the extracted architecture graph — services, containers (with parent nesting), and directed edges for request/data flow.

Write a clear, professional TAD in GitHub-flavoured Markdown, in British English. Ground every statement strictly in the provided prompt and graph — do not invent services, regions, or requirements that are not implied. Where the inputs are silent, state it as an assumption rather than a fact.

Use exactly these sections, in order:

# <Architecture title>
## 1. Introduction
Purpose, scope, and intended audience (design authority / governance review).
## 2. Architecture Overview
Prose describing the solution and how a request flows end to end.
## 3. Component Inventory
A Markdown table: Component | AWS service | Placement | Responsibility. One row per service node (exclude container nodes).
## 4. Network Topology and Containment
The VPC / subnet / availability-zone structure from the container nesting: what sits in which boundary and the public vs private rationale.
## 5. Data and Request Flows
Each edge as a numbered flow: source -> target, and what moves between them.
## 6. Security Considerations
Subnet isolation, least privilege, data in transit/at rest, secrets — grounded in the topology. Note gaps as recommendations.
## 7. Assumptions and Dependencies
Bulleted; everything the design implies but does not state.
## 8. Non-Functional Considerations
Availability, scalability, and cost notes appropriate to the components shown.

Output only the Markdown document — no preamble, no code fences.`;

/* ---- process mode: prompt, vocabulary, validation, vsdx import ---- */
const PROCESS_SYSTEM_PROMPT = `You are a business analyst mapping a process. You read a business scenario and extract it as a structured flowchart graph. You do NOT draw or position anything — you only identify the steps, their order, and the decisions.

Return ONLY a JSON object, no prose, no code fences:
{ "title": "…", "nodes": [ { "id", "label", "type" } ], "edges": [ { "from", "to", "label?" } ] }

"type" MUST be one of:
  start    — the single entry point (the trigger / inbound event)
  step     — a system or standard step
  process  — a primary processing step
  manual   — a step a person performs by hand (a manual action)
  decision — a yes/no or branching question (label ends with "?")
  end      — a terminal / exit point

Rules:
- Exactly one start; one or more end.
- A decision has two or more outgoing edges; label each edge with its branch (e.g. "Yes" / "No").
- Keep labels short and imperative. ids are short lowercase slugs, unique.
- Order edges in flow direction (a step -> the next step).
- Do not invent steps the scenario does not imply.`;

const PROCESS_REFINE = `

You will be given the CURRENT graph and a change instruction. Apply it and return the COMPLETE updated graph in the same schema — never a diff. Keep ids stable for steps you are not changing.`;

const PROCESS_TYPES = new Set(["start", "step", "process", "manual", "decision", "end"]);
function coerceProcess(t) {
  t = String(t || "").toLowerCase();
  if (PROCESS_TYPES.has(t)) return t;
  if (/start|begin|trigger|inbound/.test(t)) return "start";
  if (/end|close|finish|stop|exit|terminate/.test(t)) return "end";
  if (/decision|choice|branch|gateway|\?/.test(t)) return "decision";
  if (/manual|by.?hand|human/.test(t)) return "manual";
  return "step";
}
function validateProcess(graph) {
  const seen = new Set(), nodes = [];
  for (const n of graph.nodes || []) {
    const id = String(n.id || "").trim(); if (!id || seen.has(id)) continue; seen.add(id);
    nodes.push({ id, label: String(n.label || id), type: coerceProcess(n.type) });
  }
  const ids = new Set(nodes.map((n) => n.id)); const es = new Set(), edges = [];
  for (const e of graph.edges || []) {
    const f = String(e.from || ""), t = String(e.to || ""), k = f + ">" + t;
    if (ids.has(f) && ids.has(t) && !es.has(k)) { es.add(k); const ed = { from: f, to: t }; if (e.label) ed.label = String(e.label); edges.push(ed); }
  }
  return { title: String(graph.title || "Process"), nodes, edges };
}

// parse a .vsdx buffer into a process graph
async function vsdxToGraph(buf) {
  const zip = await JSZip.loadAsync(buf);
  const parse = (x) => new DOMParser().parseFromString(x, "text/xml");
  const els = (n, t) => Array.from(n.getElementsByTagName(t));
  const txt = (n) => (n && n.textContent ? n.textContent.replace(/\s+/g, " ").trim() : "");
  const masters = {};
  const mf = zip.file("visio/masters/masters.xml");
  if (mf) for (const m of els(parse(await mf.async("string")), "Master")) masters[m.getAttribute("ID")] = m.getAttribute("NameU") || m.getAttribute("Name") || "";
  const pages = Object.keys(zip.files).filter((n) => /visio\/pages\/page\d+\.xml$/i.test(n)).sort();
  if (!pages.length) throw new Error("No page XML found — not a valid .vsdx");
  const shapeMap = {}, connects = [];
  for (const pn of pages) {
    const doc = parse(await zip.file(pn).async("string"));
    for (const s of els(doc, "Shape")) { const id = s.getAttribute("ID"); if (!id) continue; const fc = els(s, "Cell").find((c) => c.getAttribute("N") === "FillForegnd"); shapeMap[id] = { text: txt(els(s, "Text")[0]), master: masters[s.getAttribute("Master")] || "", fill: fc ? fc.getAttribute("V") : "" }; }
    for (const c of els(doc, "Connect")) connects.push({ conn: c.getAttribute("FromSheet"), sheet: c.getAttribute("ToSheet"), cell: c.getAttribute("FromCell") || "" });
  }
  const connIds = new Set(connects.map((c) => c.conn)); const byConn = {};
  for (const c of connects) (byConn[c.conn] = byConn[c.conn] || []).push(c);
  const edges = [];
  for (const [conn, ends] of Object.entries(byConn)) {
    const from = ends.find((e) => /^Begin/i.test(e.cell)), to = ends.find((e) => /^End/i.test(e.cell));
    if (from && to && from.sheet !== to.sheet) edges.push({ from: from.sheet, to: to.sheet, label: (shapeMap[conn] && shapeMap[conn].text) || "" });
  }
  const ref = new Set(edges.flatMap((e) => [e.from, e.to]));
  // classify by text ("?"), polygon geometry, and fill colour — Visio process
  // maps rarely use flowchart-named masters, so geometry/colour carry the meaning.
  const cls = (master, text, fill) => {
    const m = (master || "").toLowerCase(), t = (text || "").toLowerCase(), f = (fill || "").toLowerCase();
    if (/\?\s*$/.test((text || "").trim()) || /diamond|rhombus|decision|octagon|hexagon|heptagon|pentagon/.test(m)) return "decision";
    if (/^start|start point|inbound|trigger/.test(t) || /c5e0b3|00b050|92d050/.test(f)) return "start";
    if (/^end|end point|stop|finish|\bclose\b|exit/.test(t)) return "end";
    if (/manual/.test(m) || /manually|by hand/.test(t)) return "manual";
    if (/circle|ellipse|terminator/.test(m)) return "terminal";
    return "process";
  };
  let nodes = Object.entries(shapeMap).filter(([id, s]) => !connIds.has(id) && (ref.has(id) || s.text)).map(([id, s]) => ({ id, label: s.text || "(unnamed)", type: cls(s.master, s.text, s.fill) }));
  const indeg = {}; nodes.forEach((n) => { indeg[n.id] = 0; });
  edges.forEach((e) => { if (e.to in indeg) indeg[e.to]++; });
  nodes.forEach((n) => { if (n.type === "terminal") n.type = indeg[n.id] === 0 ? "start" : "end"; });
  return { title: "Imported process", nodes, edges };
}

/* --- parse + validate (guardrail) --- */
function extractJson(text) {
  text = String(text).trim();
  if (text.startsWith("```")) text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) text = text.slice(s, e + 1);
  return JSON.parse(text);
}
function coerceType(t) {
  t = String(t || "").trim().toLowerCase();
  if (ALL.has(t)) return t;
  for (const [re, cat] of KEYWORD_FALLBACK) if (re.test(t)) return cat;
  return "default";
}
function validate(graph) {
  const seen = new Set(), nodes = [];
  for (const n of graph.nodes || []) {
    const id = String(n.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = { id, label: String(n.label || id), type: coerceType(n.type) };
    if (n.parent) node.parent = String(n.parent);
    nodes.push(node);
  }
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) if (n.parent && !ids.has(n.parent)) delete n.parent;
  const eseen = new Set(), edges = [];
  for (const e of graph.edges || []) {
    const f = String(e.from || ""), t = String(e.to || ""), k = `${f}->${t}`;
    if (ids.has(f) && ids.has(t) && !eseen.has(k)) {
      eseen.add(k);
      const edge = { from: f, to: t };
      if (e.label) edge.label = String(e.label);
      edges.push(edge);
    }
  }
  return { title: String(graph.title || "Architecture"), nodes, edges };
}

/* --- Bedrock call (instance role) --- */
async function runModel(system, user) {
  const cmd = new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: user }] }],
    inferenceConfig: { maxTokens: MAX_TOKENS, temperature: 0.2 },
  });
  const r = await client.send(cmd);
  return r.output.message.content.map((b) => b.text || "").join("");
}

/* --- static file serving (the built app) --- */
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json",
};
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel.startsWith(BASE)) rel = rel.slice(BASE.length);
  if (rel === "" || rel === "/") rel = "/index.html";
  const target = path.normalize(path.join(STATIC_DIR, rel));
  if (!target.startsWith(path.normalize(STATIC_DIR))) { res.writeHead(403); return res.end(); }
  fs.readFile(target, (err, buf) => {
    if (err) {  // SPA fallback
      fs.readFile(path.join(STATIC_DIR, "index.html"), (e2, idx) => {
        if (e2) { res.writeHead(404); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": "text/html" }); res.end(idx);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream" });
    res.end(buf);
  });
}

/* --- http --- */
const send = (res, status, obj) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};
const isApiPath = (p) => /\/(api\/)?extract$/.test(p);
const isDocPath = (p) => /\/document$/.test(p);
const isVsdxPath = (p) => /\/process\/vsdx$/.test(p);
const isProcessPath = (p) => /\/process$/.test(p);
const isHealth = (p) => /\/health$/.test(p);
const isUsersPath = (p) => /\/users$/.test(p);
const isFlowsPath = (p) => /\/flows$/.test(p);
const isFlowsGetPath = (p) => /\/flows\/get$/.test(p);

// Robust stream to string decoder helper for AWS S3 response body compatibility
async function s3BodyToString(body) {
  if (body && typeof body.transformToString === "function") {
    return await body.transformToString();
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    body.on("data", (chunk) => chunks.push(chunk));
    body.on("error", reject);
    body.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const readBody = (req) => new Promise((res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => res(b)); });

const server = http.createServer((req, res) => {
  console.log(new Date().toISOString(), req.method, req.url);
  const urlPath = req.url.split("?")[0];

  if (req.method === "GET" && isHealth(urlPath)) return send(res, 200, { ok: true });

  // origin lock: reject anything not coming through CloudFront (if configured)
  if (ORIGIN_SECRET && req.headers["x-origin-secret"] !== ORIGIN_SECRET)
    return send(res, 403, { error: "forbidden" });

  if (req.method === "POST" && isVsdxPath(urlPath)) {
    readBody(req).then(async (body) => {
      let reqj; try { reqj = JSON.parse(body || "{}"); } catch { return send(res, 400, { error: "Body must be valid JSON" }); }
      if (!reqj.vsdx) return send(res, 400, { error: "Provide { vsdx: base64 }" });
      try {
        const graph = validateProcess(await vsdxToGraph(Buffer.from(reqj.vsdx, "base64")));
        if (!graph.nodes.length) return send(res, 422, { error: "No shapes found in the .vsdx" });
        send(res, 200, graph);
      } catch (e) { console.error(e?.name, e?.message); send(res, 500, { error: e?.name || "Error", detail: String(e?.message || e).slice(0, 500) }); }
    });
    return;
  }

  if (req.method === "POST" && isProcessPath(urlPath)) {
    readBody(req).then(async (body) => {
      let reqj; try { reqj = JSON.parse(body || "{}"); } catch { return send(res, 400, { error: "Body must be valid JSON" }); }
      let system, user;
      if (reqj.instruction && reqj.currentGraph != null) {
        system = PROCESS_SYSTEM_PROMPT + PROCESS_REFINE;
        user = `CURRENT GRAPH:\n${JSON.stringify(reqj.currentGraph)}\n\nINSTRUCTION:\n${reqj.instruction}`;
      } else if (reqj.prompt) {
        system = PROCESS_SYSTEM_PROMPT;
        user = `BUSINESS SCENARIO:\n${reqj.prompt}`;
      } else return send(res, 400, { error: "Provide {prompt} or {instruction, currentGraph}" });
      try {
        const raw = await runModel(system, user);
        const graph = validateProcess(extractJson(raw));
        if (!graph.nodes.length) return send(res, 422, { error: "No steps recognised", raw: String(raw).slice(0, 1500) });
        send(res, 200, graph);
      } catch (e) { console.error(e?.name, e?.message); send(res, 500, { error: e?.name || "Error", detail: String(e?.message || e).slice(0, 500) }); }
    });
    return;
  }

  if (req.method === "POST" && isDocPath(urlPath)) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let reqj;
      try { reqj = JSON.parse(body || "{}"); } catch { return send(res, 400, { error: "Body must be valid JSON" }); }
      if (!reqj.graph && !reqj.prompt) return send(res, 400, { error: "Provide {prompt, graph}" });
      const user = `DESIGN INTENT:\n${reqj.prompt || "(none provided)"}\n\nARCHITECTURE GRAPH (JSON):\n${JSON.stringify(reqj.graph || {})}`;
      try {
        let md = await runModel(DOC_SYSTEM_PROMPT, user);
        md = String(md).replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
        send(res, 200, { markdown: md });
      } catch (e) {
        console.error(e?.name, e?.message);
        send(res, 500, { error: e?.name || "Error", detail: String(e?.message || e).slice(0, 500) });
      }
    });
    return;
  }

  if (req.method === "POST" && isApiPath(urlPath)) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let reqj;
      try { reqj = JSON.parse(body || "{}"); } catch { return send(res, 400, { error: "Body must be valid JSON" }); }
      let system, user;
      if (reqj.instruction && reqj.currentGraph != null) {
        system = SYSTEM_PROMPT + REFINE_SUFFIX;
        user = `CURRENT GRAPH:\n${JSON.stringify(reqj.currentGraph)}\n\nINSTRUCTION:\n${reqj.instruction}`;
      } else if (reqj.prompt) {
        system = SYSTEM_PROMPT;
        user = `DESIGN DOCUMENT:\n${reqj.prompt}`;
      } else {
        return send(res, 400, { error: "Provide either {prompt} or {instruction, currentGraph}" });
      }
      try {
        const raw = await runModel(system, user);
        const graph = validate(extractJson(raw));
        if (!graph.nodes.length) return send(res, 422, { error: "No recognisable components", raw: String(raw).slice(0, 1500) });
        send(res, 200, graph);
      } catch (e) {
        console.error(e?.name, e?.message);
        send(res, 500, { error: e?.name || "Error", detail: String(e?.message || e).slice(0, 500) });
      }
    });
    return;
  }

  if (req.method === "GET" && isUsersPath(urlPath)) {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: "data/",
      Delimiter: "/"
    });
    s3.send(command).then((data) => {
      const dirs = (data.CommonPrefixes || []).map((p) => {
        const parts = p.Prefix.split("/");
        return parts[parts.length - 2];
      });
      send(res, 200, { users: dirs });
    }).catch((err) => {
      console.error(err);
      send(res, 500, { error: "Failed to list users" });
    });
    return;
  }

  if (req.method === "GET" && isFlowsPath(urlPath)) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const username = parsedUrl.searchParams.get("username");
    const role = parsedUrl.searchParams.get("role");
    const targetUser = parsedUrl.searchParams.get("targetUser") || username;

    if (!username) {
      return send(res, 400, { error: "Missing username parameter." });
    }

    let prefix = `data/${targetUser}/`;
    if (role === "appadmin" && targetUser === "all") {
      prefix = "data/";
    }

    const listCmd = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix
    });
    s3.send(listCmd).then(async (listData) => {
      const files = (listData.Contents || []).filter((item) => item.Key.endsWith(".json"));

      const diagrams = await Promise.all(
        files.map(async (file) => {
          try {
            const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: file.Key });
            const s3Res = await s3.send(getCmd);
            const s3Body = await s3BodyToString(s3Res.Body);
            const fileData = JSON.parse(s3Body);

            const parts = file.Key.split("/");
            const uName = parts[1];

            return {
              id: fileData.id,
              name: fileData.name,
              type: fileData.type,
              updatedAt: fileData.updatedAt,
              username: uName
            };
          } catch (e) {
            console.error("Error fetching diagram data in list map for key", file.Key, e);
            return null;
          }
        })
      );

      const sortedDiagrams = diagrams
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      send(res, 200, { diagrams: sortedDiagrams });
    }).catch((err) => {
      console.error("Error listing S3 objects", err);
      send(res, 500, { error: "Failed to list flows" });
    });
    return;
  }

  if (req.method === "GET" && isFlowsGetPath(urlPath)) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const username = parsedUrl.searchParams.get("username");
    const id = parsedUrl.searchParams.get("id");

    if (!username || !id) {
      return send(res, 400, { error: "Missing username or id parameter." });
    }

    const key = `data/${username}/${id}.json`;
    const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
    s3.send(getCmd).then(async (s3Res) => {
      const fileContent = await s3BodyToString(s3Res.Body);
      send(res, 200, JSON.parse(fileContent));
    }).catch((err) => {
      console.error("Error fetching single flow", key, err);
      send(res, 404, { error: "Diagram not found." });
    });
    return;
  }

  if (req.method === "POST" && isFlowsPath(urlPath)) {
    readBody(req).then(async (body) => {
      let reqj;
      try { reqj = JSON.parse(body || "{}"); } catch { return send(res, 400, { error: "Body must be valid JSON" }); }
      const { username, id, name, type, payload } = reqj;

      if (!username || !id || !name || !type || !payload) {
        return send(res, 400, { error: "Missing required fields in payload." });
      }

      const key = `data/${username}/${id}.json`;
      const diagramData = {
        id,
        name,
        type,
        payload,
        updatedAt: new Date().toISOString(),
      };

      const putCmd = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: JSON.stringify(diagramData, null, 2),
        ContentType: "application/json"
      });

      await s3.send(putCmd);
      send(res, 200, { success: true, diagram: { id, name, type, updatedAt: diagramData.updatedAt, username } });
    }).catch((err) => {
      console.error(err);
      send(res, 500, { error: "Failed to save diagram." });
    });
    return;
  }

  if (req.method === "DELETE" && isFlowsPath(urlPath)) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const username = parsedUrl.searchParams.get("username");
    const id = parsedUrl.searchParams.get("id");

    if (!username || !id) {
      return send(res, 400, { error: "Missing username or id parameter." });
    }

    const key = `data/${username}/${id}.json`;
    const deleteCmd = new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key });
    s3.send(deleteCmd).then(() => {
      send(res, 200, { success: true });
    }).catch((err) => {
      send(res, 404, { error: "Diagram not found." });
    });
    return;
  }

  if (req.method === "GET") return serveStatic(req, res);
  return send(res, 405, { error: "method not allowed" });
});

server.listen(PORT, HOST, () =>
  console.log(`Architect on http://${HOST}:${PORT}  base=${BASE}  static=${STATIC_DIR}  region=${REGION}  model=${MODEL_ID}`));
