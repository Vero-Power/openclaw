# Employee Performance Grading System

Automated scoring for ops team members (Sam, Clay, Daxton) across four components. Scorecards post weekly and monthly to Ridge's private Slack channel. Employees see their own full breakdown on request. Composite grades feed bonus decisions.

---

## 1. Composite Grade Formula

```
Composite = (CoperniqOps × 0.40) + (ProjectHealth × 0.20) + (Responsiveness × 0.25) + (Initiative × 0.15)
```

| Component | Weight | What It Measures |
| --------- | ------ | ---------------- |
| Coperniq Ops | 40% | WO completion, phase speed, comment quality |
| Project Health | 20% | SLA color on assigned projects — green/yellow/red |
| Responsiveness | 25% | Did they respond within business hours (Slack + Email combined) |
| Initiative | 15% | EOD reports + unprompted status updates + flagging issues early |

**Why these weights:** Ops execution (40%) is the core job. Project health (20%) captures the outcome Ridge sees most directly. Responsiveness (25%) keeps communication accountable without over-penalizing field time. Initiative (15%) rewards the behavior Ridge wants to stop managing.

---

## 2. Project / Work Order Exclusion Rule

Only `ACTIVE` projects count toward any scoring component.

| Project Status | Include? |
| -------------- | -------- |
| `ACTIVE` | Yes |
| `CANCELLED` | No |
| `ON_HOLD` | No |

---

## 3. Coperniq Ops Score (40%)

Three sub-dimensions:

| Sub-dimension | Weight | What It Measures |
| ------------- | ------ | ---------------- |
| Completion Rate | 40% | WOs completed vs. assigned |
| Phase Transition Speed | 40% | Avg days per phase vs. SLA |
| Comment Quality | 20% | Comments on stuck/red projects (value signal, not volume) |

```
coperniq_score = (completion × 0.40) + (phase_speed × 0.40) + (comment_quality × 0.20)
```

**Why comment quality over comment count:** Raw comment volume is gameable — five meaningless comments score better than one that unblocks a project. Comment quality measures whether the employee is engaging where it matters: stuck or red-SLA projects.

### 3.1 Completion Rate

`completion_rate = WOs isCompleted === true / total WOs assigned` (ACTIVE projects, scoring window only)

| Score | Completion Rate |
| ----- | --------------- |
| 90–100 | 95%+ |
| 80–89 | 90–94% |
| 70–79 | 80–89% |
| 40–69 | 70–79% |
| 0–39 | Below 70% |

**Data:** `work-orders.json` → group by `assignee.email`, filter `isCompleted`, cross-reference project status.

**OpenClaw execution rule:** If JR completes a WO autonomously because the employee did not respond, the employee receives **zero credit** for that WO. The pipeline moves forward; they do not earn the grade.

### 3.2 Phase Transition Speed

For each project where employee is `owner`, `salesRep`, or `projectManager`: compute `days_in_phase = (completedAt - startedAt)` per phase instance. Average across the scoring window.

| Score | Avg Days per Phase |
| ----- | ------------------ |
| 90–100 | Within green SLA (`< yellowSla`) |
| 80–89 | Within yellow SLA (`< redSla`) |
| 70–79 | Up to 1.5× redSla |
| 40–69 | Up to 2× redSla |
| 0–39 | Exceeds 2× redSla |

Fallback when SLA absent: ≤3 days=100, ≤5=85, ≤8=75, ≤14=55, >14=30.

**Data:** `project-details.json` → `phaseInstances[]` → `startedAt`, `completedAt`, `phaseTemplate.redSla`, `phaseTemplate.yellowSla`.

### 3.3 Comment Quality

For each comment by the employee (ACTIVE projects only), score whether it was left on a stuck/red-SLA project.

```
quality_ratio = comments_on_stuck_or_red_projects / total_comments_by_employee
```

A "stuck" project = current phase has been `IN_PROGRESS` beyond its `yellowSla`. A "red" project = beyond `redSla`.

