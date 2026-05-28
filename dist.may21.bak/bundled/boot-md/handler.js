import "../../paths-CyR9Pa1R.js";
import { d as resolveAgentIdFromSessionKey, l as normalizeAgentId, u as normalizeMainKey } from "../../session-key-CgcjHuX_.js";
import { b as isGatewayStartupEvent, r as DEFAULT_CHAT_CHANNEL } from "../../registry-BmY4gNy6.js";
import { a as resolveAgentModelPrimary, l as resolveEffectiveModelFallbacks, o as resolveAgentSkillsFilter, r as resolveAgentDir, s as resolveAgentWorkspaceDir, t as listAgentIds, u as resolveSessionAgentId } from "../../agent-scope-tDSbswwo.js";
import { r as defaultRuntime, t as createSubsystemLogger } from "../../subsystem-B5g771Td.js";
import { l as ensureAgentWorkspace } from "../../workspace-Dk7qkKmf.js";
import { $ as DEFAULT_PROVIDER, Q as DEFAULT_MODEL, U as ensureAuthProfileStore, Z as DEFAULT_CONTEXT_TOKENS, a as isCliProvider, m as resolveThinkingDefault, o as modelKey, s as normalizeModelRef, t as buildAllowedModelSet, u as resolveConfiguredModelRef } from "../../model-selection-BymXpuGc.js";
import "../../github-copilot-token-Bj7xQtKK.js";
import { n as formatCliCommand } from "../../env-DQUuhEFy.js";
import "../../boolean-B8-BqKGQ.js";
import { n as SILENT_REPLY_TOKEN } from "../../tokens-BhwtSzyC.js";
import { A as applyModelOverrideToSessionEntry, D as resolveSendPolicy, G as registerAgentRunContext, H as resolveAgentTimeoutMs, O as lookupContextTokens, T as hasNonzeroUsage, U as clearAgentRunContext, W as emitAgentEvent, _ as resolveOutboundTarget, b as AGENT_LANE_NESTED, g as runCliAgent, h as setCliSessionId, j as applyVerboseOverride, k as clearSessionAuthProfileOverride, m as getCliSessionId, t as runEmbeddedPiAgent, v as resolveSessionDeliveryTarget, w as deriveSessionTotalTokens, x as AGENT_LANE_SUBAGENT, y as runWithModelFallback } from "../../pi-embedded-D2RkRF84.js";
import "../../normalize-9QSaLqXI.js";
import "../../accounts-CW8SvMCY.js";
import "../../bindings-BAgGomn2.js";
import "../../send-BOTas2-1.js";
import { r as normalizeChannelId, t as getChannelPlugin } from "../../plugins-BCKDArtV.js";
import "../../send-CUiykMpg.js";
import { a as normalizeOutboundPayloadsForJson, i as normalizeOutboundPayloads, r as formatOutboundPayloadLog, t as deliverOutboundPayloads } from "../../deliver-DAcrXq1Q.js";
import "../../diagnostic-CMUtW1Mq.js";
import "../../diagnostic-session-state-C0Sxjfox.js";
import "../../accounts-B9r_l5f8.js";
import "../../send-BUt-rhoR.js";
import "../../fs-safe-D_arMs0S.js";
import "../../pi-model-discovery-C-yOXpma.js";
import { i as isInternalMessageChannel, l as resolveMessageChannel, n as isDeliverableMessageChannel, r as isGatewayMessageChannel, s as normalizeMessageChannel, t as INTERNAL_MESSAGE_CHANNEL } from "../../message-channel-BDlvrUZF.js";
import { $ as normalizeAccountId, B as loadSessionStore, W as updateSessionStore, _t as resolveAgentMainSessionKey, ct as resolveSessionKey, dt as resolveSessionResetPolicy, ft as resolveSessionResetType, lt as evaluateSessionFreshness, ut as resolveChannelResetConfig, vt as resolveExplicitAgentSessionKey, yt as resolveMainSessionKey } from "../../pi-embedded-helpers-CZPCpjWM.js";
import { n as loadConfig } from "../../config-CUdAlGKZ.js";
import "../../manifest-registry-Dovhiqzt.js";
import "../../common-B42CZ6Du.js";
import "../../chrome-BL-05-L_.js";
import "../../frontmatter-BT4H5SZG.js";
import { n as buildWorkspaceSkillSnapshot } from "../../skills-mtulzV5-.js";
import "../../redact-BBbIZgau.js";
import "../../errors-3KjSwJLH.js";
import "../../ssrf-B8OrDkCk.js";
import "../../store-D1jTTPiR.js";
import { c as normalizeVerboseLevel, n as formatXHighModelHint, o as normalizeThinkLevel, t as formatThinkingLevels, u as supportsXHighThinking } from "../../thinking-BUgeNpj0.js";
import "../../accounts-B__OkEez.js";
import { n as resolveSessionFilePath, s as resolveStorePath } from "../../paths-gnW-md4M.js";
import "../../image-ClJrgwhy.js";
import "../../reply-prefix-C04eF9J1.js";
import "../../manager-C6xOFvrp.js";
import "../../gemini-auth-BRIL0wJL.js";
import "../../sqlite-DsF9bHNX.js";
import "../../retry-BxB_D6Pn.js";
import "../../chunk-TRVny4T1.js";
import "../../markdown-tables-B8uQVqCj.js";
import "../../local-roots-C_Ncbu0N.js";
import "../../ir-BwWquvcM.js";
import "../../render-CDCvpfhh.js";
import "../../commands-registry-DvUlqrF0.js";
import { c as loadModelCatalog } from "../../runner-CvPKojiN.js";
import { c as getSkillsSnapshotVersion, o as getRemoteSkillEligibility } from "../../skill-commands-BTGJIdbT.js";
import "../../fetch-DtI0mtzx.js";
import "../../send-CrH-hRWc.js";
import "../../outbound-attachment-CxVnjJuZ.js";
import "../../send-HRN5K3xk.js";
import "../../resolve-route-DL2wvbM8.js";
import "../../channel-activity-LT3oBvO7.js";
import "../../tables-CNBcgHrq.js";
import "../../proxy-CBJ1upuz.js";
import "../../replies-CkNW_Mj3.js";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

