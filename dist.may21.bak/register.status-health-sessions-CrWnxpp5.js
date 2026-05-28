import { Dt as theme, _ as defaultRuntime, xt as setVerbose } from "./entry.js";
import "./auth-profiles-CiQsARKp.js";
import "./exec-CBKBIMpA.js";
import "./agent-scope-BEB0yS_L.js";
import "./github-copilot-token-DuFIqfeC.js";
import "./model-Db-28JMH.js";
import "./pi-model-discovery-Do3xMEtM.js";
import "./frontmatter-D-YR-Ghi.js";
import "./skills-BKnaiOKI.js";
import "./manifest-registry-DS2iK5AZ.js";
import "./skills-status-DG_-cls5.js";
import "./config-BZ-sQEmh.js";
import "./client-CnL59tOj.js";
import "./call-CUYAxKYv.js";
import "./message-channel-mz9U3AFl.js";
import "./subagent-registry-vEaOpKkF.js";
import "./sessions-DR2Q7emK.js";
import "./tokens-MGcNqlE_.js";
import "./normalize-G6M_Fobz.js";
import "./accounts-CWNozl33.js";
import "./bindings-BD0BDrVW.js";
import "./logging-CcxUDNcI.js";
import "./send-Cxqp_t_q.js";
import "./plugins-skOiRwEk.js";
import "./send-Q5mQ2dSq.js";
import "./with-timeout-C5wD-6xB.js";
import "./deliver-Ds1FsdFM.js";
import "./diagnostic-Bg3wFx-Z.js";
import "./diagnostic-session-state-DqgfGYqZ.js";
import "./accounts-Dnz84Cq6.js";
import "./send-CySDoLIX.js";
import "./fs-safe-BY9kuZ3o.js";
import "./pi-embedded-helpers-CqzGUWmo.js";
import "./sandbox-DHahf6kq.js";
import "./common-KSoAA9JF.js";
import "./chrome-B_t1ANw9.js";
import "./tailscale-BxzsxqAY.js";
import "./auth-Usar6LvN.js";
import "./server-context-D1WgVN1U.js";
import "./routes-PsuhHUg2.js";
import "./redact-ClDEZIsW.js";
import "./errors-BBDex6Nx.js";
import "./paths-CdSSbPPa.js";
import "./ssrf-Ixuyn7h8.js";
import "./store-CLY8B6p7.js";
import "./ports-Dq8ogiz4.js";
import "./trash-CWQQXWX3.js";
import "./dock-D6bGtL_y.js";
import "./accounts-DJ2NdTBm.js";
import "./paths-CHiHHmOl.js";
import "./thinking-BMF5Lj9k.js";
import "./models-config-JLYhU63Q.js";
import "./reply-prefix-B2KTDwI6.js";
import "./memory-cli-Cus9od3R.js";
import "./manager-WV9Ukl3R.js";
import "./gemini-auth-CKfS4LNU.js";
import "./sqlite-BpnzJB3x.js";
import "./retry-CnkRc4sA.js";
import "./chunk-BPK4-Aqj.js";
import "./markdown-tables-D0JGXPSu.js";
import "./fetch-guard-DKnIywH2.js";
import "./local-roots-7fFoYI9T.js";
import "./ir-DRw-k5Ij.js";
import "./render-CCLsW6Lz.js";
import "./commands-registry-Ds3AbSxg.js";
import "./image-Cj-0G0be.js";
import "./tool-display-Bv0KyUwm.js";
import "./runner-CispZDn9.js";
import "./model-catalog-pRYheRY6.js";
import "./session-utils-BcCEIdsX.js";
import "./skill-commands-D4KJCxgh.js";
import "./workspace-dirs-DVRmoVcd.js";
import "./pairing-store-BnNXa5t_.js";
import "./fetch-DhJ-elk8.js";
import "./exec-approvals-jec-Q4LG.js";
import "./nodes-screen-DacHCXz4.js";
import "./session-cost-usage-D3wNHCTs.js";
import "./pi-tools.policy-BJuTD3zW.js";
import "./control-service-CvuxiESd.js";
import "./stagger-BCQzFuQi.js";
import "./channel-selection-WbeswRpE.js";
import "./send-ocFho9JE.js";
import "./outbound-attachment-C5vYaHjf.js";
import "./delivery-queue-BTFZ_82k.js";
import "./send-C0ugNw9t.js";
import "./resolve-route-Cn3a88iy.js";
import "./channel-activity-DXoatCXN.js";
import "./tables-xdEB7tb_.js";
import "./proxy-1gf4gtkD.js";
import { t as formatDocsLink } from "./links-rnbUL9h5.js";
import { n as runCommandWithRuntime } from "./cli-utils-f9j-_1VT.js";
import { t as formatHelpExamples } from "./help-format-5GFCgEVf.js";
import "./progress-Clpi3Ckj.js";
import "./replies-e7HamCHK.js";
import "./onboard-helpers-1IVAZXr5.js";
import "./prompt-style-D7sAEM59.js";
import "./pairing-labels-CfMMR0_C.js";
import "./dangerous-tools-avAVO_ps.js";
import "./skill-scanner-CFkJ9nj-.js";
import "./channels-status-issues-CkhMsCbV.js";
import { n as parsePositiveIntOrUndefined } from "./helpers-ITexi1_a.js";
import "./runtime-guard-VbYgN2FQ.js";
import "./systemd-BaLni5Pb.js";
import "./service-CSCumKJX.js";
import "./diagnostics-DmGaiRdO.js";
import "./table-D01d2GuY.js";
import "./audit-D07-OGTR.js";
import { n as statusCommand } from "./status-w3PKFZWH.js";
import { r as healthCommand } from "./health-BOYHVZ3d.js";
import "./update-check-Kxb4dis0.js";
import "./dm-policy-shared-BorWOZ4P.js";
import "./node-service-C0JmESII.js";
import "./status.update-DmOgkqdq.js";
import { t as sessionsCommand } from "./sessions-z_jhDNn9.js";

