import React from "react";
import ReactDOM from "react-dom/client";
import GuidedBuilder from "./GuidedBuilder.jsx";
import ProcessStudio from "./ProcessStudio.jsx";
import ArchitectStudio from "./ArchitectStudio.jsx";

const path = window.location.pathname;
const App = path.includes("/process")   ? ProcessStudio
          : path.includes("/architect") ? ArchitectStudio
          : GuidedBuilder;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
