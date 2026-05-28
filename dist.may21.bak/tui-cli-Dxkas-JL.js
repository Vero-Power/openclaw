import { Dt as theme, _ as defaultRuntime } from "./entry.js";
import "./auth-profiles-CiQsARKp.js";
import "./exec-CBKBIMpA.js";
import "./agent-scope-BEB0yS_L.js";
import "./github-copilot-token-DuFIqfeC.js";
import "./frontmatter-D-YR-Ghi.js";
import "./skills-BKnaiOKI.js";
import "./manifest-registry-DS2iK5AZ.js";
import "./config-BZ-sQEmh.js";
import "./client-CnL59tOj.js";
import "./call-CUYAxKYv.js";
import "./message-channel-mz9U3AFl.js";
import "./sessions-DR2Q7emK.js";
import "./normalize-G6M_Fobz.js";
import "./accounts-CWNozl33.js";
import "./bindings-BD0BDrVW.js";
import "./logging-CcxUDNcI.js";
import "./plugins-skOiRwEk.js";
import "./accounts-Dnz84Cq6.js";
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
import "./commands-registry-Ds3AbSxg.js";
import "./tool-display-Bv0KyUwm.js";
import { t as parseTimeoutMs } from "./parse-timeout-kGl8Fsas.js";
import { t as formatDocsLink } from "./links-rnbUL9h5.js";
import { t as runTui } from "./tui-vU1KMjKy.js";

//#region src/cli/tui-cli.ts
function registerTuiCli(program) {
	program.command("tui").description("Open a terminal UI connected to the Gateway").option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)").option("--token <token>", "Gateway token (if required)").option("--password <password>", "Gateway password (if required)").option("--session <key>", "Session key (default: \"main\", or \"global\" when scope is global)").option("--deliver", "Deliver assistant replies", false).option("--thinking <level>", "Thinking level override").option("--message <text>", "Send an initial message after connecting").option("--timeout-ms <ms>", "Agent timeout in ms (defaults to agents.defaults.timeoutSeconds)").option("--history-limit <n>", "History entries to load", "200").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/tui", "docs.openclaw.ai/cli/tui")}\n`).action(async (opts) => {
		try {
			const timeoutMs = parseTimeoutMs(opts.timeoutMs);
			if (opts.timeoutMs !== void 0 && timeoutMs === void 0) defaultRuntime.error(`warning: invalid --timeout-ms "${String(opts.timeoutMs)}"; ignoring`);
			const historyLimit = Number.parseInt(String(opts.historyLimit ?? "200"), 10);
			await runTui({
				url: opts.url,
				token: opts.token,
				password: opts.password,
				session: opts.session,
				deliver: Boolean(opts.deliver),
				thinking: opts.thinking,
				message: opts.message,
				timeoutMs,
				historyLimit: Number.isNaN(historyLimit) ? void 0 : historyLimit
			});
		} catch (err) {
			defaultRuntime.error(String(err));
			defaultRuntime.exit(1);
		}
	});
}

//#endregion
export { registerTuiCli };