//#region src/cli/program/register.status-health-sessions.ts
function resolveVerbose(opts) {
	return Boolean(opts.verbose || opts.debug);
}
function parseTimeoutMs(timeout) {
	const parsed = parsePositiveIntOrUndefined(timeout);
	if (timeout !== void 0 && parsed === void 0) {
		defaultRuntime.error("--timeout must be a positive integer (milliseconds)");
		defaultRuntime.exit(1);
		return null;
	}
	return parsed;
}
function registerStatusHealthSessionsCommands(program) {
	program.command("status").description("Show channel health and recent session recipients").option("--json", "Output JSON instead of text", false).option("--all", "Full diagnosis (read-only, pasteable)", false).option("--usage", "Show model provider usage/quota snapshots", false).option("--deep", "Probe channels (WhatsApp Web + Telegram + Discord + Slack + Signal)", false).option("--timeout <ms>", "Probe timeout in milliseconds", "10000").option("--verbose", "Verbose logging", false).option("--debug", "Alias for --verbose", false).addHelpText("after", () => `\n${theme.heading("Examples:")}\n${formatHelpExamples([
		["openclaw status", "Show channel health + session summary."],
		["openclaw status --all", "Full diagnosis (read-only)."],
		["openclaw status --json", "Machine-readable output."],
		["openclaw status --usage", "Show model provider usage/quota snapshots."],
		["openclaw status --deep", "Run channel probes (WA + Telegram + Discord + Slack + Signal)."],
		["openclaw status --deep --timeout 5000", "Tighten probe timeout."]
	])}`).addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/status", "docs.openclaw.ai/cli/status")}\n`).action(async (opts) => {
		const verbose = resolveVerbose(opts);
		setVerbose(verbose);
		const timeout = parseTimeoutMs(opts.timeout);
		if (timeout === null) return;
		await runCommandWithRuntime(defaultRuntime, async () => {
			await statusCommand({
				json: Boolean(opts.json),
				all: Boolean(opts.all),
				deep: Boolean(opts.deep),
				usage: Boolean(opts.usage),
				timeoutMs: timeout,
				verbose
			}, defaultRuntime);
		});
	});
	program.command("health").description("Fetch health from the running gateway").option("--json", "Output JSON instead of text", false).option("--timeout <ms>", "Connection timeout in milliseconds", "10000").option("--verbose", "Verbose logging", false).option("--debug", "Alias for --verbose", false).addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/health", "docs.openclaw.ai/cli/health")}\n`).action(async (opts) => {
		const verbose = resolveVerbose(opts);
		setVerbose(verbose);
		const timeout = parseTimeoutMs(opts.timeout);
		if (timeout === null) return;
		await runCommandWithRuntime(defaultRuntime, async () => {
			await healthCommand({
				json: Boolean(opts.json),
				timeoutMs: timeout,
				verbose
			}, defaultRuntime);
		});
	});
	program.command("sessions").description("List stored conversation sessions").option("--json", "Output as JSON", false).option("--verbose", "Verbose logging", false).option("--store <path>", "Path to session store (default: resolved from config)").option("--active <minutes>", "Only show sessions updated within the past N minutes").addHelpText("after", () => `\n${theme.heading("Examples:")}\n${formatHelpExamples([
		["openclaw sessions", "List all sessions."],
		["openclaw sessions --active 120", "Only last 2 hours."],
		["openclaw sessions --json", "Machine-readable output."],
		["openclaw sessions --store ./tmp/sessions.json", "Use a specific session store."]
	])}\n\n${theme.muted("Shows token usage per session when the agent reports it; set agents.defaults.contextTokens to cap the window and show %.")}`).addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/sessions", "docs.openclaw.ai/cli/sessions")}\n`).action(async (opts) => {
		setVerbose(Boolean(opts.verbose));
		await sessionsCommand({
			json: Boolean(opts.json),
			store: opts.store,
			active: opts.active
		}, defaultRuntime);
	});
}

//#endregion
export { registerStatusHealthSessionsCommands };