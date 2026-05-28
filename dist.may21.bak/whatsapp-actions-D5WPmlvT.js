import "./paths-CyR9Pa1R.js";
import "./registry-BmY4gNy6.js";
import "./agent-scope-tDSbswwo.js";
import "./subsystem-B5g771Td.js";
import "./workspace-Dk7qkKmf.js";
import "./model-selection-BymXpuGc.js";
import "./github-copilot-token-Bj7xQtKK.js";
import "./env-DQUuhEFy.js";
import "./boolean-B8-BqKGQ.js";
import "./normalize-9QSaLqXI.js";
import "./accounts-CW8SvMCY.js";
import "./bindings-BAgGomn2.js";
import "./plugins-BCKDArtV.js";
import "./fs-safe-D_arMs0S.js";
import "./message-channel-BDlvrUZF.js";
import "./config-CUdAlGKZ.js";
import "./manifest-registry-Dovhiqzt.js";
import { i as jsonResult, l as readStringParam, o as readReactionParams, t as createActionGate } from "./common-B42CZ6Du.js";
import "./ssrf-B8OrDkCk.js";
import "./chunk-TRVny4T1.js";
import "./markdown-tables-B8uQVqCj.js";
import "./local-roots-C_Ncbu0N.js";
import "./ir-BwWquvcM.js";
import "./render-CDCvpfhh.js";
import "./tables-CNBcgHrq.js";
import { r as sendReactionWhatsApp } from "./outbound-BLonTbls.js";

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