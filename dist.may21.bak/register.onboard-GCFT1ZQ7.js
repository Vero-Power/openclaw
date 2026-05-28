import { Dt as theme, _ as defaultRuntime } from "./entry.js";
import "./auth-profiles-CiQsARKp.js";
import "./exec-CBKBIMpA.js";
import "./agent-scope-BEB0yS_L.js";
import "./github-copilot-token-DuFIqfeC.js";
import "./model-Db-28JMH.js";
import "./pi-model-discovery-Do3xMEtM.js";
import "./frontmatter-D-YR-Ghi.js";
import "./skills-BKnaiOKI.js";
import "./manifest-registry-DS2iK5AZ.js";
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
import "./help-format-5GFCgEVf.js";
import "./progress-Clpi3Ckj.js";
import "./replies-e7HamCHK.js";
import "./onboard-helpers-1IVAZXr5.js";
import "./prompt-style-D7sAEM59.js";
import "./pairing-labels-CfMMR0_C.js";
import "./note-BJVGNRX7.js";
import "./clack-prompter-BnC48P20.js";
import "./daemon-runtime-yCUgVLDr.js";
import "./runtime-guard-VbYgN2FQ.js";
import "./systemd-BaLni5Pb.js";
import "./service-CSCumKJX.js";
import "./health-BOYHVZ3d.js";
import "./onboarding-Bul3cilz.js";
import "./shared-CWLcSjGl.js";
import "./auth-token-XPJxK1yb.js";
import "./logging-BGewRZy0.js";
import { n as formatAuthChoiceChoicesForCli } from "./auth-choice-options-DEXqZb42.js";
import "./openai-model-default--OFIP1iK.js";
import "./vllm-setup-CmgHUJYr.js";
import "./systemd-linger-oDj-p-JT.js";
import "./model-picker-J9ENqAEE.js";
import "./onboard-custom-CEEOB4ZW.js";
import { n as ONBOARD_PROVIDER_AUTH_FLAGS, t as onboardCommand } from "./onboard-CD7DRH9t.js";