| Score | Quality Ratio |
| ----- | ------------- |
| 90–100 | 70%+ of comments on stuck/red projects |
| 80–89 | 50–69% |
| 70–79 | 30–49% |
| 40–69 | 10–29% |
| 0–39 | Under 10% (commenting only on healthy projects) |

**Floor:** If the employee has zero comments for the period, score = 0.

**Data:** `comments.json` + `project-details.json` (cross-reference phase SLA status at comment time).

---

## 4. Project Health Score (20%)

Measures whether the projects assigned to this employee are green, yellow, or red at scoring time. This is what Ridge sees on the dashboard — it belongs in the grade.

```
health_score = (green_projects × 1.0 + yellow_projects × 0.5 + red_projects × 0.0) / total_assigned_projects × 100
```

| Score | Portfolio Color Mix |
| ----- | ------------------- |
| 90–100 | 80%+ green |
| 80–89 | 60–79% green |
| 70–79 | 40–59% green |
| 40–69 | 20–39% green |
| 0–39 | Under 20% green |

An employee is "assigned to" a project if they appear as `owner`, `salesRep`, or `projectManager`.

**Data:** `project-details.json` → current `phaseInstances[]` with `status === "IN_PROGRESS"` → compute days vs. SLA thresholds.

---

## 5. Responsiveness Score (25%)

Measures whether the employee **responded within business hours** — not how fast, but whether they addressed it the same day.

**Business hours:** 8 AM – 6 PM CT, Monday–Saturday. Messages outside business hours do not count against the employee.

**Why response rate over response time:** Response time in minutes penalizes employees who are on-site, in installs, or batching their communication intentionally. What matters is: did it get addressed today?

### 5.1 Slack Response Rate

For each message from a sales rep or customer in the employee's assigned channels: did the employee reply before end of business that day?

```
slack_rate = messages_replied_to_same_business_day / total_inbound_messages
```

| Score | Response Rate |
| ----- | ------------- |
| 90–100 | 95%+ replied same day |
| 80–89 | 85–94% |
| 70–79 | 70–84% |
| 40–69 | 50–69% |
| 0–39 | Below 50% |

**Channel config** (populate before first run):

```json
{
  "repChannels": [
    {
      "channelId": "C_EXAMPLE1",
      "channelName": "#rep-john-doe",
      "reps": ["U_REP1"],
      "ops": ["U0AB51A9J9H"]
    }
  ]
}
```

**Data:** `~/.openclaw/cache/slack/{channelId}.json`

### 5.2 Email Response Rate

For each inbound email thread where the employee is a participant: did they reply before end of business that day?

```
email_rate = threads_replied_same_business_day / total_inbound_threads
```

| Score | Response Rate |
| ----- | ------------- |
| 90–100 | 95%+ replied same day |
| 80–89 | 85–94% |
| 70–79 | 70–84% |
| 40–69 | 50–69% |
| 0–39 | Below 50% |

Skip automated senders: `notification@coperniq.io`, `noreply@`, `mailer-daemon`, `stripe.com`, `bill.com`, `powerclerk`, `scribehow`.

**Data:** `email-archive/emails.json` → group by `threadId`, sort by `date`.

### 5.3 Composite Responsiveness

```
responsiveness_score = (slack_rate_score × 0.55) + (email_rate_score × 0.45)
```

Slack weighted slightly higher because it is the primary same-day communication channel.

**Employee emails:**

| Employee | Email |
| -------- | ----- |
| Sam | sam@veropwr.com |
| Clay | clay@veropwr.com |
| Daxton | daxton@veropwr.com |

---

## 6. Initiative Score (15%)

Rewards employees who manage themselves: submit EOD reports, surface issues before they escalate, and communicate without being asked.

Three sub-dimensions:

| Sub-dimension | Weight | What It Measures |
| ------------- | ------ | ---------------- |
| EOD Report Compliance | 50% | Reports submitted by 5:30 PM each day |
| Proactive Status Updates | 30% | Unprompted Slack/email updates on project status |
| Issue Flagging | 20% | Flagged a problem before it hit red SLA or became a blocker |

