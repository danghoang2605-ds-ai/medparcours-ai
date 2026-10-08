// Entry point for esbuild builds (GitHub Pages and Docker).
// App.jsx only exports the component; this file renders it.
import { createRoot } from "react-dom/client"
import App from "./App.jsx"
import { startI18n } from "./i18n"

// Attach the translator before the first render so English shows without a flash.
startI18n()

createRoot(document.getElementById("root")).render(<App />)
