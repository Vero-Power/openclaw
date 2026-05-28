import { Dt as theme, Et as isRich, X as escapeRegExp, _ as defaultRuntime, cn as hasHelpOrVersion, n as isTruthyEnvValue, nn as getCommandPath, on as getVerboseFlag, xt as setVerbose } from "./entry.js";
import "./auth-profiles-CiQsARKp.js";
import { n as replaceCliName, r as resolveCliName } from "./command-format-Cutkv9UT.js";
import "./exec-CBKBIMpA.js";
import "./agent-scope-BEB0yS_L.js";
import "./github-copilot-token-DuFIqfeC.js";
import "./model-Db-28JMH.js";
import "./pi-model-discovery-Do3xMEtM.js";
import "./frontmatter-D-YR-Ghi.js";
import "./skills-BKnaiOKI.js";
import "./manifest-registry-DS2iK5AZ.js";
import { V as VERSION } from "./config-BZ-sQEmh.js";
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
import "./cli-utils-f9j-_1VT.js";
import "./help-format-5GFCgEVf.js";
import "./progress-Clpi3Ckj.js";
import "./replies-e7HamCHK.js";
import "./onboard-helpers-1IVAZXr5.js";
import "./prompt-style-D7sAEM59.js";
import "./pairing-labels-CfMMR0_C.js";
import "./catalog-20G-EClO.js";
import "./plugin-registry-CkKQ_Ziu.js";
import { n as resolveCliChannelOptions } from "./channel-options-BhilrtEK.js";
import { t as getSubCliCommandsWithSubcommands } from "./register.subclis-DbNdm_qz.js";
import { a as registerProgramCommands, r as getCoreCliCommandsWithSubcommands } from "./command-registry-VI2CmLNs.js";
import { r as setProgramContext } from "./program-context-DOF13ClK.js";
import { t as forceFreePort } from "./ports-CEO1I5p5.js";
import { n as formatCliBannerLine, r as hasEmittedCliBanner, t as emitCliBanner } from "./banner-DsHWdRUt.js";
import { Command } from "commander";

//#region src/cli/program/context.ts
function createProgramContext() {
	const channelOptions = resolveCliChannelOptions();
	return {
		programVersion: VERSION,
		channelOptions,
		messageChannelOptions: channelOptions.join("|"),
		agentChannelOptions: ["last", ...channelOptions].join("|")
	};
}

