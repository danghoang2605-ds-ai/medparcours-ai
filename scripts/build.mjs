// Cross-platform frontend build / dev server (no Vite needed).
//   npm run build   -> dist/ (static site)
//   npm run dev     -> http://localhost:5173, talks to backend at http://localhost:8000
import * as esbuild from "esbuild"
import { mkdirSync, copyFileSync, cpSync, writeFileSync, existsSync, readFileSync, renameSync, rmSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"

const serve = process.argv.includes("--serve")

mkdirSync("build", { recursive: true })
mkdirSync("dist", { recursive: true })
for (const f of ["App.jsx", "api.js", "localStore.js", "i18n.js", "demoData.en.js", "cloudSync.js"]) copyFileSync(f, `build/${f}`)
copyFileSync("docker_setup/mount.jsx", "build/mount.jsx")
cpSync("i18n", "build/i18n", { recursive: true })
copyFileSync("index.html", "dist/index.html")
cpSync("logos", "dist/logos", { recursive: true })
if (existsSync("ecg_samples")) cpSync("ecg_samples", "dist/ecg_samples", { recursive: true })

const apiUrl = process.env.MEDIFLOW_API_URL || (serve ? "http://localhost:8000" : "")
writeFileSync("dist/env.js", apiUrl ? `window.MEDIFLOW_API_URL = ${JSON.stringify(apiUrl)};
` : "")

// Build id shown in the app (helps confirm which version a browser is running).
const buildId = (process.env.GITHUB_SHA || "").slice(0, 7) || new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")

const options = {
  define: { __BUILD_ID__: JSON.stringify(buildId) },
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
  // Cache busting: content-hashed bundle name so a new deploy is never served from a stale cache.
  for (const f of readdirSync("dist")) if (/^mount\.[0-9a-f]{10}\.js$/.test(f)) rmSync(`dist/${f}`)
  const hash = createHash("sha256").update(readFileSync("dist/mount.js")).digest("hex").slice(0, 10)
  renameSync("dist/mount.js", `dist/mount.${hash}.js`)
  const html = readFileSync("dist/index.html", "utf8").replace("./mount.js", `./mount.${hash}.js`)
  writeFileSync("dist/index.html", html)
  console.log(`Built dist/ (mount.${hash}.js, build ${buildId})`)
}
