import "./paths-B4BZAPZh.js";
import "./utils-CP9YLh6M.js";
import "./registry-B-j4DRfe.js";
import "./subsystem-BCQGGxdd.js";
import "./exec-DYqRzFbo.js";
import "./agent-scope-BZLOCEiY.js";
import "./model-selection-ynGV0Z-S.js";
import "./github-copilot-token-D2zp6kMZ.js";
import "./boolean-BsqeuxE6.js";
import "./env-VriqyjXT.js";
import "./config-DtbRlmRZ.js";
import "./manifest-registry-C_GIiKba.js";
import { n as registerQrCli } from "./qr-cli-CSGxYehG.js";

//#region src/cli/clawbot-cli.ts
function registerClawbotCli(program) {
	registerQrCli(program.command("clawbot").description("Legacy clawbot command aliases"));
}

//#endregion
export { registerClawbotCli };