//#endregion
//#region src/cli/program/help.ts
const CLI_NAME = resolveCliName();
const CLI_NAME_PATTERN = escapeRegExp(CLI_NAME);
const ROOT_COMMANDS_WITH_SUBCOMMANDS = new Set([...getCoreCliCommandsWithSubcommands(), ...getSubCliCommandsWithSubcommands()]);
const ROOT_COMMANDS_HINT = "Hint: commands suffixed with * have subcommands. Run <command> --help for details.";
const EXAMPLES = [
	["openclaw models --help", "Show detailed help for the models command."],
	["openclaw channels login --verbose", "Link personal WhatsApp Web and show QR + connection logs."],
	["openclaw message send --target +15555550123 --message \"Hi\" --json", "Send via your web session and print JSON result."],
	["openclaw gateway --port 18789", "Run the WebSocket Gateway locally."],
	["openclaw --dev gateway", "Run a dev Gateway (isolated state/config) on ws://127.0.0.1:19001."],
	["openclaw gateway --force", "Kill anything bound to the default gateway port, then start it."],
	["openclaw gateway ...", "Gateway control via WebSocket."],
	["openclaw agent --to +15555550123 --message \"Run summary\" --deliver", "Talk directly to the agent using the Gateway; optionally send the WhatsApp reply."],
	["openclaw message send --channel telegram --target @mychat --message \"Hi\"", "Send via your Telegram bot."]
];
function configureProgramHelp(program, ctx) {
	program.name(CLI_NAME).description("").version(ctx.programVersion).option("--dev", "Dev profile: isolate state under ~/.openclaw-dev, default gateway port 19001, and shift derived ports (browser/canvas)").option("--profile <name>", "Use a named profile (isolates OPENCLAW_STATE_DIR/OPENCLAW_CONFIG_PATH under ~/.openclaw-<name>)");
	program.option("--no-color", "Disable ANSI colors", false);
	program.helpOption("-h, --help", "Display help for command");
	program.helpCommand("help [command]", "Display help for command");
	program.configureHelp({
		sortSubcommands: true,
		sortOptions: true,
		optionTerm: (option) => theme.option(option.flags),
		subcommandTerm: (cmd) => {
			const hasSubcommands = cmd.parent === program && ROOT_COMMANDS_WITH_SUBCOMMANDS.has(cmd.name());
			return theme.command(hasSubcommands ? `${cmd.name()} *` : cmd.name());
		}
	});
	const formatHelpOutput = (str) => {
		let output = str;
		if (new RegExp(`^Usage:\\s+${CLI_NAME_PATTERN}\\s+\\[options\\]\\s+\\[command\\]\\s*$`, "m").test(output) && /^Commands:/m.test(output)) output = output.replace(/^Commands:/m, `Commands:\n  ${theme.muted(ROOT_COMMANDS_HINT)}`);
		return output.replace(/^Usage:/gm, theme.heading("Usage:")).replace(/^Options:/gm, theme.heading("Options:")).replace(/^Commands:/gm, theme.heading("Commands:"));
	};
	program.configureOutput({
		writeOut: (str) => {
			process.stdout.write(formatHelpOutput(str));
		},
		writeErr: (str) => {
			process.stderr.write(formatHelpOutput(str));
		},
		outputError: (str, write) => write(theme.error(str))
	});
	if (process.argv.includes("-V") || process.argv.includes("--version") || process.argv.includes("-v")) {
		console.log(ctx.programVersion);
		process.exit(0);
	}
	program.addHelpText("beforeAll", () => {
		if (hasEmittedCliBanner()) return "";
		const rich = isRich();
		return `\n${formatCliBannerLine(ctx.programVersion, { richTty: rich })}\n`;
	});
	const fmtExamples = EXAMPLES.map(([cmd, desc]) => `  ${theme.command(replaceCliName(cmd, CLI_NAME))}\n    ${theme.muted(desc)}`).join("\n");
	program.addHelpText("afterAll", ({ command }) => {
		if (command !== program) return "";
		const docs = formatDocsLink("/cli", "docs.openclaw.ai/cli");
		return `\n${theme.heading("Examples:")}\n${fmtExamples}\n\n${theme.muted("Docs:")} ${docs}\n`;
	});
}

//#endregion
//#region src/cli/program/preaction.ts
function setProcessTitleForCommand(actionCommand) {
	let current = actionCommand;
	while (current.parent && current.parent.parent) current = current.parent;
	const name = current.name();
	const cliName = resolveCliName();
	if (!name || name === cliName) return;
	process.title = `${cliName}-${name}`;
}
const PLUGIN_REQUIRED_COMMANDS = new Set([
	"message",
	"channels",
	"directory"
]);
function registerPreActionHooks(program, programVersion) {
	program.hook("preAction", async (_thisCommand, actionCommand) => {
		setProcessTitleForCommand(actionCommand);
		const argv = process.argv;
		if (hasHelpOrVersion(argv)) return;
		const commandPath = getCommandPath(argv, 2);
		if (!(isTruthyEnvValue(process.env.OPENCLAW_HIDE_BANNER) || commandPath[0] === "update" || commandPath[0] === "completion" || commandPath[0] === "plugins" && commandPath[1] === "update")) emitCliBanner(programVersion);
		const verbose = getVerboseFlag(argv, { includeDebug: true });
		setVerbose(verbose);
		if (!verbose) process.env.NODE_NO_WARNINGS ??= "1";
		if (commandPath[0] === "doctor" || commandPath[0] === "completion") return;
		const { ensureConfigReady } = await import("./config-guard-BR5Mw-Uc.js").then((n) => n.t);
		await ensureConfigReady({
			runtime: defaultRuntime,
			commandPath
		});
		if (PLUGIN_REQUIRED_COMMANDS.has(commandPath[0])) {
			const { ensurePluginRegistryLoaded } = await import("./plugin-registry-CkKQ_Ziu.js").then((n) => n.n);
			ensurePluginRegistryLoaded();
		}
	});
}

//#endregion
//#region src/cli/program/build-program.ts
function buildProgram() {
	const program = new Command();
	const ctx = createProgramContext();
	const argv = process.argv;
	setProgramContext(program, ctx);
	configureProgramHelp(program, ctx);
	registerPreActionHooks(program, ctx.programVersion);
	registerProgramCommands(program, ctx, argv);
	return program;
}

//#endregion
export { buildProgram };