import React, { useState, useRef, useCallback } from "react";
import {
  Upload, Trash2, Sparkles, Download, X, GripVertical,
  Loader2, Pencil, Check, ImagePlus, ChevronLeft, ChevronRight
} from "lucide-react";

let uid = 0;
const nextId = () => `id_${Date.now()}_${uid++}`;

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

export default function ProcessVideoBuilder() {
  const [shots, setShots] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [context, setContext] = useState("");
  const [drawMode, setDrawMode] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [drawing, setDrawing] = useState(null); // {x,y,w,h} live preview
  const [selectedHighlight, setSelectedHighlight] = useState(null);
  const [editingLabelId, setEditingLabelId] = useState(null);
  const [labelDraft, setLabelDraft] = useState("");

  const fileInputRef = useRef(null);
  const overlayRef = useRef(null);
  const drawStart = useRef(null);

  const selected = shots.find((s) => s.id === selectedId) || null;
  const selectedIndex = shots.findIndex((s) => s.id === selectedId);

  // ---------- Upload ----------
  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const newShots = [];
    for (const f of files) {
      try {
        const src = await readFileAsDataURL(f);
        newShots.push({
          id: nextId(),
          name: f.name.replace(/\.[^/.]+$/, ""),
          src,
          highlights: [],
          narration: "",
          caption: "",
          aiLoading: false,
          aiError: "",
        });
      } catch (e) {
        // skip unreadable file
      }
    }
    setShots((prev) => {
      const merged = [...prev, ...newShots];
      if (!selectedId && merged.length) setSelectedId(merged[0].id);
      return merged;
    });
  }, [selectedId]);

  const handleFileInput = (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  };

  const handleZoneDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  // ---------- Reorder ----------
  const handleReorderDrop = (targetIndex) => {
    if (dragIndex === null || dragIndex === targetIndex) return;
    setShots((prev) => {
      const arr = [...prev];
      const [moved] = arr.splice(dragIndex, 1);
      arr.splice(targetIndex, 0, moved);
      return arr;
    });
    setDragIndex(null);
  };

  const removeShot = (id) => {
    setShots((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // ---------- Highlight drawing ----------
  const pctFromEvent = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const onOverlayMouseDown = (e) => {
    if (!drawMode || !selected) return;
    const p = pctFromEvent(e);
    drawStart.current = p;
    setDrawing({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onOverlayMouseMove = (e) => {
    if (!drawMode || !drawStart.current) return;
    const p = pctFromEvent(e);
    const s = drawStart.current;
    setDrawing({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  };

  const onOverlayMouseUp = () => {
    if (!drawMode || !drawing || !selected) {
      drawStart.current = null;
      setDrawing(null);
      return;
    }
    if (drawing.w > 0.02 && drawing.h > 0.02) {
      const label = String.fromCharCode(65 + (selected.highlights.length % 26));
      const newHl = { id: nextId(), ...drawing, label: `Point ${label}` };
      setShots((prev) =>
        prev.map((s) =>
          s.id === selected.id ? { ...s, highlights: [...s.highlights, newHl] } : s
        )
      );
    }
    drawStart.current = null;
    setDrawing(null);
  };

  const deleteHighlight = (shotId, hlId) => {
    setShots((prev) =>
      prev.map((s) =>
        s.id === shotId ? { ...s, highlights: s.highlights.filter((h) => h.id !== hlId) } : s
      )
    );
    if (selectedHighlight === hlId) setSelectedHighlight(null);
  };

  const startRename = (hl) => {
    setEditingLabelId(hl.id);
    setLabelDraft(hl.label);
  };

  const commitRename = (shotId, hlId) => {
    setShots((prev) =>
      prev.map((s) =>
        s.id === shotId
          ? { ...s, highlights: s.highlights.map((h) => (h.id === hlId ? { ...h, label: labelDraft || h.label } : h)) }
          : s
      )
    );
    setEditingLabelId(null);
  };

  // ---------- Narration editing ----------
  const updateShotField = (id, field, value) => {
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  // ---------- Claude enhancement ----------
  const enhanceWithClaude = async (shot) => {
    updateShotField(shot.id, "aiLoading", true);
    updateShotField(shot.id, "aiError", "");
    try {
      const match = shot.src.match(/^data:(.*?);base64,(.*)$/);
      if (!match) throw new Error("Could not read image data");
      const mediaType = match[1];
      const base64 = match[2];

      const highlightDesc = shot.highlights.length
        ? shot.highlights.map((h) => h.label).join(", ")
        : "none marked";

      const stepPosition = `Step ${shots.findIndex((s) => s.id === shot.id) + 1} of ${shots.length}`;

      const prompt = `You are writing voiceover narration for a step-by-step process training video aimed at UK government caseworkers. Keep language plain, instructional and concise (no jargon, no filler).

Process context (what this whole video is training on): ${context || "not provided"}
This screenshot's position: ${stepPosition}
Screenshot file name (may hint at the step): ${shot.name}
User-marked highlight areas on this screenshot: ${highlightDesc}

Write:
1. A 2-3 sentence narration script for this single screen, describing what the user is looking at and what action to take, referencing the highlighted areas naturally if any exist.
2. A short on-screen caption, under 8 words, suitable as a text overlay.

Respond ONLY with raw JSON, no markdown fences, no preamble, in this exact shape:
{"narration": "...", "caption": "..."}`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      });

      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = await response.json();
      const textBlock = (data.content || []).find((b) => b.type === "text");
      const raw = (textBlock?.text || "").trim();
      const cleaned = raw.replace(/^```json\s*|^```\s*|```$/g, "").trim();
      const parsed = JSON.parse(cleaned);

      setShots((prev) =>
        prev.map((s) =>
          s.id === shot.id
            ? { ...s, narration: parsed.narration || s.narration, caption: parsed.caption || s.caption, aiLoading: false }
            : s
        )
      );
    } catch (err) {
      updateShotField(shot.id, "aiError", "Couldn't generate suggestions. Try again.");
      updateShotField(shot.id, "aiLoading", false);
    }
  };

  // ---------- Export ----------
  const exportScript = () => {
    const lines = [`# Process training video script`, ``];
    if (context) lines.push(`**Process context:** ${context}`, ``);
    shots.forEach((s, i) => {
      lines.push(`## Step ${i + 1}: ${s.name}`);
      if (s.caption) lines.push(``, `**On-screen caption:** ${s.caption}`);
      if (s.narration) lines.push(``, `**Narration:** ${s.narration}`);
      if (s.highlights.length) {
        lines.push(``, `**Highlighted areas:** ${s.highlights.map((h) => h.label).join(", ")}`);
      }
      lines.push(``, `---`, ``);
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "process-video-script.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportPipelineManifest = () => {
    const manifest = {
      version: 1,
      context,
      steps: shots.map((s, i) => ({
        index: i,
        name: s.name,
        caption: s.caption,
        narration: s.narration,
        image: s.src,
        highlights: s.highlights.map((h) => ({ label: h.label, x: h.x, y: h.y, w: h.w, h: h.h })),
      })),
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "manifest.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const goPrev = () => {
    if (selectedIndex > 0) setSelectedId(shots[selectedIndex - 1].id);
  };
  const goNext = () => {
    if (selectedIndex < shots.length - 1) setSelectedId(shots[selectedIndex + 1].id);
  };

  return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');
        * { box-sizing: border-box; }
        .pvb-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .pvb-scroll::-webkit-scrollbar-thumb { background: #3A3D45; border-radius: 4px; }
        .pvb-btn { transition: background .15s ease, border-color .15s ease, transform .1s ease; cursor: pointer; }
        .pvb-btn:hover { filter: brightness(1.12); }
        .pvb-btn:active { transform: scale(0.97); }
        .pvb-thumb { transition: border-color .15s ease, opacity .15s ease; }
        input[type=text], textarea { font-family: 'Inter', sans-serif; }
        textarea:focus, input:focus { outline: 2px solid #F4B740; outline-offset: 1px; }
      `}</style>

      {/* Top bar */}
      <div style={styles.topbar}>
        <div style={styles.brand}>
          <span style={styles.brandMark}>PVB</span>
          <span style={styles.brandTitle}>Process Video Builder</span>
        </div>
        <input
          type="text"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Describe the process this video walks through (used to guide AI narration)…"
          style={styles.contextInput}
        />
        <button
          className="pvb-btn"
          onClick={exportScript}
          disabled={!shots.length}
          style={{ ...styles.secondaryBtn, opacity: shots.length ? 1 : 0.4 }}
        >
          <Download size={15} /> Script (.md)
        </button>
        <button
          className="pvb-btn"
          onClick={exportPipelineManifest}
          disabled={!shots.length}
          style={{ ...styles.primaryBtn, opacity: shots.length ? 1 : 0.4 }}
        >
          <Download size={15} /> Pipeline (.json)
        </button>
      </div>

      <div style={styles.body}>
        {/* Left rail: thumbnails */}
        <div style={styles.rail}>
          <div style={styles.railHeader}>
            <span>STEPS</span>
            <span style={styles.railCount}>{shots.length}</span>
          </div>
          <div className="pvb-scroll" style={styles.railList}>
            {shots.map((s, i) => (
              <div
                key={s.id}
                className="pvb-thumb"
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleReorderDrop(i)}
                onClick={() => setSelectedId(s.id)}
                style={{
                  ...styles.thumbItem,
                  borderColor: s.id === selectedId ? "#F4B740" : "#35383F",
                  opacity: dragIndex === i ? 0.4 : 1,
                }}
              >
                <GripVertical size={14} color="#6B6E78" style={{ flexShrink: 0 }} />
                <span style={styles.thumbNum}>{i + 1}</span>
                <img src={s.src} alt={s.name} style={styles.thumbImg} />
                <button
                  className="pvb-btn"
                  onClick={(e) => { e.stopPropagation(); removeShot(s.id); }}
                  style={styles.thumbDelete}
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <button className="pvb-btn" onClick={() => fileInputRef.current?.click()} style={styles.addBtn}>
            <ImagePlus size={15} /> Add screenshots
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileInput}
            style={{ display: "none" }}
          />
        </div>

        {/* Center: canvas */}
        <div style={styles.canvasArea}>
          {!selected ? (
            <div
              style={styles.emptyZone}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleZoneDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={28} color="#6B6E78" />
              <div style={styles.emptyTitle}>Drop screenshots here</div>
              <div style={styles.emptySub}>or click to browse — arrange, mark up and script each step</div>
            </div>
          ) : (
            <>
              <div style={styles.canvasToolbar}>
                <button className="pvb-btn" onClick={goPrev} disabled={selectedIndex === 0} style={styles.navBtn}>
                  <ChevronLeft size={16} />
                </button>
                <span style={styles.canvasStepLabel}>Step {selectedIndex + 1} of {shots.length} — {selected.name}</span>
                <button className="pvb-btn" onClick={goNext} disabled={selectedIndex === shots.length - 1} style={styles.navBtn}>
                  <ChevronRight size={16} />
                </button>
                <div style={{ flex: 1 }} />
                <button
                  className="pvb-btn"
                  onClick={() => setDrawMode((d) => !d)}
                  style={{
                    ...styles.toggleBtn,
                    background: drawMode ? "#F4B740" : "#2C2F36",
                    color: drawMode ? "#1C1D21" : "#EDEDEE",
                  }}
                >
                  <Pencil size={14} /> {drawMode ? "Marking up — click & drag" : "Mark up"}
                </button>
              </div>

              <div style={styles.canvasFrame} className="pvb-scroll">
                <div
                  ref={overlayRef}
                  style={{ ...styles.imgWrap, cursor: drawMode ? "crosshair" : "default" }}
                  onMouseDown={onOverlayMouseDown}
                  onMouseMove={onOverlayMouseMove}
                  onMouseUp={onOverlayMouseUp}
                  onMouseLeave={() => { if (drawStart.current) { drawStart.current = null; setDrawing(null); } }}
                >
                  <img src={selected.src} alt={selected.name} style={styles.mainImg} draggable={false} />
                  {selected.highlights.map((h) => (
                    <div
                      key={h.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedHighlight(h.id); }}
                      style={{
                        position: "absolute",
                        left: `${h.x * 100}%`,
                        top: `${h.y * 100}%`,
                        width: `${h.w * 100}%`,
                        height: `${h.h * 100}%`,
                        border: `2px solid #F4B740`,
                        background: "rgba(244,183,64,0.16)",
                        boxShadow: selectedHighlight === h.id ? "0 0 0 2px #F4B740" : "none",
                      }}
                    >
                      <span style={styles.highlightTag}>{h.label}</span>
                    </div>
                  ))}
                  {drawing && (
                    <div
                      style={{
                        position: "absolute",
                        left: `${drawing.x * 100}%`,
                        top: `${drawing.y * 100}%`,
                        width: `${drawing.w * 100}%`,
                        height: `${drawing.h * 100}%`,
                        border: "2px dashed #F4B740",
                        background: "rgba(244,183,64,0.10)",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right panel */}
        <div style={styles.panel}>
          {!selected ? (
            <div style={styles.panelEmpty}>Select or add a screenshot to start scripting it.</div>
          ) : (
            <>
              <div style={styles.panelSection}>
                <div style={styles.panelLabel}>HIGHLIGHTED AREAS</div>
                {selected.highlights.length === 0 ? (
                  <div style={styles.panelHint}>Turn on "Mark up" and drag over the screenshot to flag areas the narration should reference.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {selected.highlights.map((h) => (
                      <div key={h.id} style={styles.hlRow}>
                        <span style={styles.hlSwatch} />
                        {editingLabelId === h.id ? (
                          <input
                            autoFocus
                            value={labelDraft}
                            onChange={(e) => setLabelDraft(e.target.value)}
                            onBlur={() => commitRename(selected.id, h.id)}
                            onKeyDown={(e) => e.key === "Enter" && commitRename(selected.id, h.id)}
                            style={styles.hlInput}
                          />
                        ) : (
                          <span style={styles.hlLabel} onClick={() => startRename(h)}>{h.label}</span>
                        )}
                        {editingLabelId === h.id ? (
                          <button className="pvb-btn" onClick={() => commitRename(selected.id, h.id)} style={styles.iconBtnSmall}><Check size={12} /></button>
                        ) : (
                          <button className="pvb-btn" onClick={() => startRename(h)} style={styles.iconBtnSmall}><Pencil size={12} /></button>
                        )}
                        <button className="pvb-btn" onClick={() => deleteHighlight(selected.id, h.id)} style={styles.iconBtnSmall}><Trash2 size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={styles.panelSection}>
                <div style={styles.panelLabelRow}>
                  <span style={styles.panelLabel}>NARRATION</span>
                  <button
                    className="pvb-btn"
                    onClick={() => enhanceWithClaude(selected)}
                    disabled={selected.aiLoading}
                    style={styles.aiBtn}
                  >
                    {selected.aiLoading ? <Loader2 size={13} className="pvb-spin" style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={13} />}
                    {selected.aiLoading ? "Thinking…" : "Enhance with Claude"}
                  </button>
                </div>
                {selected.aiError && <div style={styles.errorText}>{selected.aiError}</div>}
                <textarea
                  value={selected.narration}
                  onChange={(e) => updateShotField(selected.id, "narration", e.target.value)}
                  placeholder="Voiceover script for this step — write it yourself, or generate a starting point with Claude."
                  style={styles.textarea}
                  rows={6}
                />
              </div>

              <div style={styles.panelSection}>
                <div style={styles.panelLabel}>ON-SCREEN CAPTION</div>
                <input
                  type="text"
                  value={selected.caption}
                  onChange={(e) => updateShotField(selected.id, "caption", e.target.value)}
                  placeholder="Short text overlay, e.g. 'Select case type'"
                  style={styles.captionInput}
                />
              </div>

              <div style={styles.panelSection}>
                <div style={styles.panelLabel}>STEP NAME</div>
                <input
                  type="text"
                  value={selected.name}
                  onChange={(e) => updateShotField(selected.id, "name", e.target.value)}
                  style={styles.captionInput}
                />
              </div>
            </>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const styles = {
  app: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    minHeight: 640,
    background: "#1C1D21",
    color: "#EDEDEE",
    fontFamily: "'Inter', sans-serif",
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "12px 18px",
    borderBottom: "1px solid #2C2F36",
    background: "#1C1D21",
    flexShrink: 0,
  },
  brand: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  brandMark: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    background: "#F4B740",
    color: "#1C1D21",
    padding: "3px 6px",
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  brandTitle: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 15 },
  contextInput: {
    flex: 1,
    background: "#24262B",
    border: "1px solid #35383F",
    borderRadius: 6,
    padding: "8px 12px",
    color: "#EDEDEE",
    fontSize: 13,
  },
  primaryBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#F4B740",
    color: "#1C1D21",
    border: "none",
    borderRadius: 6,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
  },
  secondaryBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#2C2F36",
    color: "#EDEDEE",
    border: "1px solid #45484F",
    borderRadius: 6,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
  },
  body: { flex: 1, display: "flex", minHeight: 0 },
  rail: {
    width: 220,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid #2C2F36",
    background: "#1F2024",
    flexShrink: 0,
  },
  railHeader: {
    display: "flex",
    justifyContent: "space-between",
    padding: "12px 14px 8px",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: 1,
    color: "#8B8D97",
  },
  railCount: { color: "#F4B740" },
  railList: { flex: 1, overflowY: "auto", padding: "0 10px", display: "flex", flexDirection: "column", gap: 8 },
  thumbItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: 6,
    border: "1.5px solid #35383F",
    borderRadius: 8,
    background: "#24262B",
    position: "relative",
  },
  thumbNum: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: "#8B8D97",
    width: 14,
    flexShrink: 0,
  },
  thumbImg: { width: "100%", height: 44, objectFit: "cover", borderRadius: 4, flex: 1 },
  thumbDelete: {
    position: "absolute",
    top: 3,
    right: 3,
    background: "#1C1D21cc",
    border: "none",
    borderRadius: 4,
    color: "#EDEDEE",
    padding: 3,
    display: "flex",
  },
  addBtn: {
    margin: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    background: "#2C2F36",
    border: "1px dashed #45484F",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 12.5,
    color: "#EDEDEE",
  },
  canvasArea: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "#151619" },
  emptyZone: {
    flex: 1,
    margin: 20,
    border: "2px dashed #35383F",
    borderRadius: 12,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    cursor: "pointer",
  },
  emptyTitle: { fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, marginTop: 6 },
  emptySub: { fontSize: 12.5, color: "#8B8D97" },
  canvasToolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 16px",
    borderBottom: "1px solid #2C2F36",
    flexShrink: 0,
  },
  navBtn: { background: "#24262B", border: "1px solid #35383F", borderRadius: 6, color: "#EDEDEE", padding: 5, display: "flex" },
  canvasStepLabel: { fontSize: 12.5, color: "#B7B9C2", fontFamily: "'JetBrains Mono', monospace" },
  toggleBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: "none",
    borderRadius: 6,
    padding: "7px 12px",
    fontSize: 12.5,
    fontWeight: 600,
  },
  canvasFrame: { flex: 1, overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20 },
  imgWrap: { position: "relative", display: "inline-block", maxWidth: "100%", userSelect: "none" },
  mainImg: { display: "block", maxWidth: "100%", borderRadius: 6, boxShadow: "0 4px 24px rgba(0,0,0,0.4)" },
  highlightTag: {
    position: "absolute",
    top: -10,
    left: -10,
    background: "#F4B740",
    color: "#1C1D21",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 4,
    padding: "1px 5px",
  },
  panel: { width: 320, borderLeft: "1px solid #2C2F36", background: "#1F2024", overflowY: "auto", flexShrink: 0, padding: 16 },
  panelEmpty: { color: "#8B8D97", fontSize: 13, marginTop: 30, textAlign: "center" },
  panelSection: { marginBottom: 22 },
  panelLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10.5,
    letterSpacing: 1,
    color: "#8B8D97",
    marginBottom: 8,
    display: "block",
  },
  panelLabelRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  panelHint: { fontSize: 12, color: "#6B6E78", lineHeight: 1.5 },
  hlRow: { display: "flex", alignItems: "center", gap: 6, background: "#24262B", borderRadius: 6, padding: "5px 8px" },
  hlSwatch: { width: 8, height: 8, borderRadius: 2, background: "#F4B740", flexShrink: 0 },
  hlLabel: { fontSize: 12.5, flex: 1, cursor: "text" },
  hlInput: { flex: 1, background: "#1C1D21", border: "1px solid #F4B740", borderRadius: 4, color: "#EDEDEE", fontSize: 12.5, padding: "2px 5px" },
  iconBtnSmall: { background: "transparent", border: "none", color: "#8B8D97", padding: 3, display: "flex" },
  aiBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "#2C2F36",
    border: "1px solid #45484F",
    borderRadius: 6,
    padding: "5px 9px",
    fontSize: 11.5,
    color: "#6FCF97",
    fontWeight: 600,
  },
  errorText: { fontSize: 11.5, color: "#E0637A", marginBottom: 6 },
  textarea: {
    width: "100%",
    background: "#24262B",
    border: "1px solid #35383F",
    borderRadius: 6,
    padding: 10,
    color: "#EDEDEE",
    fontSize: 12.5,
    lineHeight: 1.5,
    resize: "vertical",
  },
  captionInput: {
    width: "100%",
    background: "#24262B",
    border: "1px solid #35383F",
    borderRadius: 6,
    padding: "8px 10px",
    color: "#EDEDEE",
    fontSize: 12.5,
  },
};
