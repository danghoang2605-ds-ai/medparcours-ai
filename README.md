<p align="center">
  <img src="logos/mediflow-icon.svg" width="80" alt="MedParcours AI logo">
</p>

<h1 align="center">MedParcours AI</h1>

<p align="center">
  Clinical decision support that turns a long medical record into a structured report, risk alerts and record-aware Q&A in about a minute.<br>
  No sign-up. Records stay in your browser, with optional private cloud sync.
</p>

<p align="center">
  <a href="https://danghoang2605-ds-ai.github.io/medparcours-ai/"><b>Try the live app</b></a> &bull;
  <a href="https://danghoang2605-mediflow-ai.hf.space/docs">API docs</a> &bull;
  <a href="#run-locally">Run locally</a> &bull;
  <a href="#architecture">Architecture</a>
</p>

<p align="center">
  <a href="https://github.com/danghoang2605-ds-ai/medparcours-ai/actions/workflows/tests.yml"><img src="https://github.com/danghoang2605-ds-ai/medparcours-ai/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/danghoang2605-ds-ai/medparcours-ai/actions/workflows/deploy-pages.yml"><img src="https://github.com/danghoang2605-ds-ai/medparcours-ai/actions/workflows/deploy-pages.yml/badge.svg" alt="Deploy"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

> **Not a medical device.** MedParcours AI is a decision-support and documentation aid. Every output must be reviewed by a qualified clinician. Do not upload real patient data to the public demo.

---

## Try it in 30 seconds

1. Open **https://danghoang2605-ds-ai.github.io/medparcours-ai/**
2. The app opens in **English**; switch to **VI** in the top bar at any time.
3. Click **View demo: sample patient record** to explore a full report on a synthetic patient (no upload needed), or drop in your own PDF / DOCX / XLSX / PPTX / photo.
4. From the report menu, export the **Patient summary**: a plain-language, printable page with home medications, next steps and warning signs.

The backend runs on a free Hugging Face Space, so the first request after idle time can take 30 to 60 seconds. The public demo is rate-limited per IP.

## The problem

Doctors in district and provincial hospitals read long paper or PDF records in very short consultation windows. Critical details get buried across pages: drug interactions, wrong anticoagulation targets, lab values that drift over weeks. MedParcours AI reads the whole record, organizes it, and surfaces what needs attention.

## What it does

- **Record intake**: PDF (text extracted in the browser), Word, Excel, PowerPoint, and photos or scans via Claude Vision.
- **Three-phase timeline**: pre-op, post-op inpatient, outpatient follow-up, with lab trend charts against clinical milestones.
- **Deterministic risk engine**: eGFR (CKD-EPI 2021), CHA2DS2-VASc, HAS-BLED, INR targets by valve type and position (ESC/EACTS 2021, AHA/ACC 2020), time in therapeutic range, drug interactions and guideline gaps.
- **MedAmi chat**: answers grounded in the open record, in the UI language.
- **Virtual MDT and teaching modes**: multi-specialty case review and Socratic case questions.
- **Longitudinal records**: save a record, then add follow-up documents; the server merges them and re-runs the rule engine on the combined history.
- **ECG digitization**: waveform and heart-rate extraction from ECG paper images.
- **Exports**: full report, one-page handoff, plain-language patient summary, labs as CSV, all in the selected language.
- **Bilingual**: English by default, Vietnamese one click away. The report language follows the selection at analysis time: choose EN and an uploaded record (Vietnamese or English) is summarized in English; choose VI and it is summarized in Vietnamese. The demo case, exports and the assistant follow the same setting.

## Architecture

```
 Browser (React, GitHub Pages)                    Backend (FastAPI, stateless)
 ┌──────────────────────────────┐   HTTPS/JSON   ┌─────────────────────────────────┐
 │ pdf.js text extraction       │ ─────────────▶ │ /analyze, /analyze_text          │
 │ UI (VI / EN)                 │                │   1. Claude: record -> JSON      │
 │ IndexedDB: saved records,    │                │   2. CDE v2: deterministic math  │
 │   merge history, chat        │ ◀───────────── │   3. Claude: narrative wording   │
 │                              │                │ /records/merge (+ -file)         │
 │ Web Speech API (voice)       │                │ /chat (X-Lang), /ecg             │
 └──────────────────────────────┘                │ per-IP rate limit, no database   │
                                                 └─────────────────────────────────┘
```

