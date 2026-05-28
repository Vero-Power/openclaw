import "./accounts-Bk4ukJl2.js";
import "./registry-NFGeyJJt.js";
import "./paths-DJmOcr7Q.js";
import "./model-selection-lLjW3OfS.js";
import "./config-b_ZjXvb5.js";
import "./fs-safe-B1_uPmaf.js";
import "./subsystem-D2OSuNEb.js";
import "./agent-scope-BJVFRSpq.js";
import { i as jsonResult, l as readStringParam, o as readReactionParams, t as createActionGate } from "./common-1UfuNz24.js";
import "./chunk-Blj5xUx5.js";
import "./ssrf-3c0ma4wW.js";
import "./local-roots-nnu8NE5F.js";
import "./command-format-xicngZGC.js";
import "./normalize-Cds2ngwm.js";
import "./bindings-CrNJEHhq.js";
import "./plugins-CW-Dp-Ow.js";
import "./message-channel-3z1YKOtY.js";
import "./github-copilot-token-Dtvm_sTU.js";
import "./manifest-registry-BEaVWR6Q.js";
import "./active-listener-B1cZR9Yl.js";
import "./ir-BBztgtK0.js";
import "./markdown-tables-B7rLDX7_.js";
import "./render-CECM-RQk.js";
import { r as sendReactionWhatsApp } from "./outbound-N_qqWfNH.js";

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