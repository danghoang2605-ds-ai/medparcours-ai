// Entry point for esbuild builds (GitHub Pages and Docker).
// App.jsx only exports the component; this file renders it.
import { createRoot } from "react-dom/client"
import App from "./App.jsx"
import { startI18n } from "./i18n"

// Attach the translator before the first render so English shows without a flash.
startI18n()

const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev"
document.documentElement.dataset.build = BUILD_ID
console.info(`MedParcours AI build ${BUILD_ID}`)

createRoot(document.getElementById("root")).render(<App />)
