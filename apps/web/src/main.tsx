import "@fontsource/carlito/400.css";
import "@fontsource/carlito/700.css";
import "@fontsource/jetbrains-mono/400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/uxv2.css";
import "./styles/v4.css";
import "./styles/v7.css";
import "./insights/insights.css";
import "./ops/ops.css";
import { applyTheme, readTheme } from "./lib/theme";
import { AppProvider } from "./state";

applyTheme(readTheme());

const el = document.getElementById("root");
if (!el) throw new Error("Missing #root");
createRoot(el).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
