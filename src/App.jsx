import React, { useState } from "react";
import GuidedBuilder from "./GuidedBuilder.jsx";
import ProcessStudio from "./ProcessStudio.jsx";
import ArchitectStudio from "./ArchitectStudio.jsx";

/* Top-level shell: a floating switcher to swap between the three tools.
   All three stay mounted (hidden via display) so in-progress work is kept
   when you swap back. */
const MODES = [
  { k: "build", label: "Builder" },
  { k: "process", label: "Process Studio" },
  { k: "architect", label: "Architect" },
];

export default function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const initial = path.includes("/process") ? "process" : path.includes("/architect") ? "architect" : "build";
  const [mode, setMode] = useState(initial);

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      {MODES.map((m) => (
        <div key={m.k} style={{ display: mode === m.k ? "block" : "none", height: "100%" }}>
          {m.k === "build" ? <GuidedBuilder /> : m.k === "process" ? <ProcessStudio /> : <ArchitectStudio />}
        </div>
      ))}

      <div style={{ position: "fixed", top: 9, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
        display: "inline-flex", gap: 2, background: "rgba(15,24,48,.92)", border: "1px solid #27324E",
        borderRadius: 11, padding: 3, boxShadow: "0 4px 16px rgba(0,0,0,.28)",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
        {MODES.map((m) => {
          const on = mode === m.k;
          return (
            <button key={m.k} onClick={() => setMode(m.k)}
              style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? "#1a1206" : "#8B97B6",
                background: on ? "#D97706" : "transparent", border: "none", borderRadius: 8, padding: "5px 13px", cursor: "pointer" }}>
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
