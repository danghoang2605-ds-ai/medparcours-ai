#!/usr/bin/env bash
# run_tests.sh -- Run the full MedParcours AI test suite.
# Usage: bash run_tests.sh   (or: chmod +x run_tests.sh && ./run_tests.sh)

set -uo pipefail

CYAN='\033[0;36m'
GREEN='\033[1;32m'
RED='\033[1;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${CYAN}Running MedParcours AI test suite...${NC}"
echo ""

if ! command -v pytest >/dev/null 2>&1 && ! python3 -m pytest --version >/dev/null 2>&1; then
    echo -e "${YELLOW}pytest not found. Install with:${NC}"
    echo -e "${YELLOW}  pip install -r requirements-dev.txt${NC}"
    exit 1
fi

echo -e "${CYAN}> pytest -v${NC}"
echo ""
python3 -m pytest -v
EXIT_CODE=$?

echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
    echo -e "${GREEN}======================================================${NC}"
    echo -e "${GREEN}  ALL TESTS PASSED -- READY TO DEPLOY${NC}"
    echo -e "${GREEN}======================================================${NC}"
    exit 0
else
    echo -e "${RED}======================================================${NC}"
    echo -e "${RED}  TESTS FAILED -- REVIEW BEFORE DEPLOYING${NC}"
    echo -e "${RED}======================================================${NC}"
    exit 1
fi