//#region src/cli/deps.ts
function createDefaultDeps() {
	return {
		sendMessageWhatsApp: async (...args) => {
			const { sendMessageWhatsApp } = await import("../../web-LZZmMxtT.js");
			return await sendMessageWhatsApp(...args);
		},
		sendMessageTelegram: async (...args) => {
			const { sendMessageTelegram } = await import("../../send-BUt-rhoR.js").then((n) => n.l);
			return await sendMessageTelegram(...args);
		},
		sendMessageDiscord: async (...args) => {
			const { sendMessageDiscord } = await import("../../send-CUiykMpg.js").then((n) => n.t);
			return await sendMessageDiscord(...args);
		},
		sendMessageSlack: async (...args) => {
			const { sendMessageSlack } = await import("../../send-BOTas2-1.js").then((n) => n.n);
			return await sendMessageSlack(...args);
		},
		sendMessageSignal: async (...args) => {
			const { sendMessageSignal } = await import("../../send-CrH-hRWc.js").then((n) => n.i);
			return await sendMessageSignal(...args);
		},
		sendMessageIMessage: async (...args) => {
			const { sendMessageIMessage } = await import("../../send-HRN5K3xk.js").then((n) => n.n);
			return await sendMessageIMessage(...args);
		}
	};
}

//#endregion
//#region src/cli/outbound-send-deps.ts
function createOutboundSendDeps(deps) {
	return {
		sendWhatsApp: deps.sendMessageWhatsApp,
		sendTelegram: deps.sendMessageTelegram,
		sendDiscord: deps.sendMessageDiscord,
		sendSlack: deps.sendMessageSlack,
		sendSignal: deps.sendMessageSignal,
		sendIMessage: deps.sendMessageIMessage
	};
}

//#endregion
//#region src/infra/outbound/agent-delivery.ts
function resolveAgentDeliveryPlan(params) {
	const requestedRaw = typeof params.requestedChannel === "string" ? params.requestedChannel.trim() : "";
	const requestedChannel = (requestedRaw ? normalizeMessageChannel(requestedRaw) : void 0) || "last";
	const explicitTo = typeof params.explicitTo === "string" && params.explicitTo.trim() ? params.explicitTo.trim() : void 0;
	const baseDelivery = resolveSessionDeliveryTarget({
		entry: params.sessionEntry,
		requestedChannel: requestedChannel === INTERNAL_MESSAGE_CHANNEL ? "last" : requestedChannel,
		explicitTo,
		explicitThreadId: params.explicitThreadId
	});
	const resolvedChannel = (() => {
		if (requestedChannel === INTERNAL_MESSAGE_CHANNEL) return INTERNAL_MESSAGE_CHANNEL;
		if (requestedChannel === "last") {
			if (baseDelivery.channel && baseDelivery.channel !== INTERNAL_MESSAGE_CHANNEL) return baseDelivery.channel;
			return params.wantsDelivery ? DEFAULT_CHAT_CHANNEL : INTERNAL_MESSAGE_CHANNEL;
		}
		if (isGatewayMessageChannel(requestedChannel)) return requestedChannel;
		if (baseDelivery.channel && baseDelivery.channel !== INTERNAL_MESSAGE_CHANNEL) return baseDelivery.channel;
		return params.wantsDelivery ? DEFAULT_CHAT_CHANNEL : INTERNAL_MESSAGE_CHANNEL;
	})();
	const deliveryTargetMode = explicitTo ? "explicit" : isDeliverableMessageChannel(resolvedChannel) ? "implicit" : void 0;
	const resolvedAccountId = normalizeAccountId(params.accountId) ?? (deliveryTargetMode === "implicit" ? baseDelivery.accountId : void 0);
	let resolvedTo = explicitTo;
	if (!resolvedTo && isDeliverableMessageChannel(resolvedChannel) && resolvedChannel === baseDelivery.lastChannel) resolvedTo = baseDelivery.lastTo;
	return {
		baseDelivery,
		resolvedChannel,
		resolvedTo,
		resolvedAccountId,
		resolvedThreadId: baseDelivery.threadId,
		deliveryTargetMode
	};
}
function resolveAgentOutboundTarget(params) {
	const targetMode = params.targetMode ?? params.plan.deliveryTargetMode ?? (params.plan.resolvedTo ? "explicit" : "implicit");
	if (!isDeliverableMessageChannel(params.plan.resolvedChannel)) return {
		resolvedTarget: null,
		resolvedTo: params.plan.resolvedTo,
		targetMode
	};
	if (params.validateExplicitTarget !== true && params.plan.resolvedTo) return {
		resolvedTarget: null,
		resolvedTo: params.plan.resolvedTo,
		targetMode
	};
	const resolvedTarget = resolveOutboundTarget({
		channel: params.plan.resolvedChannel,
		to: params.plan.resolvedTo,
		cfg: params.cfg,
		accountId: params.plan.resolvedAccountId,
		mode: targetMode
	});
	return {
		resolvedTarget,
		resolvedTo: resolvedTarget.ok ? resolvedTarget.to : params.plan.resolvedTo,
		targetMode
	};
}

//#endregion
//#region src/infra/outbound/envelope.ts
const isOutboundPayloadJson = (payload) => "mediaUrl" in payload;
function buildOutboundResultEnvelope(params) {
	const hasPayloads = params.payloads !== void 0;
	const payloads = params.payloads === void 0 ? void 0 : params.payloads.length === 0 ? [] : isOutboundPayloadJson(params.payloads[0]) ? params.payloads : normalizeOutboundPayloadsForJson(params.payloads);
	if (params.flattenDelivery !== false && params.delivery && !params.meta && !hasPayloads) return params.delivery;
	return {
		...hasPayloads ? { payloads } : {},
		...params.meta ? { meta: params.meta } : {},
		...params.delivery ? { delivery: params.delivery } : {}
	};
}

