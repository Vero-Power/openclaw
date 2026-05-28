import "./paths-CyR9Pa1R.js";
import { J as logVerbose, Z as shouldLogVerbose } from "./registry-BmY4gNy6.js";
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
import "./accounts-B9r_l5f8.js";
import "./fs-safe-D_arMs0S.js";
import "./pi-model-discovery-C-yOXpma.js";
import "./message-channel-BDlvrUZF.js";
import "./pi-embedded-helpers-CZPCpjWM.js";
import "./config-CUdAlGKZ.js";
import "./manifest-registry-Dovhiqzt.js";
import "./common-B42CZ6Du.js";
import "./chrome-BL-05-L_.js";
import "./frontmatter-BT4H5SZG.js";
import "./skills-mtulzV5-.js";
import "./redact-BBbIZgau.js";
import "./errors-3KjSwJLH.js";
import "./ssrf-B8OrDkCk.js";
import "./store-D1jTTPiR.js";
import "./thinking-BUgeNpj0.js";
import "./accounts-B__OkEez.js";
import "./paths-gnW-md4M.js";
import "./image-ClJrgwhy.js";
import "./gemini-auth-BRIL0wJL.js";
import "./local-roots-C_Ncbu0N.js";
import { a as resolveMediaAttachmentLocalRoots, n as createMediaAttachmentCache, o as runCapability, r as normalizeMediaAttachments, t as buildProviderRegistry, u as isAudioAttachment } from "./runner-CvPKojiN.js";

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