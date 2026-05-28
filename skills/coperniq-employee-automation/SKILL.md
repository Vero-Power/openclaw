---
name: coperniq-employee-automation
description: "Run Vero Coperniq automations: local Python in coperniq-automation repo, or Gen 2 HTTPS cloud-functions (bomQuoteNotifier, finalDesignSender, signedDesignPlansetReview). Use when JR/OpenClaw should run BOM/Greentech, final design emails, signed-design/planset sweep, or Houston permit. Gen 2 path uses Bearer ID tokens + function URLs (see skill § Clawbot runtime). Do not use Coperniq API keys on Clawbot for those three HTTPS functions—they run with runtime secrets inside GCP."
metadata:
  openclaw:
    emoji: "🤖"
    requires:
      env:
        - COPERNIQ_API_KEY
        - GMAIL_ADDRESS
        - GMAIL_APP_PASSWORD
    primaryEnv: COPERNIQ_API_KEY
---

> **YAML `requires.env`** above reflects **local** `coperniq-automation` / **Houston** (Partner key + Gmail). For **`bomQuoteNotifier`**, **`finalDesignSender`**, and **`signedDesignPlansetReview`** over Gen 2 HTTPS, configure **`COPERNIQ_CF_*_URL`** plus **`GCP_CLAWBOT_INVOKER_SA`** when using impersonation (**§ Clawbot**) — **not** `COPERNIQ_API_KEY` on Clawbot for those HTTPS invokes.

# Coperniq employee automations (external repo + BOM on GCP)