//#region src/cli/program/register.onboard.ts
function resolveInstallDaemonFlag(command, opts) {
	if (!command || typeof command !== "object") return;
	const getOptionValueSource = "getOptionValueSource" in command ? command.getOptionValueSource : void 0;
	if (typeof getOptionValueSource !== "function") return;
	if (getOptionValueSource.call(command, "skipDaemon") === "cli") return false;
	if (getOptionValueSource.call(command, "installDaemon") === "cli") return Boolean(opts.installDaemon);
}
const AUTH_CHOICE_HELP = formatAuthChoiceChoicesForCli({
	includeLegacyAliases: true,
	includeSkip: true
});
function registerOnboardCommand(program) {
	const command = program.command("onboard").description("Interactive wizard to set up the gateway, workspace, and skills").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/onboard", "docs.openclaw.ai/cli/onboard")}\n`).option("--workspace <dir>", "Agent workspace directory (default: ~/.openclaw/workspace)").option("--reset", "Reset config + credentials + sessions + workspace before running wizard").option("--non-interactive", "Run without prompts", false).option("--accept-risk", "Acknowledge that agents are powerful and full system access is risky (required for --non-interactive)", false).option("--flow <flow>", "Wizard flow: quickstart|advanced|manual").option("--mode <mode>", "Wizard mode: local|remote").option("--auth-choice <choice>", `Auth: ${AUTH_CHOICE_HELP}`).option("--token-provider <id>", "Token provider id (non-interactive; used with --auth-choice token)").option("--token <token>", "Token value (non-interactive; used with --auth-choice token)").option("--token-profile-id <id>", "Auth profile id (non-interactive; default: <provider>:manual)").option("--token-expires-in <duration>", "Optional token expiry duration (e.g. 365d, 12h)").option("--cloudflare-ai-gateway-account-id <id>", "Cloudflare Account ID").option("--cloudflare-ai-gateway-gateway-id <id>", "Cloudflare AI Gateway ID");
	for (const providerFlag of ONBOARD_PROVIDER_AUTH_FLAGS) command.option(providerFlag.cliOption, providerFlag.description);
	command.option("--custom-base-url <url>", "Custom provider base URL").option("--custom-api-key <key>", "Custom provider API key (optional)").option("--custom-model-id <id>", "Custom provider model ID").option("--custom-provider-id <id>", "Custom provider ID (optional; auto-derived by default)").option("--custom-compatibility <mode>", "Custom provider API compatibility: openai|anthropic (default: openai)").option("--gateway-port <port>", "Gateway port").option("--gateway-bind <mode>", "Gateway bind: loopback|tailnet|lan|auto|custom").option("--gateway-auth <mode>", "Gateway auth: token|password").option("--gateway-token <token>", "Gateway token (token auth)").option("--gateway-password <password>", "Gateway password (password auth)").option("--remote-url <url>", "Remote Gateway WebSocket URL").option("--remote-token <token>", "Remote Gateway token (optional)").option("--tailscale <mode>", "Tailscale: off|serve|funnel").option("--tailscale-reset-on-exit", "Reset tailscale serve/funnel on exit").option("--install-daemon", "Install gateway service").option("--no-install-daemon", "Skip gateway service install").option("--skip-daemon", "Skip gateway service install").option("--daemon-runtime <runtime>", "Daemon runtime: node|bun").option("--skip-channels", "Skip channel setup").option("--skip-skills", "Skip skills setup").option("--skip-health", "Skip health check").option("--skip-ui", "Skip Control UI/TUI prompts").option("--node-manager <name>", "Node manager for skills: npm|pnpm|bun").option("--json", "Output JSON summary", false);
	command.action(async (opts, commandRuntime) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			const installDaemon = resolveInstallDaemonFlag(commandRuntime, { installDaemon: Boolean(opts.installDaemon) });
			const gatewayPort = typeof opts.gatewayPort === "string" ? Number.parseInt(opts.gatewayPort, 10) : void 0;
			await onboardCommand({
				workspace: opts.workspace,
				nonInteractive: Boolean(opts.nonInteractive),
				acceptRisk: Boolean(opts.acceptRisk),
				flow: opts.flow,
				mode: opts.mode,
				authChoice: opts.authChoice,
				tokenProvider: opts.tokenProvider,
				token: opts.token,
				tokenProfileId: opts.tokenProfileId,
				tokenExpiresIn: opts.tokenExpiresIn,
				anthropicApiKey: opts.anthropicApiKey,
				openaiApiKey: opts.openaiApiKey,
				openrouterApiKey: opts.openrouterApiKey,
				aiGatewayApiKey: opts.aiGatewayApiKey,
				cloudflareAiGatewayAccountId: opts.cloudflareAiGatewayAccountId,
				cloudflareAiGatewayGatewayId: opts.cloudflareAiGatewayGatewayId,
				cloudflareAiGatewayApiKey: opts.cloudflareAiGatewayApiKey,
				moonshotApiKey: opts.moonshotApiKey,
				kimiCodeApiKey: opts.kimiCodeApiKey,
				geminiApiKey: opts.geminiApiKey,
				zaiApiKey: opts.zaiApiKey,
				xiaomiApiKey: opts.xiaomiApiKey,
				qianfanApiKey: opts.qianfanApiKey,
				minimaxApiKey: opts.minimaxApiKey,
				syntheticApiKey: opts.syntheticApiKey,
				veniceApiKey: opts.veniceApiKey,
				togetherApiKey: opts.togetherApiKey,
				huggingfaceApiKey: opts.huggingfaceApiKey,
				opencodeZenApiKey: opts.opencodeZenApiKey,
				xaiApiKey: opts.xaiApiKey,
				litellmApiKey: opts.litellmApiKey,
				customBaseUrl: opts.customBaseUrl,
				customApiKey: opts.customApiKey,
				customModelId: opts.customModelId,
				customProviderId: opts.customProviderId,
				customCompatibility: opts.customCompatibility,
				gatewayPort: typeof gatewayPort === "number" && Number.isFinite(gatewayPort) ? gatewayPort : void 0,
				gatewayBind: opts.gatewayBind,
				gatewayAuth: opts.gatewayAuth,
				gatewayToken: opts.gatewayToken,
				gatewayPassword: opts.gatewayPassword,
				remoteUrl: opts.remoteUrl,
				remoteToken: opts.remoteToken,
				tailscale: opts.tailscale,
				tailscaleResetOnExit: Boolean(opts.tailscaleResetOnExit),
				reset: Boolean(opts.reset),
				installDaemon,
				daemonRuntime: opts.daemonRuntime,
				skipChannels: Boolean(opts.skipChannels),
				skipSkills: Boolean(opts.skipSkills),
				skipHealth: Boolean(opts.skipHealth),
				skipUi: Boolean(opts.skipUi),
				nodeManager: opts.nodeManager,
				json: Boolean(opts.json)
			}, defaultRuntime);
		});
	});
}

//#endregion
export { registerOnboardCommand };