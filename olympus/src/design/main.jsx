import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@xterm/xterm/css/xterm.css";
import "../styles.css";
import { MotionConfig } from "motion/react";
import React from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "../components/ui/index.js";
import DesignSystem from "./DesignSystem.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        <DesignSystem />
      </TooltipProvider>
    </MotionConfig>
  </React.StrictMode>,
);
