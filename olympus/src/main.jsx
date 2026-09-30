import React from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@xterm/xterm/css/xterm.css";
import "@xyflow/react/dist/style.css";
import App from "./App.jsx";
import { olympusTheme } from "./theme.js";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MantineProvider theme={olympusTheme} defaultColorScheme="dark">
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
