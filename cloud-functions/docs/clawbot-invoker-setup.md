# Clawbot: service account to invoke Coperniq Cloud Functions (Gen 2)

Gen 2 HTTPS functions run on **Cloud Run** with **`--no-allow-unauthenticated`**. A caller therefore needs:

1. **IAM:** `roles/run.invoker` **on each underlying Cloud Run service**, granted to **Clawbot’s service account** (the **caller**, not the function runtime account).
2. **Authentication:** An **OAuth 2 ID token** with **audience = the function’s HTTPS URL** (`Authorization: Bearer <token>`).

Clawbot does **not** need Coperniq API keys in Secret Manager—the functions attach **`COPERNIQ_API_KEY`**, Gmail, etc. via their **runtime** service account (e.g. `openclaw-firestore@...`).

If you set **`INGEST_CRON_SECRET`** on functions, Clawbot must also send **`X-Ingest-Secret`** or **`?key=`** — that secret is configured **outside** IAM (agent env or a secret the bot reads).

---

## Automated setup

From **`openclaw/cloud-functions`** (deploy functions once first):

```bash
export GCP_PROJECT=openclaw-mail-bridge
export GCP_REGION=us-central1
./setup-clawbot-invoker.sh
```

This creates **`clawbot-openclaw-invoker@<project>.iam.gserviceaccount.com`** if missing and grants **`roles/run.invoker`** on **`bomQuoteNotifier`**, **`finalDesignSender`**, and **`signedDesignPlansetReview`**.

Customize the account id:

```bash
SA_ID=my-clawbot ./setup-clawbot-invoker.sh
```

---

## Manual: create the caller service account

```bash
PROJECT_ID=openclaw-mail-bridge
SA_ID=clawbot-openclaw-invoker
SA_EMAIL="${SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "${SA_ID}" \
  --project="${PROJECT_ID}" \
  --display-name="Clawbot Coperniq HTTP invoker"
```

Do **not** use the runtime SA (`openclaw-firestore@...`) as the bot identity; that mixes “runs inside the function” with “calls the function.”

---

## Manual: bind `roles/run.invoker`

Resolve the backing Cloud Run service from the Gen 2 function, then bind:

```bash
PROJECT_ID=openclaw-mail-bridge
REGION=us-central1
FN=bomQuoteNotifier
SA_EMAIL=clawbot-openclaw-invoker@${PROJECT_ID}.iam.gserviceaccount.com

FULL="$(gcloud functions describe "${FN}" --gen2 --region="${REGION}" --project="${PROJECT_ID}" \
  --format='value(serviceConfig.service)')"
SVC="${FULL##*/}"

gcloud run services add-iam-policy-binding "${SVC}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.invoker"
```

Repeat **`FN`** for **`finalDesignSender`** and **`signedDesignPlansetReview`**.

---

## How Clawbot obtains ID tokens

The **audience** must be the canonical **function URL** (`serviceConfig.uri`).

### JSON key — IAM you **actually** need (calling Gen 2 HTTPS only)

Advice such as **“Cloud Functions Developer + Service Account User + JSON key”** is usually **wider than needed**:

| GCP role | Needed for clawbot-only **HTTP invokes**? |
|---------|--------------------------------------------|
| **Cloud Functions Developer** (`roles/cloudfunctions.developer`) | **No.** It’s for **managing/deploying/listing Cloud Functions** in the project—high blast radius. **Avoid** unless this same identity must operate the CF APIs. |
| **Service Account User** (`roles/iam.serviceAccountUser`) | **No** when the bot uses **its own** downloadable key: that SA mints **`IDTokenCredentials`** **as itself** toward Cloud Run (`run.invoker`). **`Service Account User`** matters when principle A attaches or **runs as** a *different* service account—not for Bearer calls from clawbot-invoker using its **own** key. |
| **Cloud Run Invoker** (`roles/run.invoker`) on each Gen 2 backing service | **Yes.** **`setup-clawbot-invoker.sh`** binds this for **`clawbot-openclaw-invoker@…`**. |

**Preferred when allowed:** keep **`clawbot-openclaw-invoker`** + a **downloaded JSON key** + **`GOOGLE_APPLICATION_CREDENTIALS`** (see Python block below)—skip **`Cloud Functions Developer`** unless you merge deploy into that SA.

**Create JSON key** (operator with **`iam.serviceAccountKeys.admin`**; never commit):

```bash
PROJECT_ID=openclaw-mail-bridge
SA_EMAIL="clawbot-openclaw-invoker@${PROJECT_ID}.iam.gserviceaccount.com"
OUT="$HOME/.openclaw/secrets/clawbot-openclaw-invoker.json"

mkdir -p "$(dirname "$OUT")"
gcloud iam service-accounts keys create "$OUT" \
  --iam-account="${SA_EMAIL}" \
  --project="${PROJECT_ID}"
chmod 600 "$OUT"
```

#### Org policy blocks keys (`disableServiceAccountKeyCreation`)

If **`gcloud iam service-accounts keys create`** fails with **`constraints/iam.managed.disableServiceAccountKeyCreation`**, **long‑lived JSON keys are intentionally forbidden**—do **not** create an empty **`$OUT`** file; remove it if **`keys create`** did not succeed.

Use one of these instead (same **`run.invoker`** IAM you already configured):

