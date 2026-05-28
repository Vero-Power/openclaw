import "./auth-profiles-CiQsARKp.js";
import "./exec-CBKBIMpA.js";
import "./agent-scope-BEB0yS_L.js";
import "./github-copilot-token-DuFIqfeC.js";
import "./manifest-registry-DS2iK5AZ.js";
import "./config-BZ-sQEmh.js";
import { n as registerQrCli } from "./qr-cli-CwyP5ZoE.js";

//#region src/cli/clawbot-cli.ts
function registerClawbotCli(program) {
	registerQrCli(program.command("clawbot").description("Legacy clawbot command aliases"));
}

//#endregion
export { registerClawbotCli };