//#endregion
//#region src/commands/agent/delivery.ts
const NESTED_LOG_PREFIX = "[agent:nested]";
function formatNestedLogPrefix(opts) {
	const parts = [NESTED_LOG_PREFIX];
	const session = opts.sessionKey ?? opts.sessionId;
	if (session) parts.push(`session=${session}`);
	if (opts.runId) parts.push(`run=${opts.runId}`);
	const channel = opts.messageChannel ?? opts.channel;
	if (channel) parts.push(`channel=${channel}`);
	if (opts.to) parts.push(`to=${opts.to}`);
	if (opts.accountId) parts.push(`account=${opts.accountId}`);
	return parts.join(" ");
}
function logNestedOutput(runtime, opts, output) {
	const prefix = formatNestedLogPrefix(opts);
	for (const line of output.split(/\r?\n/)) {
		if (!line) continue;
		runtime.log(`${prefix} ${line}`);
	}
}
async function deliverAgentCommandResult(params) {
	const { cfg, deps, runtime, opts, sessionEntry, payloads, result } = params;
	const deliver = opts.deliver === true;
	const bestEffortDeliver = opts.bestEffortDeliver === true;
	const deliveryPlan = resolveAgentDeliveryPlan({
		sessionEntry,
		requestedChannel: opts.replyChannel ?? opts.channel,
		explicitTo: opts.replyTo ?? opts.to,
		explicitThreadId: opts.threadId,
		accountId: opts.replyAccountId ?? opts.accountId,
		wantsDelivery: deliver
	});
	const deliveryChannel = deliveryPlan.resolvedChannel;
	const deliveryPlugin = !isInternalMessageChannel(deliveryChannel) ? getChannelPlugin(normalizeChannelId(deliveryChannel) ?? deliveryChannel) : void 0;
	const isDeliveryChannelKnown = isInternalMessageChannel(deliveryChannel) || Boolean(deliveryPlugin);
	const targetMode = opts.deliveryTargetMode ?? deliveryPlan.deliveryTargetMode ?? (opts.to ? "explicit" : "implicit");
	const resolvedAccountId = deliveryPlan.resolvedAccountId;
	const resolved = deliver && isDeliveryChannelKnown && deliveryChannel ? resolveAgentOutboundTarget({
		cfg,
		plan: deliveryPlan,
		targetMode,
		validateExplicitTarget: true
	}) : {
		resolvedTarget: null,
		resolvedTo: deliveryPlan.resolvedTo,
		targetMode
	};
	const resolvedTarget = resolved.resolvedTarget;
	const deliveryTarget = resolved.resolvedTo;
	const resolvedThreadId = deliveryPlan.resolvedThreadId ?? opts.threadId;
	const resolvedReplyToId = deliveryChannel === "slack" && resolvedThreadId != null ? String(resolvedThreadId) : void 0;
	const resolvedThreadTarget = deliveryChannel === "slack" ? void 0 : resolvedThreadId;
	const logDeliveryError = (err) => {
		const message = `Delivery failed (${deliveryChannel}${deliveryTarget ? ` to ${deliveryTarget}` : ""}): ${String(err)}`;
		runtime.error?.(message);
		if (!runtime.error) runtime.log(message);
	};
	if (deliver) {
		if (!isDeliveryChannelKnown) {
			const err = /* @__PURE__ */ new Error(`Unknown channel: ${deliveryChannel}`);
			if (!bestEffortDeliver) throw err;
			logDeliveryError(err);
		} else if (resolvedTarget && !resolvedTarget.ok) {
			if (!bestEffortDeliver) throw resolvedTarget.error;
			logDeliveryError(resolvedTarget.error);
		}
	}
	const normalizedPayloads = normalizeOutboundPayloadsForJson(payloads ?? []);
	if (opts.json) {
		runtime.log(JSON.stringify(buildOutboundResultEnvelope({
			payloads: normalizedPayloads,
			meta: result.meta
		}), null, 2));
		if (!deliver) return {
			payloads: normalizedPayloads,
			meta: result.meta
		};
	}
	if (!payloads || payloads.length === 0) {
		runtime.log("No reply from agent.");
		return {
			payloads: [],
			meta: result.meta
		};
	}
	const deliveryPayloads = normalizeOutboundPayloads(payloads);
	const logPayload = (payload) => {
		if (opts.json) return;
		const output = formatOutboundPayloadLog(payload);
		if (!output) return;
		if (opts.lane === AGENT_LANE_NESTED) {
			logNestedOutput(runtime, opts, output);
			return;
		}
		runtime.log(output);
	};
	if (!deliver) for (const payload of deliveryPayloads) logPayload(payload);
	if (deliver && deliveryChannel && !isInternalMessageChannel(deliveryChannel)) {
		if (deliveryTarget) await deliverOutboundPayloads({
			cfg,
			channel: deliveryChannel,
			to: deliveryTarget,
			accountId: resolvedAccountId,
			payloads: deliveryPayloads,
			agentId: opts.agentId ?? (opts.sessionKey ? resolveSessionAgentId({
				sessionKey: opts.sessionKey,
				config: cfg
			}) : void 0),
			replyToId: resolvedReplyToId ?? null,
			threadId: resolvedThreadTarget ?? null,
			bestEffort: bestEffortDeliver,
			onError: (err) => logDeliveryError(err),
			onPayload: logPayload,
			deps: createOutboundSendDeps(deps)
		});
	}
	return {
		payloads: normalizedPayloads,
		meta: result.meta
	};
}