```
initiative_score = (eod × 0.50) + (proactive × 0.30) + (flagging × 0.20)
```

### 6.1 EOD Report Compliance

`eod_rate = days_with_report_by_5:30pm / total_working_days_in_period`

| Score | Compliance Rate |
| ----- | --------------- |
| 90–100 | 95%+ on time |
| 80–89 | 85–94% |
| 70–79 | 70–84% |
| 40–69 | 50–69% |
| 0–39 | Below 50% |

**Detection:** JR already DMs employees at 5:30 PM when no report is found. Use that same detection logic — log miss events to `~/.openclaw/cache/grading/eod-misses.json`.

### 6.2 Proactive Status Updates

A message is "proactive" if it:
- Starts a new thread (not a reply)
- Is in a project/ops channel
- Is not in response to a direct @mention or direct question

`proactive_rate = proactive_messages / total_outbound_messages`

| Score | Proactive Rate |
| ----- | -------------- |
| 90–100 | 30%+ |
| 80–89 | 20–29% |
| 70–79 | 15–19% |
| 40–69 | 10–14% |
| 0–39 | Below 10% |

### 6.3 Issue Flagging

Count instances where the employee posted a comment or message about a project **before** it hit red SLA. Cross-reference: project turned red within 48 hours of the employee's flag message → employee gets flagging credit.

| Score | Flags in Period |
| ----- | --------------- |
| 90–100 | 3+ valid flags |
| 80–89 | 2 |
| 70–79 | 1 |
| 0–69 | 0 |

---

## 7. Punctuality Penalty

Punctuality is a **direct deduction from the composite score** — not a component. It runs after all four components are calculated and weighted.

```
Final Score = Composite − Punctuality Penalty − EOD Penalty
```

**Applies to:** Sam LeSueur, Clay Neser, Daxton Dillon. **Kaleb Terranova is excluded from this system.**

---

### 7.1 Clock-In: "Locked In"

Each employee posts **"Locked In"** (case-insensitive) in `#corporate-operations` (`C0AB50H2K9R`) when they arrive. The Slack message `ts` field is the authoritative arrival time — not any stated time in the message text.

**Detection:** Scan `C0AB50H2K9R` message history for each employee's Slack user ID. Find the message containing "locked in" (case-insensitive) for each working day. Record `ts` as arrival time (convert Unix timestamp → CT).

| Employee | Slack ID |
| -------- | -------- |
| Sam LeSueur | `U0AB51A9J9H` |
| Clay Neser | `U0ABF0QGM0C` |
| Daxton Dillon | `U0AB9B36PM4` |

### 7.2 Punctuality Penalty Rules

| Situation | Penalty |
| --------- | ------- |
| "Locked In" `ts` ≤ 8:05 AM CT | No penalty |
| "Locked In" `ts` > 8:05 AM CT | −2 points per late day |
| No "Locked In" message by 9:00 AM CT | −2 points (treated as late) |
| Maximum per week | −10 points |
| Maximum per month | −20 points |

If "Locked In" is missing 3+ consecutive days, alert Ridge privately.

---

### 7.3 EOD Check-Out: Communication Clearance

At end of day, each employee posts an EOD message in `#corporate-operations` that includes:
1. Time they arrived (stated in the message text — for their own record)
2. Time they're leaving (the message `ts` is departure time)
3. **At least one screenshot** attached showing no outstanding customer replies, open Slack threads, or unanswered emails

**Detection:** The EOD submission is the employee's last message in `#corporate-operations` for the day that includes at least one file attachment. If no attachment is present, the EOD is treated as incomplete.

### 7.4 JR Independent Verification

Screenshots are self-reported. JR independently verifies at the time of the EOD message `ts`:

