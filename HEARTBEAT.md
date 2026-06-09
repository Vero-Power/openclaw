# HEARTBEAT.md

# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Periodic monitoring is now handled by Sentinel JR

# (`~/.openclaw/sentinel.db` + `~/.openclaw/jr-library/`), gated by

# `OPENCLAW_SENTINEL_ENABLED=1`. The legacy heartbeat path is intentionally

# silenced — no directives below means no LLM call fires every 10 minutes.

# Add tasks below ONLY if you want to re-enable legacy periodic checks

# (the agent will need an explicit instruction to emit HEARTBEAT_OK

# when nothing's actionable, otherwise it'll spam Slack with prose).
