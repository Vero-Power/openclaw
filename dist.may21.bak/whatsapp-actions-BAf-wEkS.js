import "./paths-Bp5uKvNR.js";
import "./registry-Bvgaapvc.js";
import "./agent-scope-BgCF8o1F.js";
import "./subsystem-CpUaXkiT.js";
import "./model-selection-DAWW2H4n.js";
import "./github-copilot-token-ttqQRqMA.js";
import "./env-Dt_p_wh1.js";
import "./normalize-B32NJIbv.js";
import "./accounts-BHw8RUGg.js";
import "./bindings-DxZP1NZp.js";
import "./plugins-DXQGpAD5.js";
import "./fs-safe-EcGbY0tj.js";
import "./message-channel-Bktmr_Jv.js";
import "./config-BhzpX3F8.js";
import "./manifest-registry-Bf0DAy9L.js";
import { i as jsonResult, l as readStringParam, o as readReactionParams, t as createActionGate } from "./common-Bdt2U8cC.js";
import "./ssrf-Cirmgays.js";
import "./chunk-B0Yfysh5.js";
import "./markdown-tables-BT2771Zz.js";
import "./local-roots-HZSoZq6A.js";
import "./ir-EcvkGaJ9.js";
import "./render-VCz3R2iL.js";
import "./active-listener-RXE9-zJX.js";
import { r as sendReactionWhatsApp } from "./outbound-B4EF64yT.js";

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