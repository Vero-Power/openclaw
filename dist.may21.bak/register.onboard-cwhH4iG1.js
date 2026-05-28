import "./paths-B4BZAPZh.js";
import { B as theme } from "./utils-CP9YLh6M.js";
import "./thinking-EAliFiVK.js";
import "./reply-DWT0cy8-.js";
import "./registry-B-j4DRfe.js";
import { f as defaultRuntime } from "./subsystem-BCQGGxdd.js";
import "./exec-DYqRzFbo.js";
import "./agent-scope-BZLOCEiY.js";
import "./model-selection-ynGV0Z-S.js";
import "./github-copilot-token-D2zp6kMZ.js";
import "./boolean-BsqeuxE6.js";
import "./env-VriqyjXT.js";
import "./config-DtbRlmRZ.js";
import "./manifest-registry-C_GIiKba.js";
import "./runner-C7hM9HBS.js";
import "./image-D0vq23FW.js";
import "./models-config-D6nMAC_H.js";
import "./pi-model-discovery-DaNAekda.js";
import "./pi-embedded-helpers-DcuvHDfg.js";
import "./sandbox-XsJfeUw3.js";
import "./fs-safe-Blsk2yxR.js";
import "./common-e59nG5-8.js";
import "./chrome-DXqh9nGk.js";
import "./tailscale-Lro1Kj8C.js";
import "./auth-bFvxXH9n.js";
import "./server-context-CHmagttf.js";
import "./frontmatter-BbgXOq1U.js";
import "./skills-BBSNS-KK.js";
import "./routes-Bg0US-wn.js";
import "./redact-f-Q-hFt_.js";
import "./errors-BF3TeRH2.js";
import "./paths-CCdaZN7r.js";
import "./ssrf-D_txTSjg.js";
import "./store-BCaPRD2z.js";
import "./ports-Bh1hpSpr.js";
import "./trash-DA1VeXgy.js";
import "./sessions-CVkx1N0P.js";
import "./dock-BqOPX0o0.js";
import "./message-channel-C_zlq96e.js";
import "./normalize-CTvuSHF1.js";
import "./accounts-smfqJdRz.js";
import "./accounts-DXixb0fv.js";
import "./accounts-CTB9PTCf.js";
import "./bindings-CR1uT82M.js";
import "./logging-CZCkEw2g.js";
import "./send-bFWg0QgZ.js";
import "./plugins-BYPsMadm.js";
import "./send-DmK0tuUe.js";
import "./paths-Dm6Vfv5g.js";
import "./tool-display-Bm1i_yTj.js";
import "./fetch-guard-C4dqYseW.js";
import "./api-key-rotation-BaJQuxyG.js";
import "./local-roots-B3ruZNdZ.js";
import "./sqlite-l9TdvT41.js";
import "./model-catalog-DC7jChRr.js";
import "./tokens--IQBlVdq.js";
import "./with-timeout-DVg0udW8.js";
import "./deliver-ByBbvbQg.js";
import "./diagnostic-CTGIuFcH.js";
import "./diagnostic-session-state-CUslJyKP.js";
import "./send-CxukNGSi.js";
import "./model-Cl0Gfh72.js";
import "./reply-prefix-BlvINWyz.js";
import "./memory-cli-CTdbcZ-J.js";
import "./manager-DApCEc62.js";
import "./retry-Clkcl3C1.js";
import "./chunk-ChwUDl2i.js";
import "./markdown-tables-D8bZ34ct.js";
import "./ir-B2WYP3JC.js";
import "./render-CJl4GK1B.js";
import "./commands-registry-BAFjEVRj.js";
import "./client-DdnyIhO0.js";
import "./call-CSypw845.js";
import "./channel-activity-D6hpFYkf.js";
import "./fetch-DNwdwedq.js";
import "./tables-BXbYKMMU.js";
import "./send-jLGBUmXl.js";
import "./pairing-store-CcRfo88y.js";
import "./proxy-BQqSOYGq.js";
import { t as formatDocsLink } from "./links-3f6kgn7Y.js";
import { n as runCommandWithRuntime } from "./cli-utils-BNQ6b6kn.js";
import "./help-format-Bnp4tZhj.js";
import "./progress-D_nB5v9p.js";
import "./resolve-route-eIdevylC.js";
import "./replies-DqVFvQVk.js";
import "./skill-commands-iCL50Xa6.js";
import "./workspace-dirs-CT-mKVRa.js";
import "./pi-tools.policy-a66b0rGY.js";
import "./send-YmF-Rg7s.js";
import "./onboard-helpers-DZJJDjod.js";
import "./prompt-style-BnkTcC6y.js";
import "./outbound-attachment-CwEfIkDj.js";
import "./pairing-labels-HA9N90e8.js";
import "./session-cost-usage-Bb2SCLK_.js";
import "./exec-approvals-DRcq8g4a.js";
import "./nodes-screen-CjdEp20v.js";
import "./control-service-t9PsFu2t.js";
import "./stagger-h65M-3RQ.js";
import "./channel-selection-BxsWW7fl.js";
import "./delivery-queue-Vjip9G62.js";
import "./runtime-guard-dRs_3Kxh.js";
import "./note-pXPTYNrM.js";
import "./clack-prompter-Bv5b49ER.js";
import "./daemon-runtime-DSNJL3JA.js";
import "./systemd-BFKnv5Jd.js";
import "./service-2zFrwuf6.js";
import "./health-C13_tVMz.js";
import "./onboarding-Cl702ZYt.js";
import "./shared-BMDTdv9N.js";
import "./auth-token-Tf6ZJ0Dn.js";
import "./logging-C81FDh59.js";
import { n as formatAuthChoiceChoicesForCli } from "./auth-choice-options-utSMxvmT.js";
import "./openai-model-default-DzZr8j-y.js";
import "./vllm-setup-DlcpmVcJ.js";
import "./systemd-linger-BtECFo36.js";
import "./model-picker-BVuCSzHi.js";
import "./onboard-custom-DOpfEwLe.js";
import { n as ONBOARD_PROVIDER_AUTH_FLAGS, t as onboardCommand } from "./onboard-VIV5BQ44.js";

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