| Decision | Why |
|---|---|
| **LLM for language, code for math** | Claude reads free text and writes narratives. Every clinical number comes from plain, unit-tested Python in [`cde/`](cde/) that gives the same result for the same input. |
| **Optional cloud sync without accounts** | With Turso configured, each browser gets a random sync key; records are stored under SHA-256(key) via Turso's HTTP API ([`cloud_store.py`](cloud_store.py)). Pasting the key on another device opens the same records. |
| **No accounts, browser-first storage** | Patient records are stored only in the user's browser (IndexedDB, [`localStore.js`](localStore.js)). The backend keeps nothing between requests, which removes a whole class of privacy and security risk and makes the app instantly usable. |
| **Stateless merge** | To add a follow-up document, the browser sends the record it already holds; the server extracts, merges ([`report_merge.py`](report_merge.py)) and re-evaluates, then returns the result. |
| **Abuse protection without login** | A per-IP sliding-window limit on every AI endpoint returns `429` with `Retry-After`. |
| **Translation that cannot break logic** | The UI was written in Vietnamese. [`i18n.js`](i18n.js) swaps rendered text for English using [`i18n/en.json`](i18n/en.json) (about 1,300 strings) and [`i18n/patterns.json`](i18n/patterns.json) (templated rule-engine messages) instead of rewriting components, so no string comparison in the app logic changes. A node is never half-translated: if any Vietnamese would remain, the original is kept. A CI test fails if the rule engine gains a message without an English translation. |
| **Output language per request** | The browser sends `X-Lang`; an ASGI middleware stores it in a context variable and the extraction, trend and chat prompts add a language instruction. JSON keys, enum codes and lab keys never change, so the rule engine sees the same structure in both languages. Parity tests check that an English record and its Vietnamese equivalent get the same profiles, ICD groups, eGFR and risk scores. |
| **Bilingual clinical rules** | Risk-score keyword detection matches whole words in Vietnamese and English, with negation in both ("không ghi nhận", "no history of", "denies"). Sex parsing accepts "Nam/Nữ" and "Male/Female". |
| **Graceful degradation** | If browser storage is unavailable, analysis still works. Voice falls back to the browser's speech APIs. |

## Tech stack