//#endregion
//#region src/commands/agent/run-context.ts
function resolveAgentRunContext(opts) {
	const merged = opts.runContext ? { ...opts.runContext } : {};
	const normalizedChannel = resolveMessageChannel(merged.messageChannel ?? opts.messageChannel, opts.replyChannel ?? opts.channel);
	if (normalizedChannel) merged.messageChannel = normalizedChannel;
	const normalizedAccountId = normalizeAccountId(merged.accountId ?? opts.accountId);
	if (normalizedAccountId) merged.accountId = normalizedAccountId;
	const groupId = (merged.groupId ?? opts.groupId)?.toString().trim();
	if (groupId) merged.groupId = groupId;
	const groupChannel = (merged.groupChannel ?? opts.groupChannel)?.toString().trim();
	if (groupChannel) merged.groupChannel = groupChannel;
	const groupSpace = (merged.groupSpace ?? opts.groupSpace)?.toString().trim();
	if (groupSpace) merged.groupSpace = groupSpace;
	if (merged.currentThreadTs == null && opts.threadId != null && opts.threadId !== "" && opts.threadId !== null) merged.currentThreadTs = String(opts.threadId);
	if (!merged.currentChannelId && opts.to) {
		const trimmedTo = opts.to.trim();
		if (trimmedTo) merged.currentChannelId = trimmedTo;
	}
	return merged;
}

//#endregion
//#region src/commands/agent/session-store.ts
async function updateSessionStoreAfterAgentRun(params) {
	const { cfg, sessionId, sessionKey, storePath, sessionStore, defaultProvider, defaultModel, fallbackProvider, fallbackModel, result } = params;
	const usage = result.meta.agentMeta?.usage;
	const promptTokens = result.meta.agentMeta?.promptTokens;
	const compactionsThisRun = Math.max(0, result.meta.agentMeta?.compactionCount ?? 0);
	const modelUsed = result.meta.agentMeta?.model ?? fallbackModel ?? defaultModel;
	const providerUsed = result.meta.agentMeta?.provider ?? fallbackProvider ?? defaultProvider;
	const contextTokens = params.contextTokensOverride ?? lookupContextTokens(modelUsed) ?? DEFAULT_CONTEXT_TOKENS;
	const entry = sessionStore[sessionKey] ?? {
		sessionId,
		updatedAt: Date.now()
	};
	const next = {
		...entry,
		sessionId,
		updatedAt: Date.now(),
		modelProvider: providerUsed,
		model: modelUsed,
		contextTokens
	};
	if (isCliProvider(providerUsed, cfg)) {
		const cliSessionId = result.meta.agentMeta?.sessionId?.trim();
		if (cliSessionId) setCliSessionId(next, providerUsed, cliSessionId);
	}
	next.abortedLastRun = result.meta.aborted ?? false;
	if (hasNonzeroUsage(usage)) {
		const input = usage.input ?? 0;
		const output = usage.output ?? 0;
		const totalTokens = deriveSessionTotalTokens({
			usage,
			contextTokens,
			promptTokens
		}) ?? input;
		next.inputTokens = input;
		next.outputTokens = output;
		next.totalTokens = totalTokens;
		next.totalTokensFresh = true;
	}
	if (compactionsThisRun > 0) next.compactionCount = (entry.compactionCount ?? 0) + compactionsThisRun;
	sessionStore[sessionKey] = next;
	await updateSessionStore(storePath, (store) => {
		store[sessionKey] = next;
	});
}

//#endregion
//#region src/commands/agent/session.ts
function resolveSessionKeyForRequest(opts) {
	const sessionCfg = opts.cfg.session;
	const scope = sessionCfg?.scope ?? "per-sender";
	const mainKey = normalizeMainKey(sessionCfg?.mainKey);
	const explicitSessionKey = opts.sessionKey?.trim() || resolveExplicitAgentSessionKey({
		cfg: opts.cfg,
		agentId: opts.agentId
	});
	const storeAgentId = resolveAgentIdFromSessionKey(explicitSessionKey);
	const storePath = resolveStorePath(sessionCfg?.store, { agentId: storeAgentId });
	const sessionStore = loadSessionStore(storePath);
	const ctx = opts.to?.trim() ? { From: opts.to } : void 0;
	let sessionKey = explicitSessionKey ?? (ctx ? resolveSessionKey(scope, ctx, mainKey) : void 0);
	if (!explicitSessionKey && opts.sessionId && (!sessionKey || sessionStore[sessionKey]?.sessionId !== opts.sessionId)) {
		const foundKey = Object.keys(sessionStore).find((key) => sessionStore[key]?.sessionId === opts.sessionId);
		if (foundKey) sessionKey = foundKey;
	}
	if (opts.sessionId && !explicitSessionKey && (!sessionKey || sessionStore[sessionKey]?.sessionId !== opts.sessionId)) {
		const allAgentIds = listAgentIds(opts.cfg);
		for (const agentId of allAgentIds) {
			if (agentId === storeAgentId) continue;
			const altStorePath = resolveStorePath(sessionCfg?.store, { agentId });
			const altStore = loadSessionStore(altStorePath);
			const foundKey = Object.keys(altStore).find((key) => altStore[key]?.sessionId === opts.sessionId);
			if (foundKey) return {
				sessionKey: foundKey,
				sessionStore: altStore,
				storePath: altStorePath
			};
		}
	}
	return {
		sessionKey,
		sessionStore,
		storePath
	};
}
function resolveSession(opts) {
	const sessionCfg = opts.cfg.session;
	const { sessionKey, sessionStore, storePath } = resolveSessionKeyForRequest({
		cfg: opts.cfg,
		to: opts.to,
		sessionId: opts.sessionId,
		sessionKey: opts.sessionKey,
		agentId: opts.agentId
	});
	const now = Date.now();
	const sessionEntry = sessionKey ? sessionStore[sessionKey] : void 0;
	const resetPolicy = resolveSessionResetPolicy({
		sessionCfg,
		resetType: resolveSessionResetType({ sessionKey }),
		resetOverride: resolveChannelResetConfig({
			sessionCfg,
			channel: sessionEntry?.lastChannel ?? sessionEntry?.channel
		})
	});
	const fresh = sessionEntry ? evaluateSessionFreshness({
		updatedAt: sessionEntry.updatedAt,
		now,
		policy: resetPolicy
	}).fresh : false;
	return {
		sessionId: opts.sessionId?.trim() || (fresh ? sessionEntry?.sessionId : void 0) || crypto.randomUUID(),
		sessionKey,
		sessionEntry,
		sessionStore,
		storePath,
		isNewSession: !fresh && !opts.sessionId,
		persistedThinking: fresh && sessionEntry?.thinkingLevel ? normalizeThinkLevel(sessionEntry.thinkingLevel) : void 0,
		persistedVerbose: fresh && sessionEntry?.verboseLevel ? normalizeVerboseLevel(sessionEntry.verboseLevel) : void 0
	};
}

