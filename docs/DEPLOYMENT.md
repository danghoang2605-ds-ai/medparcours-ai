# Deployment guide

MedParcours AI has two parts that are hosted separately:

| Part | What it is | Where it runs | Secrets it needs |
|---|---|---|---|
| Frontend | Static site (React, built by `scripts/build.mjs`) | GitHub Pages | none |
| Backend | FastAPI API (`main.py`, `cde/`, ...) | Hugging Face Space (Docker) | `ANTHROPIC_API_KEY` |

The frontend never holds an API key. The Anthropic key lives only in the Space's secrets.

## 1. Backend on Hugging Face

1. Create (or reuse) a Space: huggingface.co → New Space → SDK **Docker** → Blank. Name it `mediflow-ai` (or change `SpaceUrl` in the sync script and `DEFAULT_API_URL` in `api.js`).
2. Space → **Settings → Variables and secrets**:
   - **New secret** `ANTHROPIC_API_KEY` = your key from console.anthropic.com
   - (optional, cloud sync) **New secret** `TURSO_DATABASE_URL` = `libsql://<your-db>.turso.io`
   - (optional, cloud sync) **New secret** `TURSO_AUTH_TOKEN` = a database token from the Turso dashboard
   - (optional) **New variable** `RATE_LIMIT_REQUESTS` = `30`, `RATE_LIMIT_WINDOW_S` = `600`
   - Delete any old `SUPABASE_*`, `VNPT_*`, `TURSO_*` entries; they are no longer used.
3. Create a Hugging Face **access token** with *write* permission (Settings → Access Tokens).
4. From the repo root on your machine:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\sync-hf-space.ps1
   ```
   When git asks for credentials: username = your HF username, password = the token.
   The script copies the backend code plus `deploy/huggingface/Dockerfile` and `README.md` into the Space and pushes.
5. Watch the Space's **Logs** tab until it says the app is running, then open
   `https://<user>-<space>.hf.space/health` (should return `{"status": "ok", ...}`) and `/docs`.

### Cloud sync (optional)

Without Turso, records stay in each browser. With the two Turso secrets set, the Record history
page shows **Cloud sync: On** and a private *sync key*. Paste that key on another device to open the
same records. Records are stored in a table `mp_records`, partitioned by a SHA-256 hash of the sync
key; the key itself is never stored. Older tables in the same database (for example `patients` from
earlier versions) are left untouched.

To get the Turso values: turso.tech dashboard → your database → copy the URL (`libsql://...`) →
**Generate token** (copy it right away; it is shown once).

## 2. Frontend on GitHub Pages

1. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Repo → **Settings → Secrets and variables → Actions**:
   - Delete old secrets `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (no longer used).
   - (optional) **Variables** tab → `MEDIFLOW_API_URL` = your Space URL, only if it differs from the default in `api.js`.
3. Push to `main`. The **Deploy frontend to GitHub Pages** workflow builds and publishes the site; **Tests** runs the backend and frontend test suites.
4. Open `https://<user>.github.io/<repo>/` in a private window. Hover the **EN | VI** switch: the tooltip shows the build id (first 7 characters of the commit).

## 3. Local development

```bash
cp .env.example .env              # ANTHROPIC_API_KEY=...
pip install -r requirements.txt && uvicorn main:app --reload --port 8000
npm install && npm run dev        # http://localhost:5173 -> talks to localhost:8000
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Login screen or Vietnamese-only UI | Old cached build, or you opened the Space URL instead of the Pages URL | Use the Pages URL in a private window; check the build id tooltip |
| "Could not reach the analysis server" | Space is asleep or rebuilding | Wait 30-60 s and retry; check the Space Logs |
| 500 "missing ANTHROPIC_API_KEY" | Secret not set on the Space | Add it under Variables and secrets, then restart the Space |
| Record history shows no "Cloud sync" card | `TURSO_DATABASE_URL` not set on the Space | Add both Turso secrets, restart the Space |
| "Cloud storage is temporarily unavailable" | Wrong Turso URL/token, or Turso unreachable | Check the secrets; the Space Logs show `[CLOUD]` errors |
| 429 Too many requests | Public demo rate limit | Wait for the time shown, or raise `RATE_LIMIT_REQUESTS` |