| Check | Source | Pass Condition |
| ----- | ------ | -------------- |
| Slack open threads | `~/.openclaw/cache/slack/` | No messages from reps/customers in assigned channels unreplied since 8 AM |
| Coperniq open comments | `comments.json` | No comment threads on their projects with the most recent message not from this employee |
| Email open threads | `email-archive/emails.json` | No inbound email threads without a same-day reply |

If JR finds outstanding items at EOD time that the employee didn't clear, that is an EOD failure regardless of whether screenshots were submitted.

### 7.5 EOD Penalty Rules

| Situation | Penalty |
| --------- | ------- |
| EOD posted, screenshots included, JR verification passes | No penalty |
| EOD posted, screenshots included, JR finds outstanding items | −3 points per occurrence |
| EOD posted but no screenshots attached | −2 points |
| No EOD message posted by end of business (6 PM CT) | −4 points |
| Maximum EOD penalty per week | −12 points |

**Why heavier than punctuality:** Leaving with open customer communication is a direct business impact. Being late costs time; leaving threads open costs customers and deals.

### 7.6 Scorecard Display

```
  Punctuality:    −4  (late Tue 8:17, Thu 8:22)
  EOD:            −3  (Mon: outstanding Coperniq thread on Smith project at departure)
  Composite:      81.4 − 4 − 3 = 74.4 → Carrier
```

Omit a penalty line entirely when that employee had a clean week for that category — no need to display zeros.

### 7.7 Edge Cases

- **Excused day:** Ridge exempts via DM to JR → no punctuality or EOD penalty for that day. Logged in snapshot.
- **Remote/travel day:** Same as excused if pre-approved by Ridge.
- **Late EOD (past 6 PM):** Still counts as on-time if it was posted before physically leaving — use departure `ts` vs. a hard cutoff. If no EOD at all by 9 PM, dock full −4.
- **Outstanding item was closed before EOD:** If a thread was open at 4 PM but the employee replied and closed it before their EOD post, it does not count against them. JR checks state at EOD `ts`, not mid-day.

---

## 8. Performance Tiers

There are no letter grades. All output — scorecards, employee responses, storage — uses the tier label only.

| Tier | Score | Meaning |
| ---- | ----- | ------- |
| Rowan | 90–100 | Self-managing, projects healthy, team asset |
| Runner | 80–89 | Solid execution, minor gaps |
| Carrier | 70–79 | Getting it done but needs follow-up |
| Pending | 60–69 | Falling behind — conversation needed |
| Grounded | 0–59 | Not performing — immediate attention |

Never output A/B/C/D/F. Never output "→ B" or "Grade: A". Always use the label.

---

## 8. Scoring Jobs

### 8.1 Weekly Scorecard (every Monday)

Scores previous Monday–Sunday. Output format:

```
Weekly Scorecard — Week of Apr 14, 2026

Sam LeSueur                           Carrier ↑1 from last week
  Coperniq Ops:    82  (WO: 88 | Speed: 79 | Quality: 75)
  Project Health:  74  (6 green, 2 yellow, 1 red)
  Responsiveness:  88  (Slack: 90 | Email: 85)
  Initiative:      76  (Proactive: 72 | Flagging: 75)
  Punctuality:     −4  (late Tue 8:17, Thu 8:22)
  EOD:             −3  (Mon: open Coperniq thread on Smith at departure)
  Composite:       81.4 − 4 − 3 = 74.4 → Carrier

Clay Neser                            Rowan → flat
  Coperniq Ops:    91  (WO: 94 | Speed: 90 | Quality: 88)
  Project Health:  92  (8 green, 1 yellow, 0 red)
  Responsiveness:  90  (Slack: 91 | Email: 88)
  Initiative:      88  (Proactive: 85 | Flagging: 82)
  Composite:       90.7 → Rowan

Daxton Dillon                         Runner ↑7 from last week
  ...
```

**Delivery:** Ridge's private Slack channel.

### 8.2 Monthly Scorecard (1st of each month)

Same format, previous calendar month. Shows monthly composite + trend vs. prior month.

**Delivery:** Ridge's private Slack channel.

### 8.3 Score Storage

Each run writes to `~/.openclaw/cache/grading/`:

