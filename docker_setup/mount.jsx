// Entry point cho bản Docker — App.jsx chỉ export component, không tự render.
// File này tương đương main.jsx của Vite cũ, viết riêng cho luồng esbuild.
import { createRoot } from "react-dom/client"
import App from "./App.jsx"

createRoot(document.getElementById("root")).render(<App />)