| Option | Fits |
|--------|------|
| **Impersonation** | Mac gateway already has **`gcloud`**: **`gcloud auth print-identity-token --impersonate-service-account=clawbot-openclaw-invoker@… --audiences=$COPERNIQ_CF_*`** — grant **`roles/iam.serviceAccountTokenCreator`** to **`jr@veropwr.com`** (**or**) the gateway’s OAuth user on **`clawbot-openclaw-invoker`**. This is usually the quickest path **without keys**. |
| **Run OpenClaw on GCP** | Attach **`clawbot-openclaw-invoker`** as the workload identity / service account; mint ID tokens via **metadata** (no disk key). |
| **Workload Identity Federation** | Federate GitHub Actions / OIDC provider → exchange for short‑lived Google tokens (no downloadable key). Org‑friendly replacement for SA JSON. |
| **Org exception** | Cloud admin relaxes **`iam.managed.disableServiceAccountKeyCreation`** for a bounded exception (least preferred vs WIF/metadata). |

For local testing: use **impersonation** path in the next subsection instead of **`GOOGLE_APPLICATION_CREDENTIALS`**.

For gateways that **already** disallow keys: **omit** **`GOOGLE_APPLICATION_CREDENTIALS`** from **`~/.openclaw/.env`** unless a key file genuinely exists.

**If keys exist** (exceptions only): gateways set **`GOOGLE_APPLICATION_CREDENTIALS=$OUT`** and mint **`IDTokenCredentials`** in code. Rotate: **`gcloud iam service-accounts keys list --iam-account=$SA_EMAIL`**; revoke unused generations.

### Humans: impersonate the SA and call `curl`

Your user identity needs **`roles/iam.serviceAccountTokenCreator`** on the Clawbot SA (or broader admin).

```bash
URL="$(gcloud functions describe bomQuoteNotifier --gen2 \
  --region=us-central1 --project=openclaw-mail-bridge \
  --format='value(serviceConfig.uri)')"

TOKEN="$(gcloud auth print-identity-token \
  --impersonate-service-account="${SA_EMAIL}" \
  --audiences="${URL}")"

curl -sS -H "Authorization: Bearer ${TOKEN}" "${URL}?dry_run=true"
```

(Add **`X-Ingest-Secret`** when configured.)

### On GCP with the SA attached (metadata server)

```bash
URL="https://your-function-host-example.a.run.app"
TOKEN="$(curl -sS \
  -H "Metadata-Flavor: Google" \
  "http://metadata/compute/v1/instance/service-accounts/default/identity?audience=${URL}&format=full")"
curl -sS -H "Authorization: Bearer ${TOKEN}" "${URL}"
```

### Python (service account key file — prefer WIF / attached SA over long‑lived keys)

```python
import google.auth.transport.requests
from google.oauth2 import service_account

SERVICE_URL = "https://…"   # exact serviceConfig.uri
KEY_PATH = "/path/to/clawbot.json"

cred = service_account.IDTokenCredentials.from_service_account_file(
    KEY_PATH, target_audience=SERVICE_URL
)
cred.refresh(google.auth.transport.requests.Request())
id_token = cred.token
```

---

## Principals recap

| Identity | Purpose |
|---------|---------|
| **`openclaw-firestore@...`** | Function **runtime** SA: pulls workflow secrets from Secret Manager and talks to Coperniq / SMTP / Firestore. |
| **`clawbot-openclaw-invoker@...`** (or your **`SA_ID`**) | **Caller** SA: **`run.invoker`** only (+ mint ID tokens to the three URLs). |
| Operators | **`iam.serviceAccountTokenCreator`** on the Clawbot SA if testing via **`gcloud auth print-identity-token --impersonate-service-account`** |

To grant **your interactive gcloud user** impersonation on the caller SA (`gcloud config get-value account`):

```bash
PROJECT_ID=openclaw-mail-bridge
SA_EMAIL=clawbot-openclaw-invoker@${PROJECT_ID}.iam.gserviceaccount.com
ME="$(gcloud config get-value account 2>/dev/null)"

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --member="user:${ME}" \
  --role="roles/iam.serviceAccountTokenCreator"
```


## Optional ingest gate

Functions may require **`INGEST_CRON_SECRET`**. IAM proves “Google knows this SA”; ingest proves “same automation as JR.” Duplicate the ingest value into OpenClaw’s env or a dedicated secret mounted to Clawbot.

---

## OpenClaw / clawbot gateway (what to configure so agents know **where** to call)

Agents follow **`skills/coperniq-employee-automation/SKILL.md`** (§ **Clawbot / OpenClaw: invoking Gen 2 HTTPS functions**). **Operators** set these on whatever runs OpenClaw (never commit secrets to git):

| Variable | Purpose |
|----------|---------|
| **`COPERNIQ_CF_BOM_URL`** | **`bomQuoteNotifier`** — value of **`serviceConfig.uri`** |
| **`COPERNIQ_CF_FINAL_DESIGN_URL`** | **`finalDesignSender`** |
| **`COPERNIQ_CF_SIGNED_DESIGN_URL`** | **`signedDesignPlansetReview`** |
| **`COPERNIQ_CF_INGEST_SECRET`** | Matches function **`INGEST_CRON_SECRET`** if you use ingest |

Typical placements: **`~/.openclaw/.env`** (gateway), Fly secrets / systemd **`Environment=`** / workload env.

Resolve each URI after deploy:

```bash
gcloud functions describe bomQuoteNotifier --gen2 \
  --region=us-central1 --project=openclaw-mail-bridge \
  --format='value(serviceConfig.uri)'
```

After IAM (**`setup-clawbot-invoker.sh`**) + env pinning, Clawbot uses Bearer ID tokens (**§ earlier**)—not **`COPERNIQ_API_KEY`**—for these three HTTPS endpoints.

---

## Related

| File | Role |
|------|------|
| `deploy-coperniq-functions.sh` | Deploy BOM / Final design / Signed-design Gen 2 builds |
| `setup-clawbot-invoker.sh` | Create caller SA + `run.invoker` bindings |

See also **`skills/coperniq-employee-automation/SKILL.md`** for intent and invocation patterns once URLs are stable.
