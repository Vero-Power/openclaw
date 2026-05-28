import "./auth-profiles-CiQsARKp.js";
import "./exec-CBKBIMpA.js";
import "./agent-scope-BEB0yS_L.js";
import "./github-copilot-token-DuFIqfeC.js";
import "./manifest-registry-DS2iK5AZ.js";
import "./config-BZ-sQEmh.js";
import "./message-channel-mz9U3AFl.js";
import "./normalize-G6M_Fobz.js";
import "./accounts-CWNozl33.js";
import "./bindings-BD0BDrVW.js";
import "./logging-CcxUDNcI.js";
import "./plugins-skOiRwEk.js";
import "./fs-safe-BY9kuZ3o.js";
import { a as jsonResult, n as createActionGate, s as readReactionParams, u as readStringParam } from "./common-KSoAA9JF.js";
import "./ssrf-Ixuyn7h8.js";
import "./chunk-BPK4-Aqj.js";
import "./markdown-tables-D0JGXPSu.js";
import "./fetch-guard-DKnIywH2.js";
import "./local-roots-7fFoYI9T.js";
import "./ir-DRw-k5Ij.js";
import "./render-CCLsW6Lz.js";
import "./tables-xdEB7tb_.js";
import { r as sendReactionWhatsApp } from "./outbound-D-GiAJzi.js";

//#region src/agents/tools/whatsapp-actions.ts
async function handleWhatsAppAction(params, cfg) {
	const action = readStringParam(params, "action", { required: true });
	const isActionEnabled = createActionGate(cfg.channels?.whatsapp?.actions);
	if (action === "react") {
		if (!isActionEnabled("reactions")) throw new Error("WhatsApp reactions are disabled.");
		const chatJid = readStringParam(params, "chatJid", { required: true });
		const messageId = readStringParam(params, "messageId", { required: true });
		const { emoji, remove, isEmpty } = readReactionParams(params, { removeErrorMessage: "Emoji is required to remove a WhatsApp reaction." });
		const participant = readStringParam(params, "participant");
		const accountId = readStringParam(params, "accountId");
		const fromMeRaw = params.fromMe;
		await sendReactionWhatsApp(chatJid, messageId, remove ? "" : emoji, {
			verbose: false,
			fromMe: typeof fromMeRaw === "boolean" ? fromMeRaw : void 0,
			participant: participant ?? void 0,
			accountId: accountId ?? void 0
		});
		if (!remove && !isEmpty) return jsonResult({
			ok: true,
			added: emoji
		});
		return jsonResult({
			ok: true,
			removed: true
		});
	}
	throw new Error(`Unsupported WhatsApp action: ${action}`);
}

//#endregion
export { handleWhatsAppAction };