The **authoritative repo** for most scripts is [**Vero-Power/coperniq-automation**](https://github.com/Vero-Power/coperniq-automation) (clone on a machine that runs Python when needed).

**BOM quote notifier — preferred path:** deploy **`bomQuoteNotifier`** (`cloud-functions/bom-quote-notifier/README.md`). On-demand **HTTPS** (Gen 2): **`Authorization: Bearer $(gcloud auth print-identity-token --impersonate-service-account="${GCP_CLAWBOT_INVOKER_SA}" --audiences="$COPERNIQ_CF_BOM_URL")`** (see **§ Clawbot**) + optional **`X-Ingest-Secret`**.

**Final design sender:** deploy **`finalDesignSender`** (`cloud-functions/final-design-sender/README.md`) — optional **`?project_id=`** (single project); **omit ID** for workspace sweep (every **Final Design Sent** WO **Assigned**); **`?dry_run=true`** previews eligible projects only (+ Bearer token, optional ingest secret).

**Signed Design / Planset Review sweep:** deploy **`signedDesignPlansetReview`** — same Bearer pattern (**§ Clawbot**); optional **`dry_run`** and **`project_id`**.

For **Houston**, use a local clone until it is hosted on GCP.

## Clawbot / OpenClaw: invoking Gen 2 HTTPS functions

This is the **default path** once **`bomQuoteNotifier`**, **`finalDesignSender`**, and **`signedDesignPlansetReview`** are deployed.

### Operators must provide (gateway / clawbot runtime env)

| Variable | Required | Meaning |
|---------|----------|--------|
| **`COPERNIQ_CF_BOM_URL`** | yes* | Canonical HTTPS URL for **`bomQuoteNotifier`** (`gcloud functions describe … --format='value(serviceConfig.uri)'`). |
| **`COPERNIQ_CF_FINAL_DESIGN_URL`** | yes* | **`finalDesignSender`** URL. |
| **`COPERNIQ_CF_SIGNED_DESIGN_URL`** | yes* | **`signedDesignPlansetReview`** URL. |
| **`GCP_CLAWBOT_INVOKER_SA`** | recommended | Caller SA (**`roles/run.invoker`**), e.g. **`clawbot-openclaw-invoker@openclaw-mail-bridge.iam.gserviceaccount.com`**. Used with **`gcloud … print-identity-token --impersonate-service-account`** on the gateway when not using **`GOOGLE_APPLICATION_CREDENTIALS`**. Grant the acting user **`roles/iam.serviceAccountTokenCreator`** on this SA unless you use a key file. |
| **`COPERNIQ_CF_INGEST_SECRET`** | if deployed with ingest | Same value as function **`INGEST_CRON_SECRET`**; send **`X-Ingest-Secret`** or **`?key=`**. |

\* **`yes*`** rows: pin **`COPERNIQ_CF_*_URL`** in **`~/.openclaw/.env`** before agents rely on HTTP invokes; **`GCP_CLAWBOT_INVOKER_SA`** strongly recommended whenever **`gcloud` impersonation** is the credential path.

### Canonical **`curl`** (gateway has `gcloud` + impersonation)

Use **`$GCP_CLAWBOT_INVOKER_SA`**, **`$COPERNIQ_CF_*`**, **`$COPERNIQ_CF_INGEST_SECRET`** loaded from **`~/.openclaw/.env`** (restart OpenClaw gateway after edits). **`--audiences`** must equal the **`https://*.run.app`** URL exactly.

```bash
URL="${COPERNIQ_CF_BOM_URL}"
TOKEN="$(gcloud auth print-identity-token \
  --impersonate-service-account="${GCP_CLAWBOT_INVOKER_SA}" \
  --audiences="${URL}")"
curl -sS -H "Authorization: Bearer ${TOKEN}" \
  ${COPERNIQ_CF_INGEST_SECRET:+-H "X-Ingest-Secret: ${COPERNIQ_CF_INGEST_SECRET}"} \
  "${URL}"
```

Mirror **`URL`** and query string (**`?dry_run=true`**, **`?project_id=`**, …) per automation.

If **`env`** is empty inside the agent’s **`bash`/`curl`** invocation, **`source ~/.openclaw/.env`** in that shell once (or reload the gateway) so **`COPERNIQ_CF_*`** and **`GCP_CLAWBOT_INVOKER_SA`** are set.

Caller **IAM** setup (caller SA **`run.invoker`**) is **`cloud-functions/setup-clawbot-invoker.sh`** plus **`cloud-functions/docs/clawbot-invoker-setup.md`**.

Credential surface (pick one placement for OpenClaw’s process):

| How Clawbot runs | Credential |
|------------------|-----------|
| On **GCP** with **`clawbot-openclaw-invoker@…`** attached | **Workload identity / metadata**: mint ID token with **audience = exact function URL**. |
| **Off-GCP** (Mac gateway, Fly, etc.) | **Impersonation** (typical when org forbids downloadable keys): **`gcloud auth print-identity-token --impersonate-service-account=… --audiences=<URL>`** with **`roles/iam.serviceAccountTokenCreator`** on the caller SA (**`cloud-functions/docs/clawbot-invoker-setup.md`**). If **`constraints/iam.managed.disableServiceAccountKeyCreation`** is **not** enforced, you may use **`GOOGLE_APPLICATION_CREDENTIALS`** + **`IDTokenCredentials`** instead—otherwise **omit** bogus key paths. |

### Agents (**mandatory** behavior when hitting Gen 2)

1. **Authenticate**: If **`GOOGLE_APPLICATION_CREDENTIALS`** points to a **real** **`clawbot-openclaw-invoker`** JSON key (org allows keys), **`IDTokenCredentials`** (**audience = function `serviceConfig.uri`**). Else (**default** where **`disableServiceAccountKeyCreation`** applies or no key present) use **impersonation**:

   **`gcloud auth print-identity-token --impersonate-service-account="${GCP_CLAWBOT_INVOKER_SA}" --audiences="<that function *.run.app URL>"`**

   Audience must equal the URL you **`curl`**. (**`cloud-functions/docs/clawbot-invoker-setup.md`** § impersonation vs keys.)
2. **Ingest**, if **`COPERNIQ_CF_INGEST_SECRET`** is set: add **`X-Ingest-Secret: $COPERNIQ_CF_INGEST_SECRET`** (never paste the value into Slack/user-visible logs).
3. **Read URLs from env** above; fall back once to **`gcloud functions describe FUNC --gen2 --format='value(serviceConfig.uri)'`** only when env is missing **and** the operator has instructed you—then advise them to pin URLs in **`~/.openclaw/.env`**.
4. **`finalDesignSender`** — **`?dry_run=true`** (no `project_id`) before live sweep unless the user explicitly asked for bulk email; **`?project_id=N`** when they named one Coperniq project.
5. **`signedDesignPlansetReview`** — prefer **`dry_run=true`** once when unsure; optional **`project_id`** to shrink scope during **429**/rate limits.

### What Clawbot does **not** need for Gen 2

- **`roles/cloudfunctions.developer`** / **`roles/iam.serviceAccountUser`** just to invoke Gen 2 over HTTPS—they **aren’t needed** once **`roles/run.invoker`** is bound on those Cloud Run services (**`setup-clawbot-invoker.sh`**); **`Developer`** grants **management** of CF, not safer invoke semantics.

## Resolve the workspace path

1. Use **`$COPERNIQ_AUTOMATION_HOME`** if set (absolute path to the clone root).
2. Otherwise try **`$HOME/coperniq-automation`** or **`$HOME/Vero/coperniq-automation`**.
3. Before running, **`test -f "$ROOT/bom_quote_notifier.py"`** (or list the directory). If missing, tell the user to clone the repo and set `COPERNIQ_AUTOMATION_HOME`, then stop.

All commands below assume **`cd` into that root** so `.env`, `state.json`, `bom_state.json`, and `states/` sit next to like in the upstream README.

## Required local setup (once per machine)

- **Python 3** with deps per script (see references). **Houston** needs Playwright + Chromium: `playwright install chromium`.
- **`.env`** at repo root from `.env.example` (see upstream README): at minimum `COPERNIQ_API_KEY`, Gmail app password vars, `BOM_WO_TEMPLATE_ID`, `PERMITTING_*` for final design, plus **`ANTHROPIC_API_KEY`**, portal passwords, and Gmail for Houston as documented upstream.
- **`dr_declaration_by_individual.pdf`** in repo root for Houston (not in git; obtain from ops).
- Scripts send **real email** and (for Houston) drive **real portals**; never run “just to test” without the user confirming.

## Automations (what to run)

| Script | Purpose | Typical invocation |
| ------ | ------- | ------------------ |
| `bom_quote_notifier.py` | Find BOM Quote Requested WOs in Assigned, email Greentech with Stamped RA, complete BOM workflow in Coperniq | **GCP:** **`COPERNIQ_CF_BOM_URL`** + Bearer (+ optional ingest, **§ Clawbot**). **Local:** **`python3 bom_quote_notifier.py`** |
| `final_design_sender.py` | Site-plan PNG, email customer, complete Final Design Sent WO | **GCP:** **`COPERNIQ_CF_FINAL_DESIGN_URL`** — **`?project_id=N`** or sweep (omit ID); **`?dry_run=true`** first for sweep preview (**§ Clawbot**). **Local:** **`python3 … <project_id>`** / **`--sweep [--dry-run]`** |
| `houston_permit.py` | Houston jurisdiction: prep (planset, HCAD, Lux DOB, etc.) then hands off to submit | `python3 houston_permit.py` or `python3 houston_permit.py <project_id>` |
| `signed_design_planset_review.py` | WO hygiene: Assigned → Review when Engineering 3rd party not complete | **GCP:** **`COPERNIQ_CF_SIGNED_DESIGN_URL`** — **`dry_run`** + optional **`project_id`** (**§ Clawbot**). **Local:** **`python3 … [--dry-run]`** / **`python3 … <project_id> [--dry-run]`** |

**Houston part 2:** **`houston_permit_submit.py`** is invoked automatically after prep for each project; it can also be run standalone against saved `states/<id>.json`. Do not tell employees to run submit alone unless they understand the saved state.

## Agent workflow (mandatory)

1. **Confirm intent** — Which automation? Which **project ID** (if not the notifier / full Houston scan)?
2. **Confirm environment** — **Gen 2 HTTPS path:** **`COPERNIQ_CF_BOM_URL`**, **`COPERNIQ_CF_FINAL_DESIGN_URL`**, **`COPERNIQ_CF_SIGNED_DESIGN_URL`**, **`GCP_CLAWBOT_INVOKER_SA`** (or **`GOOGLE_APPLICATION_CREDENTIALS`**), **`COPERNIQ_CF_INGEST_SECRET`** only if ingest is deployed. Caller auth is **IAM + impersonation/metadata ID token**, not **`COPERNIQ_API_KEY`**. Confirm **single `project_id`** when narrowing. **Local / Houston clone:** **`COPERNIQ_AUTOMATION_HOME`**, **`.env`**, Python deps.
3. **Safety** — BOM and final design **email external parties**; **final design sweep** can email **many customers** in one call — use **`dry_run`** first unless the user clearly wants bulk send.
4. **Execute** — For Gen 2, **`curl`** (or scripted HTTP to the **`COPERNIQ_CF_*_URL`** values) with **Bearer ID token** + optional **`X-Ingest-Secret`**; align **`dry_run`/sweep/`project_id`** with user intent (**§ Clawbot**). Never paste secrets into chat/logs. Fallback to local **`python3 …`** clone only when GCP is unavailable or Houston.
5. **Aftercare** — **BOM on GCP:** Firestore (`coperniq_automation_*`). **Final design on GCP:** stateless per request. **Local:** `state.json` / `bom_state.json` / `states/`. On failure, Cloud Logging or upstream README.

## Rate limits and Coperniq API

Upstream notes: work-order pagination uses **`offset`**, status values are case-sensitive (e.g. `"Completed"`), and aggressive scans can hit **429** — add delays or smaller scope (`<project_id>`) if the user hits rate limits.

## Optional hourly BOM loop

`run_loop.sh` in the external repo runs `bom_quote_notifier.py` every hour. Only suggest it if the user explicitly wants a long-running loop; fix **`SCRIPT_DIR`** inside the script to their clone path. Prefer **scheduled** execution (launchd/cron/CI) over `nohup` unless they own the process.

## Further detail

Read **`references/script-inventory.md`** for triggers, env vars, and dependencies without duplicating the full GitHub README. Operator IAM + token semantics: **`../../cloud-functions/docs/clawbot-invoker-setup.md`**.
