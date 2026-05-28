import { _ as defaultRuntime } from "./entry.js";
import "./auth-profiles-CiQsARKp.js";
import { u as normalizeMainKey } from "./session-key-BGiG_JcT.js";
import "./exec-CBKBIMpA.js";
import { d as resolveSessionAgentId } from "./agent-scope-BEB0yS_L.js";
import "./github-copilot-token-DuFIqfeC.js";
import "./model-Db-28JMH.js";
import "./pi-model-discovery-Do3xMEtM.js";
import "./frontmatter-D-YR-Ghi.js";
import "./skills-BKnaiOKI.js";
import "./manifest-registry-DS2iK5AZ.js";
import { i as loadConfig } from "./config-BZ-sQEmh.js";
import "./client-CnL59tOj.js";
import "./call-CUYAxKYv.js";
import "./message-channel-mz9U3AFl.js";
import { Qt as requestHeartbeatNow, Z as resolveOutboundTarget, dn as enqueueSystemEvent } from "./subagent-registry-vEaOpKkF.js";
import { u as updateSessionStore } from "./sessions-DR2Q7emK.js";
import "./tokens-MGcNqlE_.js";
import "./normalize-G6M_Fobz.js";
import "./accounts-CWNozl33.js";
import "./bindings-BD0BDrVW.js";
import "./logging-CcxUDNcI.js";
import "./send-Cxqp_t_q.js";
import { r as normalizeChannelId } from "./plugins-skOiRwEk.js";
import "./send-Q5mQ2dSq.js";
import "./with-timeout-C5wD-6xB.js";
import { t as deliverOutboundPayloads } from "./deliver-Ds1FsdFM.js";
import "./diagnostic-Bg3wFx-Z.js";
import "./diagnostic-session-state-DqgfGYqZ.js";
import "./accounts-Dnz84Cq6.js";
import "./send-CySDoLIX.js";
import "./fs-safe-BY9kuZ3o.js";
import "./pi-embedded-helpers-CqzGUWmo.js";
import "./sandbox-DHahf6kq.js";
import "./common-KSoAA9JF.js";
import "./chrome-B_t1ANw9.js";
import "./tailscale-BxzsxqAY.js";
import "./auth-Usar6LvN.js";
import "./server-context-D1WgVN1U.js";
import "./routes-PsuhHUg2.js";
import "./redact-ClDEZIsW.js";
import "./errors-BBDex6Nx.js";
import "./paths-CdSSbPPa.js";
import "./ssrf-Ixuyn7h8.js";
import "./store-CLY8B6p7.js";
import "./ports-Dq8ogiz4.js";
import "./trash-CWQQXWX3.js";
import "./dock-D6bGtL_y.js";
import "./accounts-DJ2NdTBm.js";
import "./paths-CHiHHmOl.js";
import "./thinking-BMF5Lj9k.js";
import "./models-config-JLYhU63Q.js";
import "./reply-prefix-B2KTDwI6.js";
import "./memory-cli-Cus9od3R.js";
import "./manager-WV9Ukl3R.js";
import "./gemini-auth-CKfS4LNU.js";
import "./sqlite-BpnzJB3x.js";
import "./retry-CnkRc4sA.js";
import "./chunk-BPK4-Aqj.js";
import "./markdown-tables-D0JGXPSu.js";
import "./fetch-guard-DKnIywH2.js";
import "./local-roots-7fFoYI9T.js";
import "./ir-DRw-k5Ij.js";
import "./render-CCLsW6Lz.js";
import "./commands-registry-Ds3AbSxg.js";
import "./image-Cj-0G0be.js";
import "./tool-display-Bv0KyUwm.js";
import "./runner-CispZDn9.js";
import "./model-catalog-pRYheRY6.js";
import { c as resolveGatewaySessionStoreTarget, o as loadSessionEntry, s as pruneLegacyStoreKeys } from "./session-utils-BcCEIdsX.js";
import "./skill-commands-D4KJCxgh.js";
import "./workspace-dirs-DVRmoVcd.js";
import "./pairing-store-BnNXa5t_.js";
import "./fetch-DhJ-elk8.js";
import "./exec-approvals-jec-Q4LG.js";
import "./nodes-screen-DacHCXz4.js";
import "./session-cost-usage-D3wNHCTs.js";
import "./pi-tools.policy-BJuTD3zW.js";
import "./control-service-CvuxiESd.js";
import "./stagger-BCQzFuQi.js";
import "./channel-selection-WbeswRpE.js";
import "./send-ocFho9JE.js";
import "./outbound-attachment-C5vYaHjf.js";
import "./delivery-queue-BTFZ_82k.js";
import "./send-C0ugNw9t.js";
import "./resolve-route-Cn3a88iy.js";
import "./channel-activity-DXoatCXN.js";
import "./tables-xdEB7tb_.js";
import "./proxy-1gf4gtkD.js";
import "./links-rnbUL9h5.js";
import "./cli-utils-f9j-_1VT.js";
import "./help-format-5GFCgEVf.js";
import "./progress-Clpi3Ckj.js";
import "./replies-e7HamCHK.js";
import "./onboard-helpers-1IVAZXr5.js";
import "./prompt-style-D7sAEM59.js";
import "./pairing-labels-CfMMR0_C.js";
import { t as createOutboundSendDeps } from "./outbound-send-deps-C6hZ49as.js";
import { c as parseMessageWithAttachments, l as formatForLog, r as registerApnsToken, s as normalizeRpcAttachmentsToChatAttachments } from "./push-apns-BZyzK2u5.js";
import { t as agentCommand } from "./agent-Cr64r5QF.js";
import { randomUUID } from "node:crypto";

