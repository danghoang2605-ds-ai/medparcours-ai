#!/usr/bin/env bash
# run_tests.sh — Script tự động hóa chạy toàn bộ test suite MedParcours AI.
# Dùng cho Ban Giám khảo chấm code / dev tự kiểm tra trước khi deploy.
#
# Cách chạy: bash run_tests.sh   (hoặc: chmod +x run_tests.sh && ./run_tests.sh)

set -uo pipefail

# ─── Mã màu ANSI ────────────────────────────────────────────────────────────
CYAN='\033[0;36m'
GREEN='\033[1;32m'
RED='\033[1;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color / reset

# ─── Bước 1: Thông báo khởi động ───────────────────────────────────────────
echo -e "${CYAN}🚀 Đang khởi động bộ kiểm thử tự động MedParcours AI...${NC}"
echo ""

# ─── Bước 2: Kiểm tra pytest đã cài đặt chưa ───────────────────────────────
if ! command -v pytest >/dev/null 2>&1 && ! python3 -m pytest --version >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Chưa tìm thấy pytest trong môi trường hiện tại.${NC}"
    echo -e "${YELLOW}   Cài đặt bằng lệnh:${NC}"
    echo -e "${YELLOW}   pip install -r requirements-dev.txt${NC}"
    echo -e "${YELLOW}   (hoặc tối thiểu: pip install pytest)${NC}"
    exit 1
fi

# ─── Bước 3: Chạy toàn bộ test suite ────────────────────────────────────────
echo -e "${CYAN}▶ Đang chạy: pytest -v${NC}"
echo ""
python3 -m pytest -v
EXIT_CODE=$?

# ─── Bước 4-6: Kiểm tra mã trạng thái và in kết luận ───────────────────────
echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
    echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ HỆ THỐNG ỔN ĐỊNH - SẴN SÀNG DEPLOY CHÍNH THỨC${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
    exit 0
else
    echo -e "${RED}════════════════════════════════════════════════════════${NC}"
    echo -e "${RED}❌ LỖI HỆ THỐNG - CẦN RÀ SOÁT LẠI MÃ NGUỒN${NC}"
    echo -e "${RED}════════════════════════════════════════════════════════${NC}"
    exit 1
fi
