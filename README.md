# MedParcours AI

Clinical decision-support system that turns thick paper or PDF medical records into structured reports with risk alerts and contextual Q&A in ~30 seconds.

Built for Vietnamese physicians working in district and provincial hospitals, where doctors process large volumes of raw records in very short consultation windows, risking missed drug interactions, incorrect anticoagulation thresholds, or abnormal lab trends.

---

## How it works

MedParcours AI combines two layers with deliberately separated responsibilities:

| Layer | Role | Code |
|---|---|---|
| **LLM (Claude)** | Reads free-text records (PDF, images, scans), extracts structured data, writes clinical narratives | `main.py` (`REPORT_SYSTEM`) |
| **CDE v2 (Rule Engine)** | Computes eGFR (CKD-EPI 2021), CHA2DS2-VASc, HAS-BLED, INR targets per ESC/EACTS 2021 and AHA/ACC 2020, TTR | `cde/`, pure Python, fully deterministic |

The LLM reads and understands natural language. Every medical calculation runs through deterministic Python code that can be tested, audited, and produces identical results on the same input. This is a deliberate architecture choice for clinical reliability.

### Clinical language standards

- All terminology localized to Vietnamese medical conventions (international drug names and lab symbols like CRP, NT-proBNP, INR kept as-is)
- Cautious, objective phrasing: prefers "noted" and "may indicate" over absolute claims
- Primary diagnosis preserved verbatim from the source record to avoid misinterpretation

---

## Doctor workflow

1. **Intake** -- Upload records (PDF, DOCX, XLSX, PPTX, or image scan). The system builds a three-phase treatment timeline (Pre-op, Post-op Inpatient, Outpatient).
2. **Analysis** -- AI extracts labs, plots trend charts against clinical milestones. CDE v2 flags drug interactions and anticoagulation targets, and identifies "guideline gaps" where data is insufficient for a specific recommendation.
3. **Q&A** -- MedAmi chatbot answers in the context of the currently open record. Switches context automatically when a new record is opened.
4. **Export** -- Doctor reviews results, can generate a plain-language patient report, and sign off before publishing.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React (single `App.jsx`), esbuild |
| Backend | FastAPI, Uvicorn |
| AI extraction & chat | Claude (Anthropic API), Prompt Caching |
| Clinical rule engine | Pure Python, fully deterministic (`cde/`) |
| Storage & auth | Supabase (auth + fallback), Turso/libSQL (primary patient DB) |
| Deployment | Docker, GitHub Pages |

---

## Quick start

```bash
git clone https://github.com/danghoang2605-ds-ai/medparcours-ai.git
cd medparcours-ai
cp .env.example .env   # fill in ANTHROPIC_API_KEY (required), Supabase keys (optional)

# Backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
npm install
npm run dev
```

Or with Docker:

```bash
docker-compose up --build
```

The system degrades gracefully: if Supabase is not configured, analysis still works (no login or record saving). If Turso is unavailable, storage falls back to Supabase.

---

## Testing

```bash
pip install -r requirements-dev.txt
pytest -v
```

The test suite runs fully offline (Claude API and all external services are mocked). No `.env` configuration needed for tests. Coverage includes the clinical rule engine, all API endpoints (including error and fallback branches), and patient CRUD operations.

Design principle: storage and auth are auxiliary features and must never block the core analysis pipeline. If the database connection fails, the system shows empty history while the doctor can still analyze new records normally.

---

## Project structure

```
App.jsx                     # Full frontend (single-file React + esbuild)
main.py                     # FastAPI: endpoints, extraction pipeline, fallbacks
database.py                 # Patient storage (Turso/libSQL)
db.py                       # Supabase REST fallback storage
auth.py                     # Supabase Auth (Bearer token verification)
clinical_rules.py           # Base clinical rules
ecg_engine.py               # ECG image digitization (signal extraction, R-peak detection)
document_extract.py         # Text extraction from PDF, DOCX, XLSX, PPTX
conftest.py                 # Shared pytest fixtures (auth override)
cde/                        # Deterministic clinical decision engine
    engine.py                   # Main entry point (evaluate_v2)
    disease_classifier.py       # Disease profile detection and grouping
    icd_groups.py               # Ten ICD-10 circulatory system groups
    anticoagulation_targets.py  # INR targets by valve type (ESC/AHA guidelines)
    indicators.py               # CHA2DS2-VASc, HAS-BLED, TTR
    universal_indicators.py     # eGFR (CKD-EPI 2021), BMI, renal/hepatic flags
    test_*.py                   # Unit tests for each module
docker_setup/               # Dockerfiles for backend and frontend
test_*.py                   # Integration tests (endpoint-level)
```

---

## ECG digitization

The ECG module (`ecg_engine.py`) extracts signal waveforms from ECG paper images using OpenCV. Current capabilities:

- Grid detection and removal (pink/red ECG paper)
- Signal tracing via Viterbi/dynamic-programming path optimization
- 4x upscale preprocessing for low-resolution scans
- Calibration (px/mm from grid spacing)
- R-peak detection and heart rate estimation
- 12-lead sheet slicing (automatic layout detection)
- Safety rules: suppresses ST-T and axis findings when fewer than 12 leads are available

This is a **visualization aid**, not a diagnostic tool. All outputs require physician confirmation.

---

## Clinical decision engine (CDE v2)

The `cde/` module is the deterministic counterpart to the LLM. It computes:

- **Anticoagulation targets**: INR ranges by mechanical valve type and position, per ESC/EACTS 2021 and AHA/ACC 2020 guidelines
- **Risk scores**: CHA2DS2-VASc, HAS-BLED
- **Time in therapeutic range (TTR)**: Rosendaal linear interpolation
- **Renal function**: eGFR via CKD-EPI 2021 (race-free equation)
- **Disease classification**: Maps diagnoses to ICD-10 circulatory groups, detects atrial fibrillation, heart failure, valve disease profiles
- **Drug interaction flags**: Deterministic checks against the extracted medication list

Every calculation has unit tests. No LLM is involved in any computation.

---

## Architecture decisions

- **Hybrid AI**: LLM for language understanding, deterministic code for medical math. This is intentional -- an LLM should not be the sole authority on a clinical number.
- **Graceful degradation**: Every external dependency (database, OCR, voice) has a fallback. The core analysis pipeline never crashes due to an auxiliary service failure.
- **Single-file frontend**: `App.jsx` is large (~10K lines) but intentionally monolithic for deployment simplicity on GitHub Pages with esbuild. No build framework dependency.
- **Test isolation**: All tests mock external APIs. CI needs no secrets, no network, no database.

---

## License

MIT
