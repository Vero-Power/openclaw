import "./paths-B4BZAPZh.js";
import { F as shouldLogVerbose, M as logVerbose } from "./utils-CP9YLh6M.js";
import "./thinking-EAliFiVK.js";
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
import { a as resolveMediaAttachmentLocalRoots, n as createMediaAttachmentCache, o as runCapability, r as normalizeMediaAttachments, s as isAudioAttachment, t as buildProviderRegistry } from "./runner-C7hM9HBS.js";
import "./image-D0vq23FW.js";
import "./models-config-D6nMAC_H.js";
import "./pi-model-discovery-DaNAekda.js";
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
import "./fetch-guard-C4dqYseW.js";
import "./api-key-rotation-BaJQuxyG.js";
import "./local-roots-B3ruZNdZ.js";
import "./model-catalog-DC7jChRr.js";

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