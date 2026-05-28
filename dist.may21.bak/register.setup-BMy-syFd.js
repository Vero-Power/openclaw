import { Dt as theme, _ as defaultRuntime, lt as shortenHomePath } from "./entry.js";
import "./auth-profiles-CiQsARKp.js";
import "./exec-CBKBIMpA.js";
import { C as ensureAgentWorkspace, m as DEFAULT_AGENT_WORKSPACE_DIR } from "./agent-scope-BEB0yS_L.js";
import "./github-copilot-token-DuFIqfeC.js";
import "./model-Db-28JMH.js";
import "./pi-model-discovery-Do3xMEtM.js";
import "./frontmatter-D-YR-Ghi.js";
import "./skills-BKnaiOKI.js";
import "./manifest-registry-DS2iK5AZ.js";
import { l as writeConfigFile, r as createConfigIO } from "./config-BZ-sQEmh.js";
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
import { o as resolveSessionTranscriptsDir } from "./paths-CHiHHmOl.js";
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
import { t as hasExplicitOptions } from "./command-options-CfGhT1Of.js";
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
import { n as logConfigUpdated, t as formatConfigPath } from "./logging-BGewRZy0.js";
import "./openai-model-default--OFIP1iK.js";
import "./vllm-setup-CmgHUJYr.js";
import "./systemd-linger-oDj-p-JT.js";
import "./model-picker-J9ENqAEE.js";
import "./onboard-custom-CEEOB4ZW.js";
import { t as onboardCommand } from "./onboard-CD7DRH9t.js";
import JSON5 from "json5";
import fs from "node:fs/promises";

//#region src/commands/setup.ts
async function readConfigFileRaw(configPath) {
	try {
		const raw = await fs.readFile(configPath, "utf-8");
		const parsed = JSON5.parse(raw);
		if (parsed && typeof parsed === "object") return {
			exists: true,
			parsed
		};
		return {
			exists: true,
			parsed: {}
		};
	} catch {
		return {
			exists: false,
			parsed: {}
		};
	}
}
async function setupCommand(opts, runtime = defaultRuntime) {
	const desiredWorkspace = typeof opts?.workspace === "string" && opts.workspace.trim() ? opts.workspace.trim() : void 0;
	const configPath = createConfigIO().configPath;
	const existingRaw = await readConfigFileRaw(configPath);
	const cfg = existingRaw.parsed;
	const defaults = cfg.agents?.defaults ?? {};
	const workspace = desiredWorkspace ?? defaults.workspace ?? DEFAULT_AGENT_WORKSPACE_DIR;
	const next = {
		...cfg,
		agents: {
			...cfg.agents,
			defaults: {
				...defaults,
				workspace
			}
		}
	};
	if (!existingRaw.exists || defaults.workspace !== workspace) {
		await writeConfigFile(next);
		if (!existingRaw.exists) runtime.log(`Wrote ${formatConfigPath(configPath)}`);
		else logConfigUpdated(runtime, {
			path: configPath,
			suffix: "(set agents.defaults.workspace)"
		});
	} else runtime.log(`Config OK: ${formatConfigPath(configPath)}`);
	const ws = await ensureAgentWorkspace({
		dir: workspace,
		ensureBootstrapFiles: !next.agents?.defaults?.skipBootstrap
	});
	runtime.log(`Workspace OK: ${shortenHomePath(ws.dir)}`);
	const sessionsDir = resolveSessionTranscriptsDir();
	await fs.mkdir(sessionsDir, { recursive: true });
	runtime.log(`Sessions OK: ${shortenHomePath(sessionsDir)}`);
}

//#endregion
//#region src/cli/program/register.setup.ts
function registerSetupCommand(program) {
	program.command("setup").description("Initialize ~/.openclaw/openclaw.json and the agent workspace").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/setup", "docs.openclaw.ai/cli/setup")}\n`).option("--workspace <dir>", "Agent workspace directory (default: ~/.openclaw/workspace; stored as agents.defaults.workspace)").option("--wizard", "Run the interactive onboarding wizard", false).option("--non-interactive", "Run the wizard without prompts", false).option("--mode <mode>", "Wizard mode: local|remote").option("--remote-url <url>", "Remote Gateway WebSocket URL").option("--remote-token <token>", "Remote Gateway token (optional)").action(async (opts, command) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			const hasWizardFlags = hasExplicitOptions(command, [
				"wizard",
				"nonInteractive",
				"mode",
				"remoteUrl",
				"remoteToken"
			]);
			if (opts.wizard || hasWizardFlags) {
				await onboardCommand({
					workspace: opts.workspace,
					nonInteractive: Boolean(opts.nonInteractive),
					mode: opts.mode,
					remoteUrl: opts.remoteUrl,
					remoteToken: opts.remoteToken
				}, defaultRuntime);
				return;
			}
			await setupCommand({ workspace: opts.workspace }, defaultRuntime);
		});
	});
}

//#endregion
export { registerSetupCommand };