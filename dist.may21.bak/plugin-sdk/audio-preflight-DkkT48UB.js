import "./accounts-Bk4ukJl2.js";
import { G as shouldLogVerbose, H as logVerbose } from "./registry-NFGeyJJt.js";
import "./paths-DJmOcr7Q.js";
import "./model-selection-lLjW3OfS.js";
import "./config-b_ZjXvb5.js";
import "./fs-safe-B1_uPmaf.js";
import "./subsystem-D2OSuNEb.js";
import "./agent-scope-BJVFRSpq.js";
import "./common-1UfuNz24.js";
import { a as resolveMediaAttachmentLocalRoots, n as createMediaAttachmentCache, o as runCapability, r as normalizeMediaAttachments, t as buildProviderRegistry, u as isAudioAttachment } from "./runner-D0wPrNbk.js";
import "./skills-q6doMiiJ.js";
import "./redact-DY2xOV8h.js";
import "./errors-DJtjmMEg.js";
import "./ssrf-3c0ma4wW.js";
import "./local-roots-nnu8NE5F.js";
import "./chrome-RdW0oOkM.js";
import "./command-format-xicngZGC.js";
import "./thinking-DZz2EesG.js";
import "./normalize-Cds2ngwm.js";
import "./bindings-CrNJEHhq.js";
import "./plugins-CW-Dp-Ow.js";
import "./message-channel-3z1YKOtY.js";
import "./pi-embedded-helpers-CMO2MYqT.js";
import "./github-copilot-token-Dtvm_sTU.js";
import "./manifest-registry-BEaVWR6Q.js";
import "./paths-CyXoO9iV.js";
import "./image-BIeEM4V_.js";
import "./pi-model-discovery-Cw_zM1Fm.js";
import "./api-key-rotation-D2PdChEW.js";

//#region src/media-understanding/audio-preflight.ts
/**
* Transcribes the first audio attachment BEFORE mention checking.
* This allows voice notes to be processed in group chats with requireMention: true.
* Returns the transcript or undefined if transcription fails or no audio is found.
*/
async function transcribeFirstAudio(params) {
	const { ctx, cfg } = params;
	const audioConfig = cfg.tools?.media?.audio;
	if (!audioConfig || audioConfig.enabled === false) return;
	const attachments = normalizeMediaAttachments(ctx);
	if (!attachments || attachments.length === 0) return;
	const firstAudio = attachments.find((att) => att && isAudioAttachment(att) && !att.alreadyTranscribed);
	if (!firstAudio) return;
	if (shouldLogVerbose()) logVerbose(`audio-preflight: transcribing attachment ${firstAudio.index} for mention check`);
	const providerRegistry = buildProviderRegistry(params.providers);
	const cache = createMediaAttachmentCache(attachments, { localPathRoots: resolveMediaAttachmentLocalRoots({
		cfg,
		ctx
	}) });
	try {
		const result = await runCapability({
			capability: "audio",
			cfg,
			ctx,
			attachments: cache,
			media: attachments,
			agentDir: params.agentDir,
			providerRegistry,
			config: audioConfig,
			activeModel: params.activeModel
		});
		if (!result || result.outputs.length === 0) return;
		const audioOutput = result.outputs.find((output) => output.kind === "audio.transcription");
		if (!audioOutput || !audioOutput.text) return;
		firstAudio.alreadyTranscribed = true;
		if (shouldLogVerbose()) logVerbose(`audio-preflight: transcribed ${audioOutput.text.length} chars from attachment ${firstAudio.index}`);
		return audioOutput.text;
	} catch (err) {
		if (shouldLogVerbose()) logVerbose(`audio-preflight: transcription failed: ${String(err)}`);
		return;
	} finally {
		await cache.cleanup();
	}
}

//#endregion
export { transcribeFirstAudio };