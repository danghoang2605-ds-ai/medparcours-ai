# frontend/Dockerfile
# Frontend MedParcours AI — Build chuẩn bằng Vite + React, phục vụ qua Nginx

# ─── Giai đoạn 1: Build React/Vite ─────────────────────────────────────
FROM node:20-slim AS build

WORKDIR /app

# Copy package.json để cài dependencies trước
COPY package*.json ./
RUN npm install

# Copy toàn bộ mã nguồn frontend (bao gồm cả src, public/logos...)
COPY . .

# Build project bằng Vite (mặc định xuất ra thư mục dist)
RUN npm run build

# ─── Giai đoạn 2: Phục vụ tĩnh bằng Nginx ──────────────────────────────
FROM nginx:alpine

# Copy file build từ thư mục dist của Vite sang Nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Cấu hình fallback cho React Router (Tránh lỗi 404 khi F5 trang)
RUN echo "server { listen 80; location / { root /usr/share/nginx/html; try_files \$uri /index.html; } }" > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