| Component | Technology |
|---|---|
| Frontend | React 19, esbuild ([`App.jsx`](App.jsx), [`scripts/build.mjs`](scripts/build.mjs)) |
| Backend | FastAPI + Uvicorn ([`main.py`](main.py)) |
| AI | [Claude](https://docs.anthropic.com/) via the Anthropic API, with prompt caching |
| Clinical rules | Pure Python ([`cde/`](cde/), [`clinical_rules.py`](clinical_rules.py)) |
| ECG | OpenCV + NumPy/SciPy ([`ecg_engine.py`](ecg_engine.py)) |
| Browser storage | IndexedDB |
| Hosting | GitHub Pages (frontend), Hugging Face Spaces (backend), Docker |

---

## Run locally

**Requirements:** Python 3.11+, Node 20+, an [Anthropic API key](https://console.anthropic.com/).

```bash
git clone https://github.com/danghoang2605-ds-ai/medparcours-ai.git
cd medparcours-ai
cp .env.example .env            # set ANTHROPIC_API_KEY

# Backend -> http://localhost:8000 (docs at /docs)
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend -> http://localhost:5173 (separate terminal)
npm install
npm run dev
```

**Docker** (backend on :8000, frontend on :8080):

```bash
cp .env.example .env
docker-compose up --build
```

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | Extraction, narratives, chat |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | empty | Optional cloud copy of saved records (`file:local.db` works for local testing) |
| `RATE_LIMIT_REQUESTS` | `30` | AI requests allowed per IP per window (`0` disables) |
| `RATE_LIMIT_WINDOW_S` | `600` | Window length in seconds |

The frontend talks to the hosted API by default; `npm run dev` and Docker point it at `localhost:8000`. For the Pages build, set the `MEDIFLOW_API_URL` repository variable to use another backend.

## Deploying

- **Frontend**: every push to `main` builds with `scripts/build.mjs` and deploys to GitHub Pages. The bundle name is content-hashed, so a new deploy is never served from a stale cache. Hover the EN/VI switch to see the build id.
- **Backend**: the API runs on a Hugging Face Space. After changing backend code, run `powershell -ExecutionPolicy Bypass -File scripts\sync-hf-space.ps1` to copy the backend to the Space repo and push (needs a Hugging Face write token).
- Step-by-step setup (API key, Space secrets, Pages settings, troubleshooting): [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Testing

```bash
pip install -r requirements-dev.txt && pytest -q     # backend
npm install && npm test                              # frontend: storage, translation, schema, jsdom UI tests
```

Everything runs offline (the Claude API is mocked, IndexedDB is simulated). CI runs both suites, a lint step and a production build on every push ([`tests.yml`](.github/workflows/tests.yml)). Beyond example-based tests, the suite uses techniques that catch bugs hand-written tests usually miss:

| Technique | Tool | What it guards |
|---|---|---|
| API fuzzing from the OpenAPI schema | [Schemathesis](https://schemathesis.readthedocs.io/) ([`test_api_fuzz.py`](test_api_fuzz.py)) | No endpoint returns a 5xx for any schema-valid input |
| Property-based tests | [Hypothesis](https://hypothesis.readthedocs.io/) ([`test_merge_properties.py`](test_merge_properties.py)) | Merging a follow-up never drops new data, loses history, or duplicates on re-upload |
| Malformed-output fuzzing | [`test_report_schema.py`](test_report_schema.py) | The rule engine and UI survive whatever shape the model returns |
| React rules of hooks | [eslint-plugin-react-hooks](https://www.npmjs.com/package/eslint-plugin-react-hooks) | No conditional hooks (crash when a card's data appears later) |
| UI smoke tests in jsdom | [`tests/ui.test.mjs`](tests/ui.test.mjs) | English-only UI, demo render, malformed saved records, print escaping |

Also run periodically (not in CI): `gitleaks` over the full git history, `pip-audit`, `npm audit`, `bandit`, `ruff`.

## API

| Endpoint | Purpose |
|---|---|
| `POST /analyze` | Analyze an uploaded file (PDF, DOCX, XLSX, PPTX, PNG, JPG) |
| `POST /analyze_text` | Analyze text already extracted in the browser |
| `POST /records/merge`, `POST /records/merge-file` | Merge a new document into a record the client sends |
| `POST /chat` | Record-aware Q&A (`assistant_type: clinical`) or product help (`system`); language from `X-Lang` |
| `GET /ecg/synthetic`, `POST /ecg` | ECG digitization |
| `GET /cloud/status`, `GET/PUT/DELETE /cloud/records[/{id}]` | Optional cloud sync (requires `X-Workspace` sync key) |
| `GET /health` | Health check (not rate-limited) |

Full schema: https://danghoang2605-mediflow-ai.hf.space/docs

## Project structure

```
.
├── App.jsx                  # Frontend (single-file React app)
├── api.js                   # Backend URL + fetch helper (sends X-Lang)
├── localStore.js            # IndexedDB record store (browser)
├── cloudSync.js, cloud_store.py  # Optional cloud sync (sync key + Turso)
├── i18n.js, i18n/           # EN/VI translation layer (dictionary + patterns)
├── demoData.en.js           # English synthetic demo case
├── main.py                  # FastAPI app: endpoints, extraction pipeline, rate limit
├── report_merge.py          # Pure merge logic for follow-up documents
├── report_schema.py, reportSchema.js  # Repair malformed AI output (backend + browser)
├── cde/                     # Deterministic clinical decision engine (+ unit tests)
├── clinical_rules.py        # Base clinical rules
├── ecg_engine.py            # ECG image digitization
├── document_extract.py      # DOCX / XLSX / PPTX text extraction
├── scripts/build.mjs        # Frontend build + dev server
├── tests/                   # Frontend unit tests
├── docker_setup/            # Dockerfiles
└── test_*.py, conftest.py   # Backend tests
```

## Limitations and roadmap

- Dates are shown day/month/year (DD/MM/YYYY), as in the source records.

- The second demo case is Vietnamese-only and is shown in VI mode only.
- Rate limiting is in-memory, which fits a single-instance deployment. Multiple instances would need a shared store such as Redis.
- `App.jsx` is a large single file; splitting it into feature modules is planned.

## License

[MIT](LICENSE)

## Changelog (highlights)

- **Records without an MRN can be saved**: the Save button used to be disabled when the document had no record number. It now asks for one and pre-fills a temporary local ID.
- **No fabricated teaching content**: Teaching mode showed the same "clinical reasoning score" (82/100, with canned feedback) for every patient, and justified every diagnosis with "heart failure picture and echo". It now shows a self-check rubric with no scores and a neutral prompt.
- **Clean printed reports**: missing fields no longer print as "undefined" or "null", and labels such as "Date of birth:" or "Surgeon:" are left out when there is no value. Covered by a print-output fuzzer.
- **No invented findings**: the echo card used to append "valve OK" and "prosthetic valve functioning well" whenever the gradient fell, even for records without a valve replacement. It now states only the measured EF and gradient.
- **Missing fields render cleanly**: records without an age, sex, echo date, EF value, lab display value or drug name no longer show "undefined", "NaN" or dangling labels, and no longer crash the lab panel. Found by a fuzzer that deletes fields and scans the visible text in every view.
- **Spreadsheet-safe CSV export**: lab cells starting with `=`, `+`, `-` or `@` are neutralized, so a crafted record can't run formulas in Excel.
- **Sanitized report edits**: scripts, event handlers and `javascript:` links are stripped from edited report HTML before it is saved or shown.
- **Double-click safe**: Analyze, Save and Update ignore repeat clicks while a request is running (one double-click used to start three paid analyses).
- **Risk-score fix**: the hypertension abbreviation "THA" used to match inside "thay van" (valve replacement), adding a false CHA2DS2-VASc point to valve patients. Keywords now match whole words only.
- **English report output**: uploaded records are summarized in the selected language; Vietnamese and English records score identically in the rule engine.
- **Valve detection fix**: "thay van hai lá cơ học" (word order with the valve name in between) is now recognized as a mechanical valve.
- **Cloud sync (optional)**: reconnects to Turso, with private sync keys instead of accounts; deletions propagate across devices.
- **Follow-up visits update the current state**: vitals, priority actions, key takeaways and the active problem list now come from the newest document (previously a follow-up with SpO2 85% still showed "breathing stable"); history lists keep accumulating. Guarded by Hypothesis property tests.
- **Hardening found by fuzzing**: a non-UTF-8 language header crashed every endpoint; `/ecg/synthetic?heart_rate_bpm=0` divided by zero; a 0.4 MB PNG could decode to 400 megapixels. Added request-size and pixel limits.
- **React fixes**: a conditional hook in the ICD card, and the case-conference animation counting the previous case's specialties.
- **Dependencies**: esbuild 0.28.2 (fixes a dev-server file-read issue on Windows).
- **Robust to imperfect AI output**: every report is normalized to the expected schema ([`report_schema.py`](report_schema.py), mirrored in [`reportSchema.js`](reportSchema.js)) before the rule engine or UI sees it; fuzz tests feed hundreds of malformed reports through both.
- **No unfounded "all clear"**: the sepsis and respiratory screens only report "no signs" when the relevant vitals were actually measured.
- **eGFR fix**: the priority screen read "Male" as female, so English records could be flagged with the wrong renal stage.
- **Security hardening**: printed reports escape all record text (crafted uploads can't inject scripts); upload, question and merge-text size caps; chat history normalized for the Messages API.
- **Redesigned Record history**: search, filters, pinning, rename, bulk delete, sync status.
- **US-friendly English**: MRN instead of record number, dictation and read-aloud in en-US, natural phrasing for sentences the app assembles at runtime ("Analyze 3 documents"), and translated backend error messages.
- **Sex parsing fix**: "Male" was previously read as female (the check looked for the Vietnamese "nam"), affecting eGFR and risk scores for English records.
- **No login, stateless backend**: records live in the browser; per-IP rate limiting protects the public demo.
