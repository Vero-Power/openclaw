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
import "./fs-safe-Blsk2yxR.js";
import { a as jsonResult, n as createActionGate, s as readReactionParams, u as readStringParam } from "./common-e59nG5-8.js";
import "./ssrf-D_txTSjg.js";
import "./message-channel-C_zlq96e.js";
import "./normalize-CTvuSHF1.js";
import "./accounts-smfqJdRz.js";
import "./bindings-CR1uT82M.js";
import "./logging-CZCkEw2g.js";
import "./plugins-BYPsMadm.js";
import "./fetch-guard-C4dqYseW.js";
import "./local-roots-B3ruZNdZ.js";
import "./chunk-ChwUDl2i.js";
import "./markdown-tables-D8bZ34ct.js";
import "./ir-B2WYP3JC.js";
import "./render-CJl4GK1B.js";
import "./tables-BXbYKMMU.js";
import { r as sendReactionWhatsApp } from "./outbound-B9Qt8mLc.js";

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