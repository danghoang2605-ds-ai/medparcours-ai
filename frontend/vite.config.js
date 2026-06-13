import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  base: '/mediflow-ai/', // Khai báo base path trùng với tên repo GitHub của bạn
  server: { port: 5173 },
})