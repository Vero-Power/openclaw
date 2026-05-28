import "./paths-B4BZAPZh.js";
import { B as theme } from "./utils-CP9YLh6M.js";
import "./thinking-EAliFiVK.js";
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
import "./plugins-BYPsMadm.js";
import "./paths-Dm6Vfv5g.js";
import "./tool-display-Bm1i_yTj.js";
import "./commands-registry-BAFjEVRj.js";
import "./client-DdnyIhO0.js";
import "./call-CSypw845.js";
import { t as formatDocsLink } from "./links-3f6kgn7Y.js";
import { t as parseTimeoutMs } from "./parse-timeout-DuZBdKnI.js";
import { t as runTui } from "./tui-8XSDI-8b.js";

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