//#endregion
//#region src/commands/agent.ts
async function persistSessionEntry(params) {
	params.sessionStore[params.sessionKey] = params.entry;
	await updateSessionStore(params.storePath, (store) => {
		store[params.sessionKey] = params.entry;
	});
}
function resolveFallbackRetryPrompt(params) {
	if (!params.isFallbackRetry) return params.body;
	return "Continue where you left off. The previous model attempt failed or timed out.";
}
function runAgentAttempt(params) {
	const effectivePrompt = resolveFallbackRetryPrompt({
		body: params.body,
		isFallbackRetry: params.isFallbackRetry
	});
	if (isCliProvider(params.providerOverride, params.cfg)) {
		const cliSessionId = getCliSessionId(params.sessionEntry, params.providerOverride);
		return runCliAgent({
			sessionId: params.sessionId,
			sessionKey: params.sessionKey,
			agentId: params.sessionAgentId,
			sessionFile: params.sessionFile,
			workspaceDir: params.workspaceDir,
			config: params.cfg,
			prompt: effectivePrompt,
			provider: params.providerOverride,
			model: params.modelOverride,
			thinkLevel: params.resolvedThinkLevel,
			timeoutMs: params.timeoutMs,
			runId: params.runId,
			extraSystemPrompt: params.opts.extraSystemPrompt,
			cliSessionId,
			images: params.isFallbackRetry ? void 0 : params.opts.images,
			streamParams: params.opts.streamParams
		});
	}
	const authProfileId = params.providerOverride === params.primaryProvider ? params.sessionEntry?.authProfileOverride : void 0;
	return runEmbeddedPiAgent({
		sessionId: params.sessionId,
		sessionKey: params.sessionKey,
		agentId: params.sessionAgentId,
		messageChannel: params.messageChannel,
		agentAccountId: params.runContext.accountId,
		messageTo: params.opts.replyTo ?? params.opts.to,
		messageThreadId: params.opts.threadId,
		groupId: params.runContext.groupId,
		groupChannel: params.runContext.groupChannel,
		groupSpace: params.runContext.groupSpace,
		spawnedBy: params.spawnedBy,
		currentChannelId: params.runContext.currentChannelId,
		currentThreadTs: params.runContext.currentThreadTs,
		replyToMode: params.runContext.replyToMode,
		hasRepliedRef: params.runContext.hasRepliedRef,
		senderIsOwner: true,
		sessionFile: params.sessionFile,
		workspaceDir: params.workspaceDir,
		config: params.cfg,
		skillsSnapshot: params.skillsSnapshot,
		prompt: effectivePrompt,
		images: params.isFallbackRetry ? void 0 : params.opts.images,
		clientTools: params.opts.clientTools,
		provider: params.providerOverride,
		model: params.modelOverride,
		authProfileId,
		authProfileIdSource: authProfileId ? params.sessionEntry?.authProfileOverrideSource : void 0,
		thinkLevel: params.resolvedThinkLevel,
		verboseLevel: params.resolvedVerboseLevel,
		timeoutMs: params.timeoutMs,
		runId: params.runId,
		lane: params.opts.lane,
		abortSignal: params.opts.abortSignal,
		extraSystemPrompt: params.opts.extraSystemPrompt,
		inputProvenance: params.opts.inputProvenance,
		streamParams: params.opts.streamParams,
		agentDir: params.agentDir,
		onAgentEvent: params.onAgentEvent
	});
}
async function agentCommand(opts, runtime = defaultRuntime, deps = createDefaultDeps()) {
	const body = (opts.message ?? "").trim();
	if (!body) throw new Error("Message (--message) is required");
	if (!opts.to && !opts.sessionId && !opts.sessionKey && !opts.agentId) throw new Error("Pass --to <E.164>, --session-id, or --agent to choose a session");
	const cfg = loadConfig();
	const agentIdOverrideRaw = opts.agentId?.trim();
	const agentIdOverride = agentIdOverrideRaw ? normalizeAgentId(agentIdOverrideRaw) : void 0;
	if (agentIdOverride) {
		if (!listAgentIds(cfg).includes(agentIdOverride)) throw new Error(`Unknown agent id "${agentIdOverrideRaw}". Use "${formatCliCommand("openclaw agents list")}" to see configured agents.`);
	}
	if (agentIdOverride && opts.sessionKey) {
		const sessionAgentId = resolveAgentIdFromSessionKey(opts.sessionKey);
		if (sessionAgentId !== agentIdOverride) throw new Error(`Agent id "${agentIdOverrideRaw}" does not match session key agent "${sessionAgentId}".`);
	}
	const agentCfg = cfg.agents?.defaults;
	const sessionAgentId = agentIdOverride ?? resolveAgentIdFromSessionKey(opts.sessionKey?.trim());
	const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, sessionAgentId);
	const agentDir = resolveAgentDir(cfg, sessionAgentId);
	const workspaceDir = (await ensureAgentWorkspace({
		dir: workspaceDirRaw,
		ensureBootstrapFiles: !agentCfg?.skipBootstrap
	})).dir;
	const configuredModel = resolveConfiguredModelRef({
		cfg,
		defaultProvider: DEFAULT_PROVIDER,
		defaultModel: DEFAULT_MODEL
	});
	const thinkingLevelsHint = formatThinkingLevels(configuredModel.provider, configuredModel.model);
	const thinkOverride = normalizeThinkLevel(opts.thinking);
	const thinkOnce = normalizeThinkLevel(opts.thinkingOnce);
	if (opts.thinking && !thinkOverride) throw new Error(`Invalid thinking level. Use one of: ${thinkingLevelsHint}.`);
	if (opts.thinkingOnce && !thinkOnce) throw new Error(`Invalid one-shot thinking level. Use one of: ${thinkingLevelsHint}.`);
	const verboseOverride = normalizeVerboseLevel(opts.verbose);
	if (opts.verbose && !verboseOverride) throw new Error("Invalid verbose level. Use \"on\", \"full\", or \"off\".");
	const isSubagentLane = (typeof opts.lane === "string" ? opts.lane.trim() : "") === String(AGENT_LANE_SUBAGENT);
	const timeoutSecondsRaw = opts.timeout !== void 0 ? Number.parseInt(String(opts.timeout), 10) : isSubagentLane ? 0 : void 0;
	if (timeoutSecondsRaw !== void 0 && (Number.isNaN(timeoutSecondsRaw) || timeoutSecondsRaw < 0)) throw new Error("--timeout must be a non-negative integer (seconds; 0 means no timeout)");
	const timeoutMs = resolveAgentTimeoutMs({
		cfg,
		overrideSeconds: timeoutSecondsRaw
	});
	const { sessionId, sessionKey, sessionEntry: resolvedSessionEntry, sessionStore, storePath, isNewSession, persistedThinking, persistedVerbose } = resolveSession({
		cfg,
		to: opts.to,
		sessionId: opts.sessionId,
		sessionKey: opts.sessionKey,
		agentId: agentIdOverride
	});
	let sessionEntry = resolvedSessionEntry;
	const runId = opts.runId?.trim() || sessionId;
	try {
		if (opts.deliver === true) {
			if (resolveSendPolicy({
				cfg,
				entry: sessionEntry,
				sessionKey,
				channel: sessionEntry?.channel,
				chatType: sessionEntry?.chatType
			}) === "deny") throw new Error("send blocked by session policy");
		}
		let resolvedThinkLevel = thinkOnce ?? thinkOverride ?? persistedThinking ?? agentCfg?.thinkingDefault;
		const resolvedVerboseLevel = verboseOverride ?? persistedVerbose ?? agentCfg?.verboseDefault;
		if (sessionKey) registerAgentRunContext(runId, {
			sessionKey,
			verboseLevel: resolvedVerboseLevel
		});
		const needsSkillsSnapshot = isNewSession || !sessionEntry?.skillsSnapshot;
		const skillsSnapshotVersion = getSkillsSnapshotVersion(workspaceDir);
		const skillFilter = resolveAgentSkillsFilter(cfg, sessionAgentId);
		const skillsSnapshot = needsSkillsSnapshot ? buildWorkspaceSkillSnapshot(workspaceDir, {
			config: cfg,
			eligibility: { remote: getRemoteSkillEligibility() },
			snapshotVersion: skillsSnapshotVersion,
			skillFilter
		}) : sessionEntry?.skillsSnapshot;
		if (skillsSnapshot && sessionStore && sessionKey && needsSkillsSnapshot) {
			const next = {
				...sessionEntry ?? {
					sessionId,
					updatedAt: Date.now()
				},
				sessionId,
				updatedAt: Date.now(),
				skillsSnapshot
			};
			await persistSessionEntry({
				sessionStore,
				sessionKey,
				storePath,
				entry: next
			});
			sessionEntry = next;
		}
		if (sessionStore && sessionKey) {
			const next = {
				...sessionStore[sessionKey] ?? sessionEntry ?? {
					sessionId,
					updatedAt: Date.now()
				},
				sessionId,
				updatedAt: Date.now()
			};
			if (thinkOverride) next.thinkingLevel = thinkOverride;
			applyVerboseOverride(next, verboseOverride);
			await persistSessionEntry({
				sessionStore,
				sessionKey,
				storePath,
				entry: next
			});
		}
		const agentModelPrimary = resolveAgentModelPrimary(cfg, sessionAgentId);
		const configuredDefaultRef = resolveConfiguredModelRef({
			cfg: agentModelPrimary ? {
				...cfg,
				agents: {
					...cfg.agents,
					defaults: {
						...cfg.agents?.defaults,
						model: {
							...typeof cfg.agents?.defaults?.model === "object" ? cfg.agents.defaults.model : void 0,
							primary: agentModelPrimary
						}
					}
				}
			} : cfg,
			defaultProvider: DEFAULT_PROVIDER,
			defaultModel: DEFAULT_MODEL
		});
		const { provider: defaultProvider, model: defaultModel } = normalizeModelRef(configuredDefaultRef.provider, configuredDefaultRef.model);
		let provider = defaultProvider;
		let model = defaultModel;
		const hasAllowlist = agentCfg?.models && Object.keys(agentCfg.models).length > 0;
		const hasStoredOverride = Boolean(sessionEntry?.modelOverride || sessionEntry?.providerOverride);
		const needsModelCatalog = hasAllowlist || hasStoredOverride;
		let allowedModelKeys = /* @__PURE__ */ new Set();
		let allowedModelCatalog = [];
		let modelCatalog = null;
		if (needsModelCatalog) {
			modelCatalog = await loadModelCatalog({ config: cfg });
			const allowed = buildAllowedModelSet({
				cfg,
				catalog: modelCatalog,
				defaultProvider,
				defaultModel
			});
			allowedModelKeys = allowed.allowedKeys;
			allowedModelCatalog = allowed.allowedCatalog;
		}
		if (sessionEntry && sessionStore && sessionKey && hasStoredOverride) {
			const entry = sessionEntry;
			const overrideProvider = sessionEntry.providerOverride?.trim() || defaultProvider;
			const overrideModel = sessionEntry.modelOverride?.trim();
			if (overrideModel) {
				const normalizedOverride = normalizeModelRef(overrideProvider, overrideModel);
				const key = modelKey(normalizedOverride.provider, normalizedOverride.model);
				if (!isCliProvider(normalizedOverride.provider, cfg) && allowedModelKeys.size > 0 && !allowedModelKeys.has(key)) {
					const { updated } = applyModelOverrideToSessionEntry({
						entry,
						selection: {
							provider: defaultProvider,
							model: defaultModel,
							isDefault: true
						}
					});
					if (updated) await persistSessionEntry({
						sessionStore,
						sessionKey,
						storePath,
						entry
					});
				}
			}
		}
		const storedProviderOverride = sessionEntry?.providerOverride?.trim();
		const storedModelOverride = sessionEntry?.modelOverride?.trim();
		if (storedModelOverride) {
			const normalizedStored = normalizeModelRef(storedProviderOverride || defaultProvider, storedModelOverride);
			const key = modelKey(normalizedStored.provider, normalizedStored.model);
			if (isCliProvider(normalizedStored.provider, cfg) || allowedModelKeys.size === 0 || allowedModelKeys.has(key)) {
				provider = normalizedStored.provider;
				model = normalizedStored.model;
			}
		}
		if (sessionEntry) {
			const authProfileId = sessionEntry.authProfileOverride;
			if (authProfileId) {
				const entry = sessionEntry;
				const profile = ensureAuthProfileStore().profiles[authProfileId];
				if (!profile || profile.provider !== provider) {
					if (sessionStore && sessionKey) await clearSessionAuthProfileOverride({
						sessionEntry: entry,
						sessionStore,
						sessionKey,
						storePath
					});
				}
			}
		}
		if (!resolvedThinkLevel) {
			let catalogForThinking = modelCatalog ?? allowedModelCatalog;
			if (!catalogForThinking || catalogForThinking.length === 0) {
				modelCatalog = await loadModelCatalog({ config: cfg });
				catalogForThinking = modelCatalog;
			}
			resolvedThinkLevel = resolveThinkingDefault({
				cfg,
				provider,
				model,
				catalog: catalogForThinking
			});
		}
		if (resolvedThinkLevel === "xhigh" && !supportsXHighThinking(provider, model)) {
			if (Boolean(thinkOnce || thinkOverride)) throw new Error(`Thinking level "xhigh" is only supported for ${formatXHighModelHint()}.`);
			resolvedThinkLevel = "high";
			if (sessionEntry && sessionStore && sessionKey && sessionEntry.thinkingLevel === "xhigh") {
				const entry = sessionEntry;
				entry.thinkingLevel = "high";
				entry.updatedAt = Date.now();
				await persistSessionEntry({
					sessionStore,
					sessionKey,
					storePath,
					entry
				});
			}
		}
		const sessionFile = resolveSessionFilePath(sessionId, sessionEntry, { agentId: sessionAgentId });
		const startedAt = Date.now();
		let lifecycleEnded = false;
		let result;
		let fallbackProvider = provider;
		let fallbackModel = model;
		try {
			const runContext = resolveAgentRunContext(opts);
			const messageChannel = resolveMessageChannel(runContext.messageChannel, opts.replyChannel ?? opts.channel);
			const spawnedBy = opts.spawnedBy ?? sessionEntry?.spawnedBy;
			const effectiveFallbacksOverride = resolveEffectiveModelFallbacks({
				cfg,
				agentId: sessionAgentId,
				hasSessionModelOverride: Boolean(storedModelOverride)
			});
			let fallbackAttemptIndex = 0;
			const fallbackResult = await runWithModelFallback({
				cfg,
				provider,
				model,
				agentDir,
				fallbacksOverride: effectiveFallbacksOverride,
				run: (providerOverride, modelOverride) => {
					const isFallbackRetry = fallbackAttemptIndex > 0;
					fallbackAttemptIndex += 1;
					return runAgentAttempt({
						providerOverride,
						modelOverride,
						cfg,
						sessionEntry,
						sessionId,
						sessionKey,
						sessionAgentId,
						sessionFile,
						workspaceDir,
						body,
						isFallbackRetry,
						resolvedThinkLevel,
						timeoutMs,
						runId,
						opts,
						runContext,
						spawnedBy,
						messageChannel,
						skillsSnapshot,
						resolvedVerboseLevel,
						agentDir,
						primaryProvider: provider,
						onAgentEvent: (evt) => {
							if (evt.stream === "lifecycle" && typeof evt.data?.phase === "string" && (evt.data.phase === "end" || evt.data.phase === "error")) lifecycleEnded = true;
						}
					});
				}
			});
			result = fallbackResult.result;
			fallbackProvider = fallbackResult.provider;
			fallbackModel = fallbackResult.model;
			if (!lifecycleEnded) emitAgentEvent({
				runId,
				stream: "lifecycle",
				data: {
					phase: "end",
					startedAt,
					endedAt: Date.now(),
					aborted: result.meta.aborted ?? false
				}
			});
		} catch (err) {
			if (!lifecycleEnded) emitAgentEvent({
				runId,
				stream: "lifecycle",
				data: {
					phase: "error",
					startedAt,
					endedAt: Date.now(),
					error: String(err)
				}
			});
			throw err;
		}
		if (sessionStore && sessionKey) await updateSessionStoreAfterAgentRun({
			cfg,
			contextTokensOverride: agentCfg?.contextTokens,
			sessionId,
			sessionKey,
			storePath,
			sessionStore,
			defaultProvider: provider,
			defaultModel: model,
			fallbackProvider,
			fallbackModel,
			result
		});
		const payloads = result.payloads ?? [];
		return await deliverAgentCommandResult({
			cfg,
			deps,
			runtime,
			opts,
			sessionEntry,
			result,
			payloads
		});
	} finally {
		clearAgentRunContext(runId);
	}
}

