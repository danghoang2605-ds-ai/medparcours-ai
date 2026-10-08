// Cross-platform frontend build / dev server (no Vite needed).
//   npm run build   -> dist/ (static site)
//   npm run dev     -> http://localhost:5173, talks to backend at http://localhost:8000
import * as esbuild from "esbuild"
import { mkdirSync, copyFileSync, cpSync, writeFileSync, existsSync } from "node:fs"

const serve = process.argv.includes("--serve")

mkdirSync("build", { recursive: true })
mkdirSync("dist", { recursive: true })
for (const f of ["App.jsx", "api.js", "localStore.js", "i18n.js", "demoData.en.js"]) copyFileSync(f, `build/${f}`)
copyFileSync("docker_setup/mount.jsx", "build/mount.jsx")
cpSync("i18n", "build/i18n", { recursive: true })
copyFileSync("index.html", "dist/index.html")
cpSync("logos", "dist/logos", { recursive: true })
if (existsSync("ecg_samples")) cpSync("ecg_samples", "dist/ecg_samples", { recursive: true })

const apiUrl = process.env.MEDIFLOW_API_URL || (serve ? "http://localhost:8000" : "")
writeFileSync("dist/env.js", apiUrl ? `window.MEDIFLOW_API_URL = ${JSON.stringify(apiUrl)};
` : "")

const options = {
  entryPoints: ["build/mount.jsx"],
  bundle: true,
  loader: { ".jsx": "jsx" },
  jsx: "automatic",
  format: "esm",
  outfile: "dist/mount.js",
  minify: !serve,
}

if (serve) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  const { port } = await ctx.serve({ servedir: "dist", port: 5173 })
  console.log(`Dev server: http://localhost:${port}  (backend: ${apiUrl})`)
} else {
  await esbuild.build(options)
  console.log("Built dist/")
}