//#region src/gateway/server-node-events.ts
const MAX_EXEC_EVENT_OUTPUT_CHARS = 180;
const VOICE_TRANSCRIPT_DEDUPE_WINDOW_MS = 1500;
const MAX_RECENT_VOICE_TRANSCRIPTS = 200;
const recentVoiceTranscripts = /* @__PURE__ */ new Map();
function normalizeNonEmptyString(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
function normalizeFiniteInteger(value) {
	return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}
function resolveVoiceTranscriptFingerprint(obj, text) {
	const eventId = normalizeNonEmptyString(obj.eventId) ?? normalizeNonEmptyString(obj.providerEventId) ?? normalizeNonEmptyString(obj.transcriptId);
	if (eventId) return `event:${eventId}`;
	const callId = normalizeNonEmptyString(obj.providerCallId) ?? normalizeNonEmptyString(obj.callId);
	const sequence = normalizeFiniteInteger(obj.sequence) ?? normalizeFiniteInteger(obj.seq);
	if (callId && sequence !== null) return `call-seq:${callId}:${sequence}`;
	const eventTimestamp = normalizeFiniteInteger(obj.timestamp) ?? normalizeFiniteInteger(obj.ts) ?? normalizeFiniteInteger(obj.eventTimestamp);
	if (callId && eventTimestamp !== null) return `call-ts:${callId}:${eventTimestamp}`;
	if (eventTimestamp !== null) return `timestamp:${eventTimestamp}|text:${text}`;
	return `text:${text}`;
}
function shouldDropDuplicateVoiceTranscript(params) {
	const previous = recentVoiceTranscripts.get(params.sessionKey);
	if (previous && previous.fingerprint === params.fingerprint && params.now - previous.ts <= VOICE_TRANSCRIPT_DEDUPE_WINDOW_MS) return true;
	recentVoiceTranscripts.set(params.sessionKey, {
		fingerprint: params.fingerprint,
		ts: params.now
	});
	if (recentVoiceTranscripts.size > MAX_RECENT_VOICE_TRANSCRIPTS) {
		const cutoff = params.now - VOICE_TRANSCRIPT_DEDUPE_WINDOW_MS * 2;
		for (const [key, value] of recentVoiceTranscripts) {
			if (value.ts < cutoff) recentVoiceTranscripts.delete(key);
			if (recentVoiceTranscripts.size <= MAX_RECENT_VOICE_TRANSCRIPTS) break;
		}
		while (recentVoiceTranscripts.size > MAX_RECENT_VOICE_TRANSCRIPTS) {
			const oldestKey = recentVoiceTranscripts.keys().next().value;
			if (oldestKey === void 0) break;
			recentVoiceTranscripts.delete(oldestKey);
		}
	}
	return false;
}
function compactExecEventOutput(raw) {
	const normalized = raw.replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	if (normalized.length <= MAX_EXEC_EVENT_OUTPUT_CHARS) return normalized;
	const safe = Math.max(1, MAX_EXEC_EVENT_OUTPUT_CHARS - 1);
	return `${normalized.slice(0, safe)}…`;
}
async function touchSessionStore(params) {
	const { storePath } = params;
	if (!storePath) return;
	await updateSessionStore(storePath, (store) => {
		const target = resolveGatewaySessionStoreTarget({
			cfg: params.cfg,
			key: params.sessionKey,
			store
		});
		pruneLegacyStoreKeys({
			store,
			canonicalKey: target.canonicalKey,
			candidates: target.storeKeys
		});
		store[params.canonicalKey] = {
			sessionId: params.sessionId,
			updatedAt: params.now,
			thinkingLevel: params.entry?.thinkingLevel,
			verboseLevel: params.entry?.verboseLevel,
			reasoningLevel: params.entry?.reasoningLevel,
			systemSent: params.entry?.systemSent,
			sendPolicy: params.entry?.sendPolicy,
			lastChannel: params.entry?.lastChannel,
			lastTo: params.entry?.lastTo
		};
	});
}
function queueSessionStoreTouch(params) {
	touchSessionStore({
		cfg: params.cfg,
		sessionKey: params.sessionKey,
		storePath: params.storePath,
		canonicalKey: params.canonicalKey,
		entry: params.entry,
		sessionId: params.sessionId,
		now: params.now
	}).catch((err) => {
		params.ctx.logGateway.warn("voice session-store update failed: " + formatForLog(err));
	});
}
function parseSessionKeyFromPayloadJSON(payloadJSON) {
	let payload;
	try {
		payload = JSON.parse(payloadJSON);
	} catch {
		return null;
	}
	if (typeof payload !== "object" || payload === null) return null;
	const obj = payload;
	const sessionKey = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
	return sessionKey.length > 0 ? sessionKey : null;
}
async function sendReceiptAck(params) {
	const resolved = resolveOutboundTarget({
		channel: params.channel,
		to: params.to,
		cfg: params.cfg,
		mode: "explicit"
	});
	if (!resolved.ok) throw new Error(String(resolved.error));
	const agentId = resolveSessionAgentId({
		sessionKey: params.sessionKey,
		config: params.cfg
	});
	await deliverOutboundPayloads({
		cfg: params.cfg,
		channel: params.channel,
		to: resolved.to,
		payloads: [{ text: params.text }],
		agentId,
		bestEffort: true,
		deps: createOutboundSendDeps(params.deps)
	});
}
const handleNodeEvent = async (ctx, nodeId, evt) => {
	switch (evt.event) {
		case "voice.transcript": {
			if (!evt.payloadJSON) return;
			let payload;
			try {
				payload = JSON.parse(evt.payloadJSON);
			} catch {
				return;
			}
			const obj = typeof payload === "object" && payload !== null ? payload : {};
			const text = typeof obj.text === "string" ? obj.text.trim() : "";
			if (!text) return;
			if (text.length > 2e4) return;
			const sessionKeyRaw = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
			const cfg = loadConfig();
			const rawMainKey = normalizeMainKey(cfg.session?.mainKey);
			const sessionKey = sessionKeyRaw.length > 0 ? sessionKeyRaw : rawMainKey;
			const { storePath, entry, canonicalKey } = loadSessionEntry(sessionKey);
			const now = Date.now();
			if (shouldDropDuplicateVoiceTranscript({
				sessionKey: canonicalKey,
				fingerprint: resolveVoiceTranscriptFingerprint(obj, text),
				now
			})) return;
			const sessionId = entry?.sessionId ?? randomUUID();
			queueSessionStoreTouch({
				ctx,
				cfg,
				sessionKey,
				storePath,
				canonicalKey,
				entry,
				sessionId,
				now
			});
			ctx.addChatRun(sessionId, {
				sessionKey: canonicalKey,
				clientRunId: `voice-${randomUUID()}`
			});
			agentCommand({
				message: text,
				sessionId,
				sessionKey: canonicalKey,
				thinking: "low",
				deliver: false,
				messageChannel: "node",
				inputProvenance: {
					kind: "external_user",
					sourceChannel: "voice",
					sourceTool: "gateway.voice.transcript"
				}
			}, defaultRuntime, ctx.deps).catch((err) => {
				ctx.logGateway.warn(`agent failed node=${nodeId}: ${formatForLog(err)}`);
			});
			return;
		}
		case "agent.request": {
			if (!evt.payloadJSON) return;
			let link = null;
			try {
				link = JSON.parse(evt.payloadJSON);
			} catch {
				return;
			}
			let message = (link?.message ?? "").trim();
			const normalizedAttachments = normalizeRpcAttachmentsToChatAttachments(link?.attachments ?? void 0);
			let images = [];
			if (normalizedAttachments.length > 0) try {
				const parsed = await parseMessageWithAttachments(message, normalizedAttachments, {
					maxBytes: 5e6,
					log: ctx.logGateway
				});
				message = parsed.message.trim();
				images = parsed.images;
			} catch {
				return;
			}
			if (!message) return;
			if (message.length > 2e4) return;
			let channel = normalizeChannelId(typeof link?.channel === "string" ? link.channel.trim() : "") ?? void 0;
			let to = typeof link?.to === "string" && link.to.trim() ? link.to.trim() : void 0;
			const deliverRequested = Boolean(link?.deliver);
			const wantsReceipt = Boolean(link?.receipt);
			const receiptText = (typeof link?.receiptText === "string" ? link.receiptText.trim() : "") || "Just received your iOS share + request, working on it.";
			const sessionKeyRaw = (link?.sessionKey ?? "").trim();
			const sessionKey = sessionKeyRaw.length > 0 ? sessionKeyRaw : `node-${nodeId}`;
			const cfg = loadConfig();
			const { storePath, entry, canonicalKey } = loadSessionEntry(sessionKey);
			const now = Date.now();
			const sessionId = entry?.sessionId ?? randomUUID();
			await touchSessionStore({
				cfg,
				sessionKey,
				storePath,
				canonicalKey,
				entry,
				sessionId,
				now
			});
			if (deliverRequested && (!channel || !to)) {
				const entryChannel = typeof entry?.lastChannel === "string" ? normalizeChannelId(entry.lastChannel) : void 0;
				const entryTo = typeof entry?.lastTo === "string" ? entry.lastTo.trim() : "";
				if (!channel && entryChannel) channel = entryChannel;
				if (!to && entryTo) to = entryTo;
			}
			const deliver = deliverRequested && Boolean(channel && to);
			const deliveryChannel = deliver ? channel : void 0;
			const deliveryTo = deliver ? to : void 0;
			if (deliverRequested && !deliver) ctx.logGateway.warn(`agent delivery disabled node=${nodeId}: missing session delivery route (channel=${channel ?? "-"} to=${to ?? "-"})`);
			if (wantsReceipt && deliveryChannel && deliveryTo) sendReceiptAck({
				cfg,
				deps: ctx.deps,
				sessionKey: canonicalKey,
				channel: deliveryChannel,
				to: deliveryTo,
				text: receiptText
			}).catch((err) => {
				ctx.logGateway.warn(`agent receipt failed node=${nodeId}: ${formatForLog(err)}`);
			});
			else if (wantsReceipt) ctx.logGateway.warn(`agent receipt skipped node=${nodeId}: missing delivery route (channel=${deliveryChannel ?? "-"} to=${deliveryTo ?? "-"})`);
			agentCommand({
				message,
				images,
				sessionId,
				sessionKey: canonicalKey,
				thinking: link?.thinking ?? void 0,
				deliver,
				to: deliveryTo,
				channel: deliveryChannel,
				timeout: typeof link?.timeoutSeconds === "number" ? link.timeoutSeconds.toString() : void 0,
				messageChannel: "node"
			}, defaultRuntime, ctx.deps).catch((err) => {
				ctx.logGateway.warn(`agent failed node=${nodeId}: ${formatForLog(err)}`);
			});
			return;
		}
		case "chat.subscribe": {
			if (!evt.payloadJSON) return;
			const sessionKey = parseSessionKeyFromPayloadJSON(evt.payloadJSON);
			if (!sessionKey) return;
			ctx.nodeSubscribe(nodeId, sessionKey);
			return;
		}
		case "chat.unsubscribe": {
			if (!evt.payloadJSON) return;
			const sessionKey = parseSessionKeyFromPayloadJSON(evt.payloadJSON);
			if (!sessionKey) return;
			ctx.nodeUnsubscribe(nodeId, sessionKey);
			return;
		}
		case "exec.started":
		case "exec.finished":
		case "exec.denied": {
			if (!evt.payloadJSON) return;
			let payload;
			try {
				payload = JSON.parse(evt.payloadJSON);
			} catch {
				return;
			}
			const obj = typeof payload === "object" && payload !== null ? payload : {};
			const sessionKey = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : `node-${nodeId}`;
			if (!sessionKey) return;
			const runId = typeof obj.runId === "string" ? obj.runId.trim() : "";
			const command = typeof obj.command === "string" ? obj.command.trim() : "";
			const exitCode = typeof obj.exitCode === "number" && Number.isFinite(obj.exitCode) ? obj.exitCode : void 0;
			const timedOut = obj.timedOut === true;
			const output = typeof obj.output === "string" ? obj.output.trim() : "";
			const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
			let text = "";
			if (evt.event === "exec.started") {
				text = `Exec started (node=${nodeId}${runId ? ` id=${runId}` : ""})`;
				if (command) text += `: ${command}`;
			} else if (evt.event === "exec.finished") {
				const exitLabel = timedOut ? "timeout" : `code ${exitCode ?? "?"}`;
				const compactOutput = compactExecEventOutput(output);
				if (!(timedOut || exitCode !== 0 || compactOutput.length > 0)) return;
				text = `Exec finished (node=${nodeId}${runId ? ` id=${runId}` : ""}, ${exitLabel})`;
				if (compactOutput) text += `\n${compactOutput}`;
			} else {
				text = `Exec denied (node=${nodeId}${runId ? ` id=${runId}` : ""}${reason ? `, ${reason}` : ""})`;
				if (command) text += `: ${command}`;
			}
			enqueueSystemEvent(text, {
				sessionKey,
				contextKey: runId ? `exec:${runId}` : "exec"
			});
			requestHeartbeatNow({ reason: "exec-event" });
			return;
		}
		case "push.apns.register": {
			if (!evt.payloadJSON) return;
			let payload;
			try {
				payload = JSON.parse(evt.payloadJSON);
			} catch {
				return;
			}
			const obj = typeof payload === "object" && payload !== null ? payload : {};
			const token = typeof obj.token === "string" ? obj.token : "";
			const topic = typeof obj.topic === "string" ? obj.topic : "";
			const environment = obj.environment;
			try {
				await registerApnsToken({
					nodeId,
					token,
					topic,
					environment
				});
			} catch (err) {
				ctx.logGateway.warn(`push apns register failed node=${nodeId}: ${formatForLog(err)}`);
			}
			return;
		}
		default: return;
	}
};

//#endregion
export { handleNodeEvent };