//#endregion
//#region src/gateway/boot.ts
function generateBootSessionId() {
	return `boot-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "")}-${crypto.randomUUID().slice(0, 8)}`;
}
const log$1 = createSubsystemLogger("gateway/boot");
const BOOT_FILENAME = "BOOT.md";
function buildBootPrompt(content) {
	return [
		"You are running a boot check. Follow BOOT.md instructions exactly.",
		"",
		"BOOT.md:",
		content,
		"",
		"If BOOT.md asks you to send a message, use the message tool (action=send with channel + target).",
		"Use the `target` field (not `to`) for message tool destinations.",
		`After sending with the message tool, reply with ONLY: ${SILENT_REPLY_TOKEN}.`,
		`If nothing needs attention, reply with ONLY: ${SILENT_REPLY_TOKEN}.`
	].join("\n");
}
async function loadBootFile(workspaceDir) {
	const bootPath = path.join(workspaceDir, BOOT_FILENAME);
	try {
		const trimmed = (await fs.readFile(bootPath, "utf-8")).trim();
		if (!trimmed) return { status: "empty" };
		return {
			status: "ok",
			content: trimmed
		};
	} catch (err) {
		if (err.code === "ENOENT") return { status: "missing" };
		throw err;
	}
}
function snapshotMainSessionMapping(params) {
	const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
	const storePath = resolveStorePath(params.cfg.session?.store, { agentId });
	try {
		const entry = loadSessionStore(storePath, { skipCache: true })[params.sessionKey];
		if (!entry) return {
			storePath,
			sessionKey: params.sessionKey,
			canRestore: true,
			hadEntry: false
		};
		return {
			storePath,
			sessionKey: params.sessionKey,
			canRestore: true,
			hadEntry: true,
			entry: structuredClone(entry)
		};
	} catch (err) {
		log$1.debug("boot: could not snapshot main session mapping", {
			sessionKey: params.sessionKey,
			error: String(err)
		});
		return {
			storePath,
			sessionKey: params.sessionKey,
			canRestore: false,
			hadEntry: false
		};
	}
}
async function restoreMainSessionMapping(snapshot) {
	if (!snapshot.canRestore) return;
	try {
		await updateSessionStore(snapshot.storePath, (store) => {
			if (snapshot.hadEntry && snapshot.entry) {
				store[snapshot.sessionKey] = snapshot.entry;
				return;
			}
			delete store[snapshot.sessionKey];
		}, { activeSessionKey: snapshot.sessionKey });
		return;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}
async function runBootOnce(params) {
	const bootRuntime = {
		log: () => {},
		error: (message) => log$1.error(String(message)),
		exit: defaultRuntime.exit
	};
	let result;
	try {
		result = await loadBootFile(params.workspaceDir);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log$1.error(`boot: failed to read ${BOOT_FILENAME}: ${message}`);
		return {
			status: "failed",
			reason: message
		};
	}
	if (result.status === "missing" || result.status === "empty") return {
		status: "skipped",
		reason: result.status
	};
	const sessionKey = params.agentId ? resolveAgentMainSessionKey({
		cfg: params.cfg,
		agentId: params.agentId
	}) : resolveMainSessionKey(params.cfg);
	const message = buildBootPrompt(result.content ?? "");
	const sessionId = generateBootSessionId();
	const mappingSnapshot = snapshotMainSessionMapping({
		cfg: params.cfg,
		sessionKey
	});
	let agentFailure;
	try {
		await agentCommand({
			message,
			sessionKey,
			sessionId,
			deliver: false
		}, bootRuntime, params.deps);
	} catch (err) {
		agentFailure = err instanceof Error ? err.message : String(err);
		log$1.error(`boot: agent run failed: ${agentFailure}`);
	}
	const mappingRestoreFailure = await restoreMainSessionMapping(mappingSnapshot);
	if (mappingRestoreFailure) log$1.error(`boot: failed to restore main session mapping: ${mappingRestoreFailure}`);
	if (!agentFailure && !mappingRestoreFailure) return { status: "ran" };
	return {
		status: "failed",
		reason: [agentFailure ? `agent run failed: ${agentFailure}` : void 0, mappingRestoreFailure ? `mapping restore failed: ${mappingRestoreFailure}` : void 0].filter((part) => Boolean(part)).join("; ")
	};
}

//#endregion
//#region src/hooks/bundled/boot-md/handler.ts
const log = createSubsystemLogger("hooks/boot-md");
const runBootChecklist = async (event) => {
	if (!isGatewayStartupEvent(event)) return;
	if (!event.context.cfg) return;
	const cfg = event.context.cfg;
	const deps = event.context.deps ?? createDefaultDeps();
	const agentIds = listAgentIds(cfg);
	for (const agentId of agentIds) {
		const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
		const result = await runBootOnce({
			cfg,
			deps,
			workspaceDir,
			agentId
		});
		if (result.status === "failed") {
			log.warn("boot-md failed for agent startup run", {
				agentId,
				workspaceDir,
				reason: result.reason
			});
			continue;
		}
		if (result.status === "skipped") log.debug("boot-md skipped for agent startup run", {
			agentId,
			workspaceDir,
			reason: result.reason
		});
	}
};

//#endregion
export { runBootChecklist as default };