```json
{
  "period": "2026-04-14 → 2026-04-20",
  "type": "weekly",
  "employees": {
    "sam": {
      "coperniq_ops": { "composite": 82, "completion": 88, "phase_speed": 79, "comment_quality": 75 },
      "project_health": { "score": 74, "green": 6, "yellow": 2, "red": 1 },
      "responsiveness": { "composite": 88, "slack": 90, "email": 85 },
      "initiative": { "composite": 76, "proactive": 72, "flagging": 75 },
      "punctuality_penalty": { "deduction": 4, "late_days": 2, "late_arrivals": ["2026-04-15T08:17:00", "2026-04-17T08:22:00"] },
      "eod_penalty": { "deduction": 3, "failures": [{ "date": "2026-04-14", "reason": "open Coperniq thread on Smith at departure", "screenshots_submitted": true, "jr_verification": "fail" }] },
      "composite_before_penalty": 81.4,
      "composite": 74.4,
      "tier": "Carrier",
      "delta": 1
    }
  }
}
```

File naming: `weekly/YYYY-MM-DD.json`, `monthly/YYYY-MM.json`.

---

## 9. Employee-Facing Grade Response

When an employee asks `@JR my grade`, respond with their full breakdown — not just the letter. They need to know what to fix.

```
Your scores (week of Apr 14):

  Coperniq Ops:    82  ↑5  (WO completion: 88 | Phase speed: 79 | Comment quality: 75)
  Project Health:  74  ↓2  (6 green, 2 yellow, 1 red — Jones project is red)
  Responsiveness:  88  ↑3  (Slack: 90 | Email: 85)
  Initiative:      76  ↑8  (Proactive: 72 | Flagging: 75)
  Punctuality:     −4  (late Tue 8:17, Thu 8:22)
  EOD:             −3  (Mon: Coperniq thread on Smith was open when you clocked out)

  Composite: 81.4 − 4 − 3 = 74.4 → Carrier ↑1 from last week

Tip: Clear your Coperniq threads before posting EOD. Smith had an unread comment Monday at 4:52 PM.
```

Rules:
- Never show another employee's scores
- Always use the tier label (Rowan / Runner / Carrier / Pending / Grounded) — never A/B/C/D/F
- Always show component breakdown, not just the tier
- Include a one-line coaching tip pointing to the lowest sub-component
- Show delta vs. prior period with ↑/↓ arrows

---

## 10. Ridge Override Rule

Ridge can override any score with a written reason.
- Override is logged in the snapshot with timestamp and note
- Employee receives a private DM: "Ridge updated your [component] score this week: [old] → [new]. Reason: [note]"

---

## 11. Bonus Model

Run **Model B only** (per project): each PTO closed pays at the tier that specific project scored that quarter. Eliminates the ambiguity of running two models in parallel.

Quarterly report posts on the first Monday of each new quarter as a private DM to Ridge.

---

## 12. Employee Reference Data

| Name | Email | Coperniq ID | Slack ID |
| ---- | ----- | ----------- | -------- |
| Sam LeSueur | sam@veropwr.com | 14206 | `U0AB51A9J9H` |
| Clay Neser | clay@veropwr.com | 14204 | `U0ABF0QGM0C` |
| Daxton Dillon | daxton@veropwr.com | 14205 | `U0AB9B36PM4` |
| Ridge Payne | ridge@veropwr.com | 14200 | `U096S2FQTUZ` |

---

## 13. Dependencies

- `COPERNIQ_API_KEY` — work orders, projects, phase instances, comments
- Slack bot token — rep channel history, proactive message detection
- `email-archive/emails.json` — kept current via Gmail sync
- `~/.openclaw/cache/grading/eod-misses.json` — written by JR's 5:30 PM EOD check
- Rep-channel config with channel IDs and user mappings (see §5.1)
- `skills/coperniq.io/Skill.MD` — Coperniq cache field reference
- `skills/jr-commands/SKILL.md` — access control for grade requests
