import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@xterm/xterm/css/xterm.css";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { MotionConfig } from "motion/react";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { TooltipProvider } from "./components/ui/index.js";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        <App />
      </TooltipProvider>
    </MotionConfig>
  </React.StrictMode>,
);
