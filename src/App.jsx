import React, { useState, useEffect, useRef } from "react";
import GuidedBuilder from "./GuidedBuilder.jsx";
import ProcessStudio from "./ProcessStudio.jsx";
import ArchitectStudio from "./ArchitectStudio.jsx";
import ProcessVideoBuilder from "./process-video-builder.jsx";
import { 
  KeyRound, User, Lock, LogOut, ClipboardList, Shield, Info, 
  FolderHeart, Search, Trash2, Play, Save, RefreshCw, FileText, Check, Database
} from "lucide-react";

const T = {
  rail: "#0F1830", railLine: "#27324E", railSoft: "#172238",
  paper: "#FBFAF7", panel: "#FFFFFF", line: "#E6E1D6",
  ink: "#15213B", inkSoft: "#3A465F", amber: "#D97706", amberSoft: "#FBE7C6",
  textDim: "#737B8E", inv: "#EAEEF8", invDim: "#8B97B6",
};

const MODES = [
  { k: "build", label: "Builder" },
  { k: "process", label: "Process Studio" },
  { k: "architect", label: "Architect" },
];

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("processflow_current_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const initial = path.includes("/process") ? "process" : path.includes("/architect") ? "architect" : "build";
  const [mode, setMode] = useState(initial);

  // Login Form States
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Login History State
  const [loginHistory, setLoginHistory] = useState([]);

  // Child handlers registry
  const childHandlers = useRef({
    build: null,
    process: null,
    architect: null,
  });

  // Track active loaded diagram details
  const [activeDiagId, setActiveDiagId] = useState(null);
  const [activeDiagName, setActiveDiagName] = useState("");
  const [activeDiagOwner, setActiveDiagOwner] = useState(null);

  // Diagrams dashboard state
  const [diagrams, setDiagrams] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [targetUserFilter, setTargetUserFilter] = useState("all");
  const [diagSearch, setDiagSearch] = useState("");
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState("");
  const [saveStatus, setSaveStatus] = useState(""); // "" | "saving" | "success" | "error"

  const registerHandlers = (modeKey, handlers) => {
    childHandlers.current[modeKey] = handlers;
  };

  const getBaseUrl = () => {
    return window.location.pathname.startsWith("/diagram/") ? "/diagram/" : "/";
  };

  useEffect(() => {
    if (user && user.role === "appadmin") {
      const hist = localStorage.getItem("processflow_login_history");
      setLoginHistory(hist ? JSON.parse(hist) : []);
    }
  }, [user]);

  // Guardrail to prevent appuser from accessing admin-only workspace modes
  useEffect(() => {
    if (user && user.role !== "appadmin" && (mode === "process" || mode === "architect" || mode === "history" || mode === "video")) {
      setMode("build");
    }
  }, [user, mode]);

  // Fetch Diagrams list from backend
  const fetchDiagrams = async () => {
    if (!user) return;
    setDiagLoading(true);
    setDiagError("");
    try {
      const base = getBaseUrl();
      const target = user.role === "appadmin" ? targetUserFilter : user.username;
      const res = await fetch(
        `${base}api/flows?username=${user.username}&role=${user.role}&targetUser=${target}&t=${Date.now()}`
      );
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await res.json();
      setDiagrams(data.diagrams || []);
      
      // If admin, also fetch the list of usernames that have folders
      if (user.role === "appadmin") {
        const uRes = await fetch(`${base}api/users?t=${Date.now()}`);
        if (uRes.ok) {
          const uData = await uRes.json();
          setUsersList(uData.users || []);
        }
      }
    } catch (err) {
      setDiagError("Failed to connect to the backend server API. Is server.js running?");
    } finally {
      setDiagLoading(false);
    }
  };

  // Fetch diagrams list whenever dashboard becomes active, or admin filter changes
  useEffect(() => {
    if (user && mode === "dashboard") {
      fetchDiagrams();
    }
  }, [user, mode, targetUserFilter]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setLoading(true);

    try {
      const base = getBaseUrl();
      const res = await fetch(`${base}credentials.json?t=${Date.now()}`);
      if (!res.ok) {
        throw new Error("Could not load credentials configuration file.");
      }
      const data = await res.json();
      const inputHash = await sha256(passwordInput);

      const foundUser = data.users.find(
        (u) => u.username.toLowerCase() === usernameInput.trim().toLowerCase() && u.passwordHash === inputHash
      );

      if (foundUser) {
        const loggedUser = { username: foundUser.username, role: foundUser.role };
        
        setUser(loggedUser);
        localStorage.setItem("processflow_current_user", JSON.stringify(loggedUser));

        const hist = localStorage.getItem("processflow_login_history");
        const currentHist = hist ? JSON.parse(hist) : [];
        const newRecord = {
          username: foundUser.username,
          role: foundUser.role,
          timestamp: new Date().toISOString(),
        };
        currentHist.unshift(newRecord);
        localStorage.setItem("processflow_login_history", JSON.stringify(currentHist));
        setLoginHistory(currentHist);

        setUsernameInput("");
        setPasswordInput("");
        setMode("build");
      } else {
        setErrorMsg("Invalid username or password.");
      }
    } catch (err) {
      setErrorMsg(err.message || "Failed to authenticate.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("processflow_current_user");
    setMode("build");
    setActiveDiagId(null);
    setActiveDiagName("");
    setActiveDiagOwner(null);
  };

  const clearHistory = () => {
    localStorage.setItem("processflow_login_history", JSON.stringify([]));
    setLoginHistory([]);
  };

  // Save the current active workspace's diagram
  const saveCurrentWork = async () => {
    const handler = childHandlers.current[mode];
    if (!handler) return;

    const data = handler.getSaveData();
    // Validate if there is anything to save
    if (!data.graph && mode !== "build") {
      alert("There is no active diagram. Please generate or import a diagram first.");
      return;
    }

    let defaultName = activeDiagName || data.title || "";
    if (defaultName === "Scenario Flow" || defaultName === "Cloud Architecture" || defaultName === "New Process Flow") {
      defaultName = "";
    }

    const diagName = prompt("Enter a name for this diagram:", defaultName);
    if (diagName === null) return; // cancelled
    if (!diagName.trim()) {
      alert("Diagram name cannot be empty.");
      return;
    }

    setSaveStatus("saving");
    try {
      const base = getBaseUrl();
      const id = activeDiagId || `diag_${Date.now().toString(36)}`;
      const owner = activeDiagOwner || user.username;

      const body = {
        username: owner,
        id,
        name: diagName.trim(),
        type: mode,
        payload: data,
      };

      const res = await fetch(`${base}api/flows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const result = await res.json();

      if (result.success) {
        setActiveDiagId(id);
        setActiveDiagName(diagName.trim());
        setActiveDiagOwner(owner);
        setSaveStatus("success");
        setTimeout(() => setSaveStatus(""), 2000);
      } else {
        throw new Error("Save was not acknowledged");
      }
    } catch (err) {
      alert(`Failed to save diagram: ${err.message}`);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(""), 2000);
    }
  };

  // Load a diagram into the active workspace
  const loadDiagram = async (diag) => {
    setDiagLoading(true);
    try {
      const base = getBaseUrl();
      const res = await fetch(
        `${base}api/flows/get?username=${diag.username}&id=${diag.id}&t=${Date.now()}`
      );
      if (!res.ok) throw new Error("Could not load diagram details.");
      const data = await res.json();

      // Update workspace mode first if role allows it
      if (user.role !== "appadmin" && (data.type === "process" || data.type === "architect")) {
        alert("Access Denied: You do not have permission to access Process Studio or Architect workspaces.");
        setDiagLoading(false);
        return;
      }
      setMode(data.type);

      // Need to wait slightly for components to register handlers if swapping modes
      setTimeout(() => {
        const handler = childHandlers.current[data.type];
        if (handler) {
          handler.loadData(data.payload);
          setActiveDiagId(data.id);
          setActiveDiagName(data.name);
          setActiveDiagOwner(diag.username);
        } else {
          alert("Editor error: Handler registry failed. Please try loading again.");
        }
        setDiagLoading(false);
      }, 150);

    } catch (err) {
      alert(`Error loading diagram: ${err.message}`);
      setDiagLoading(false);
    }
  };

  // Delete a diagram from disk
  const deleteDiagram = async (e, diag) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete "${diag.name}"?`)) return;

    try {
      const base = getBaseUrl();
      const res = await fetch(
        `${base}api/flows?username=${diag.username}&id=${diag.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Could not delete from backend.");
      
      // If we deleted the active diagram, clear the active info
      if (diag.id === activeDiagId) {
        setActiveDiagId(null);
        setActiveDiagName("");
        setActiveDiagOwner(null);
      }

      fetchDiagrams();
    } catch (err) {
      alert(`Error deleting diagram: ${err.message}`);
    }
  };

  // If not logged in, render the premium Login Screen
  if (!user) {
    return (
      <div style={{
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "linear-gradient(135deg, #090d16 0%, #15223c 100%)",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
      }}>
        <div style={{
          width: 380,
          background: "rgba(23, 34, 56, 0.9)",
          border: "1px solid #27324E",
          borderRadius: 16,
          boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
          backdropFilter: "blur(8px)",
          padding: "32px 28px",
          textAlign: "center"
        }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 50,
            height: 50,
            borderRadius: 12,
            background: "#D97706",
            marginBottom: 16,
            color: "#1a1206"
          }}>
            <KeyRound size={26} />
          </div>
          
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#EAEEF8", margin: "0 0 6px 0" }}>ProcessFlow Studio</h2>
          <p style={{ fontSize: 13, color: "#8B97B6", margin: "0 0 24px 0" }}>Sign in to access your diagram designer</p>

          {errorMsg && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: "#ff8b80",
              background: "rgba(100, 20, 20, 0.3)",
              border: "1px solid #7a2320",
              borderRadius: 8,
              padding: "10px 12px",
              marginBottom: 16,
              textAlign: "left"
            }}>
              <Info size={16} style={{ flexShrink: 0 }} />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ textAlign: "left" }}>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "#8B97B6", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>Username</label>
              <div style={{ position: "relative" }}>
                <User size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#8B97B6" }} />
                <input
                  type="text"
                  required
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="appuser or appadmin"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    fontSize: 13.5,
                    color: "#EAEEF8",
                    background: "#0F1830",
                    border: "1px solid #27324E",
                    borderRadius: 8,
                    padding: "10px 12px 10px 38px",
                    outline: "none"
                  }}
                />
              </div>
            </div>

            <div style={{ textAlign: "left" }}>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "#8B97B6", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>Password</label>
              <div style={{ position: "relative" }}>
                <Lock size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#8B97B6" }} />
                <input
                  type="password"
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    fontSize: 13.5,
                    color: "#EAEEF8",
                    background: "#0F1830",
                    border: "1px solid #27324E",
                    borderRadius: 8,
                    padding: "10px 12px 10px 38px",
                    outline: "none"
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                fontSize: 14,
                fontWeight: 700,
                color: "#1a1206",
                background: "#D97706",
                border: "none",
                borderRadius: 8,
                padding: "11px 14px",
                cursor: loading ? "default" : "pointer",
                marginTop: 8,
                transition: "opacity 0.2s"
              }}
            >
              {loading ? "Verifying..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Active Modes List including Login History and Diagrams Dashboard
  const visibleModes = [
    { k: "dashboard", label: "My Diagrams" },
    { k: "build", label: "Builder" }
  ];
  if (user.role === "appadmin") {
    visibleModes.push({ k: "process", label: "Process Studio" });
    visibleModes.push({ k: "architect", label: "Architect" });
    visibleModes.push({ k: "video", label: "Video Builder" });
    visibleModes.push({ k: "history", label: "Login Logs" });
  }

  // Filter diagrams list based on search term
  const filteredDiagrams = diagrams.filter((d) => 
    d.name.toLowerCase().includes(diagSearch.toLowerCase()) ||
    d.type.toLowerCase().includes(diagSearch.toLowerCase())
  );

  return (
    <div style={{ height: "100vh", position: "relative", fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      {/* Workspace Pages */}
      <div key="build" style={{ display: mode === "build" ? "flex" : "none", flexDirection: "column", height: "100%", paddingTop: 52, boxSizing: "border-box" }}>
        <GuidedBuilder onRegister={(handlers) => registerHandlers("build", handlers)} />
      </div>
      <div key="process" style={{ display: mode === "process" ? "flex" : "none", flexDirection: "column", height: "100%", paddingTop: 52, boxSizing: "border-box" }}>
        <ProcessStudio onRegister={(handlers) => registerHandlers("process", handlers)} />
      </div>
      <div key="architect" style={{ display: mode === "architect" ? "flex" : "none", flexDirection: "column", height: "100%", paddingTop: 52, boxSizing: "border-box" }}>
        <ArchitectStudio onRegister={(handlers) => registerHandlers("architect", handlers)} />
      </div>
      <div key="video" style={{ display: mode === "video" ? "flex" : "none", flexDirection: "column", height: "100%", paddingTop: 52, boxSizing: "border-box" }}>
        <ProcessVideoBuilder />
      </div>

      {/* Diagrams Dashboard View */}
      {mode === "dashboard" && (
        <div key="dashboard" style={{ height: "100%", background: T.paper, overflowY: "auto", padding: "60px 24px 40px" }}>
          <div style={{ maxWidth: 960, margin: "0 auto", background: "#FFFFFF", border: "1px solid #E6E1D6", borderRadius: 12, padding: "24px 30px" }}>
            <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #E6E1D6", paddingBottom: 16, marginBottom: 20, gap: 12 }}>
              <FolderHeart size={24} color={T.amber} />
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: T.ink, margin: 0 }}>My Diagrams Storage</h2>
                <p style={{ fontSize: 12.5, color: T.textDim, margin: 0 }}>Retrieve and manage your flows saved directly on local disk</p>
              </div>
              <button onClick={fetchDiagrams} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: T.inkSoft, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>
                <RefreshCw size={12} /> Refresh
              </button>
            </div>

            {/* Dashboard Filters Toolbar */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 260 }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.textDim }} />
                <input
                  type="text"
                  placeholder="Search diagrams by name or type..."
                  value={diagSearch}
                  onChange={(e) => setDiagSearch(e.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    fontSize: 13,
                    color: T.ink,
                    background: T.paper,
                    border: `1px solid ${T.line}`,
                    borderRadius: 8,
                    padding: "8px 10px 8px 32px",
                    outline: "none"
                  }}
                />
              </div>

              {/* Admin Folders Dropdown */}
              {user.role === "appadmin" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Database size={15} color={T.textDim} />
                  <span style={{ fontSize: 12, fontWeight: 650, color: T.textDim }}>User Data Folders:</span>
                  <select
                    value={targetUserFilter}
                    onChange={(e) => setTargetUserFilter(e.target.value)}
                    style={{
                      fontSize: 12.5,
                      color: T.ink,
                      background: "#fff",
                      border: `1px solid ${T.line}`,
                      borderRadius: 8,
                      padding: "8px 12px",
                      cursor: "pointer"
                    }}
                  >
                    <option value="all">Show All Folders (*)</option>
                    {usersList.map((uName) => (
                      <option key={uName} value={uName}>{uName}'s folder</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Error Message */}
            {diagError && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 20, fontSize: 13, color: "#ffd2cc", background: "#3a1d1d", border: "1px solid #5a2a2a", borderRadius: 9, padding: "10px 12px" }}>
                <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{diagError}</span>
              </div>
            )}

            {/* Diagrams list */}
            {diagLoading ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: T.textDim }}>
                <RefreshCw size={24} className="ps-spin" style={{ opacity: 0.5, marginBottom: 8 }} />
                <div style={{ fontSize: 13 }}>Connecting to disk storage...</div>
              </div>
            ) : filteredDiagrams.length === 0 ? (
              <div style={{ padding: "50px 0", textAlign: "center", color: T.textDim, border: `1px dashed ${T.line}`, borderRadius: 8 }}>
                <FolderHeart size={32} style={{ opacity: 0.25, marginBottom: 10 }} />
                <div style={{ fontSize: 14, fontWeight: 500 }}>No diagrams found in this directory.</div>
                <p style={{ fontSize: 12, color: T.textDim, margin: "4px 0 0 0" }}>Go to Builder, Process Studio, or Architect and click "Save Work" to save one.</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
                {filteredDiagrams.map((diag) => {
                  const isCur = diag.id === activeDiagId;
                  const typeLabel = diag.type === "build" ? "Builder Flow" : diag.type === "process" ? "Process Scenario" : "AWS Architect";
                  const typeColor = diag.type === "build" ? "#7030a0" : diag.type === "process" ? "#D97706" : "#0E7C7B";
                  const typeBg = diag.type === "build" ? "#efe1f5" : diag.type === "process" ? "#FBE7C6" : "#E2F2F2";
                  
                  return (
                    <div
                      key={diag.id}
                      onClick={() => loadDiagram(diag)}
                      style={{
                        background: "#fff",
                        border: `1.5px solid ${isCur ? T.amber : T.line}`,
                        borderRadius: 10,
                        padding: "16px 18px",
                        cursor: "pointer",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                        transition: "transform 0.15s, box-shadow 0.15s",
                        position: "relative"
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-2px)";
                        e.currentTarget.style.boxShadow = "0 6px 12px rgba(0,0,0,0.08)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "none";
                        e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,0,0,0.03)";
                      }}
                    >
                      <div style={{ display: "flex", justifyItems: "center", gap: 6, marginBottom: 10 }}>
                        <span style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: typeColor,
                          background: typeBg,
                          padding: "2px 6px",
                          borderRadius: 4,
                          textTransform: "uppercase"
                        }}>
                          {typeLabel}
                        </span>
                        {isCur && (
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: "#1e7e34", background: "#d4edda", padding: "2px 6px", borderRadius: 4, textTransform: "uppercase" }}>
                            Loaded
                          </span>
                        )}
                      </div>

                      <h3 style={{ fontSize: 14.5, fontWeight: 700, color: T.ink, margin: "0 0 4px 0", wordBreak: "break-word" }}>{diag.name}</h3>
                      <div style={{ fontSize: 11.5, color: T.textDim, marginBottom: 10 }}>
                        Folder: <strong style={{ color: T.inkSoft }}>{diag.username}</strong>
                      </div>
                      
                      <div style={{ display: "flex", alignItems: "center", justifyItems: "center", borderTop: `1px solid ${T.paper}`, paddingTop: 10, marginTop: 10 }}>
                        <span style={{ fontSize: 11, color: T.textDim, fontFamily: "monospace", flex: 1 }}>
                          {new Date(diag.updatedAt).toLocaleDateString()} {new Date(diag.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button
                          onClick={(e) => deleteDiagram(e, diag)}
                          title="Delete Diagram"
                          style={{
                            border: "none",
                            background: "transparent",
                            color: T.textDim,
                            cursor: "pointer",
                            padding: 4,
                            borderRadius: 4
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#b85450")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = T.textDim)}
                        >
                          <Trash2 size={13.5} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Admin Login logs View */}
      {user.role === "appadmin" && mode === "history" && (
        <div key="history" style={{ display: "block", height: "100%", background: T.paper, overflowY: "auto", padding: "60px 24px 40px" }}>
          <div style={{ maxWidth: 800, margin: "0 auto", background: "#FFFFFF", border: "1px solid #E6E1D6", borderRadius: 12, padding: "24px 30px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #E6E1D6", paddingBottom: 16, marginBottom: 20 }}>
              <ClipboardList size={22} color={T.amber} />
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: 17.5, fontWeight: 700, color: T.ink, margin: 0 }}>Authentication Logs</h2>
                <p style={{ fontSize: 12, color: T.textDim, margin: 0 }}>Showing login history for all local POC accounts</p>
              </div>
              {loginHistory.length > 0 && (
                <button
                  onClick={clearHistory}
                  style={{
                    fontSize: 12,
                    color: "#b85450",
                    background: "#f8d7d5",
                    border: "1px solid #b85450",
                    borderRadius: 6,
                    padding: "4px 8px",
                    cursor: "pointer"
                  }}
                >
                  Clear History
                </button>
              )}
            </div>

            {loginHistory.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: T.textDim }}>
                <Shield size={26} style={{ opacity: 0.3, marginBottom: 8 }} />
                <div style={{ fontSize: 13.5 }}>No login history matches.</div>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #E6E1D6" }}>
                      <th style={{ padding: "8px 12px", color: T.textDim, fontWeight: 600 }}>User</th>
                      <th style={{ padding: "8px 12px", color: T.textDim, fontWeight: 600 }}>Role</th>
                      <th style={{ padding: "8px 12px", color: T.textDim, fontWeight: 600 }}>Login Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loginHistory.map((log, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #F1EFE8" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 600, color: T.ink }}>{log.username}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            color: log.role === "appadmin" ? "#4a1d63" : "#0a4a63",
                            background: log.role === "appadmin" ? "#efe1f5" : "#d6ecf7",
                            padding: "2px 6px",
                            borderRadius: 4,
                            textTransform: "uppercase"
                          }}>
                            {log.role}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", color: T.inkSoft, fontFamily: "monospace" }}>
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Mode Switcher & Logout Container */}
      <div style={{
        position: "fixed",
        top: 9,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "rgba(15,24,48,.92)",
        border: "1px solid #27324E",
        borderRadius: 11,
        padding: "3px 8px 3px 12px",
        boxShadow: "0 4px 16px rgba(0,0,0,.28)",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
      }}>
        {/* User Badge Info */}
        <span style={{ fontSize: 11.5, color: "#8B97B6", marginRight: 8, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <User size={12} color="#D97706" />
          <span style={{ fontWeight: 700, color: "#EAEEF8" }}>{user.username}</span>
          <span style={{ fontSize: 10, color: T.invDim, background: T.railSoft, padding: "1px 5px", borderRadius: 4 }}>{user.role}</span>
        </span>

        {/* View Switchers */}
        {visibleModes.map((m) => {
          const on = mode === m.k;
          return (
            <button
              key={m.k}
              onClick={() => setMode(m.k)}
              style={{
                fontSize: 12,
                fontWeight: on ? 700 : 500,
                color: on ? "#1a1206" : "#8B97B6",
                background: on ? "#D97706" : "transparent",
                border: "none",
                borderRadius: 8,
                padding: "5px 12px",
                cursor: "pointer"
              }}
            >
              {m.label}
            </button>
          );
        })}

        {/* Action Button: Save Work (hide on logs & dashboard views) */}
        {mode !== "history" && mode !== "dashboard" && mode !== "video" && (
          <button
            onClick={saveCurrentWork}
            disabled={saveStatus === "saving"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              fontWeight: 700,
              color: "#fff",
              background: saveStatus === "success" ? "#1e7e34" : saveStatus === "error" ? "#b85450" : "#0E7C7B",
              border: "none",
              borderRadius: 8,
              padding: "5px 12px",
              cursor: saveStatus === "saving" ? "default" : "pointer",
              marginLeft: 4,
              transition: "background 0.2s"
            }}
          >
            {saveStatus === "saving" ? (
              <RefreshCw size={12} className="ps-spin" />
            ) : saveStatus === "success" ? (
              <Check size={12} />
            ) : (
              <Save size={12} />
            )}
            {saveStatus === "saving" 
              ? "Saving" 
              : saveStatus === "success" 
              ? "Saved!" 
              : saveStatus === "error" 
              ? "Failed" 
              : activeDiagName 
              ? `Save: ${activeDiagName}` 
              : "Save Work"}
          </button>
        )}

        {/* Logout Button */}
        <button
          onClick={handleLogout}
          title="Sign Out"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: 6,
            background: "transparent",
            border: "none",
            color: "#8B97B6",
            cursor: "pointer",
            marginLeft: 4,
            transition: "color 0.2s"
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#ff8b80")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#8B97B6")}
        >
          <LogOut size={14} />
        </button>
      </div>
      
      {/* Vite spin styling override for spinner items */}
      <style>{`
        .ps-spin { animation: ps-rot .9s linear infinite; }
        @keyframes ps-rot { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
