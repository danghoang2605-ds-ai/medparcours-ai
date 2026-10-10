---
title: MedParcours AI API
emoji: 🫀
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# MedParcours AI API

Stateless FastAPI backend for [MedParcours AI](https://github.com/danghoang2605-ds-ai/medparcours-ai).
No login, no database: patient records stay in the user's browser.

- Health: `/health`
- Interactive docs: `/docs`

Required secret: `ANTHROPIC_API_KEY`. Optional cloud sync: `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (secrets). Optional variables: `RATE_LIMIT_REQUESTS` (default 30), `RATE_LIMIT_WINDOW_S` (default 600).
