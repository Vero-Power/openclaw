import { s as resolveStateDir } from "../../paths-CyR9Pa1R.js";
import { d as resolveAgentIdFromSessionKey } from "../../session-key-CgcjHuX_.js";
import "../../registry-BmY4gNy6.js";
import { s as resolveAgentWorkspaceDir } from "../../agent-scope-tDSbswwo.js";
import { t as createSubsystemLogger } from "../../subsystem-B5g771Td.js";
import "../../workspace-Dk7qkKmf.js";
import "../../model-selection-BymXpuGc.js";
import "../../github-copilot-token-Bj7xQtKK.js";
import "../../env-DQUuhEFy.js";
import "../../boolean-B8-BqKGQ.js";
import "../../tokens-BhwtSzyC.js";
import "../../pi-embedded-D2RkRF84.js";
import "../../normalize-9QSaLqXI.js";
import "../../accounts-CW8SvMCY.js";
import "../../bindings-BAgGomn2.js";
import "../../send-BOTas2-1.js";
import "../../plugins-BCKDArtV.js";
import "../../send-CUiykMpg.js";
import "../../deliver-DAcrXq1Q.js";
import "../../diagnostic-CMUtW1Mq.js";
import "../../diagnostic-session-state-C0Sxjfox.js";
import "../../accounts-B9r_l5f8.js";
import "../../send-BUt-rhoR.js";
import "../../fs-safe-D_arMs0S.js";
import "../../pi-model-discovery-C-yOXpma.js";
import "../../message-channel-BDlvrUZF.js";
import { ot as hasInterSessionUserProvenance } from "../../pi-embedded-helpers-CZPCpjWM.js";
import "../../config-CUdAlGKZ.js";
import "../../manifest-registry-Dovhiqzt.js";
import "../../common-B42CZ6Du.js";
import "../../chrome-BL-05-L_.js";
import "../../frontmatter-BT4H5SZG.js";
import "../../skills-mtulzV5-.js";
import "../../redact-BBbIZgau.js";
import "../../errors-3KjSwJLH.js";
import "../../ssrf-B8OrDkCk.js";
import "../../store-D1jTTPiR.js";
import "../../thinking-BUgeNpj0.js";
import "../../accounts-B__OkEez.js";
import "../../paths-gnW-md4M.js";
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
import "../../runner-CvPKojiN.js";
import "../../skill-commands-BTGJIdbT.js";
import "../../fetch-DtI0mtzx.js";
import "../../send-CrH-hRWc.js";
import "../../outbound-attachment-CxVnjJuZ.js";
import "../../send-HRN5K3xk.js";
import "../../resolve-route-DL2wvbM8.js";
import "../../channel-activity-LT3oBvO7.js";
import "../../tables-CNBcgHrq.js";
import "../../proxy-CBJ1upuz.js";
import "../../replies-CkNW_Mj3.js";
import { generateSlugViaLLM } from "../../llm-slug-generator.js";
import { t as resolveHookConfig } from "../../config-ClSsetRi.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

//#region src/hooks/bundled/session-memory/handler.ts
/**
* Session memory hook handler
*
* Saves session context to memory when /new command is triggered
* Creates a new dated memory file with LLM-generated slug
*/
const log = createSubsystemLogger("hooks/session-memory");
/**
* Read recent messages from session file for slug generation
*/
async function getRecentSessionContent(sessionFilePath, messageCount = 15) {
	try {
		const lines = (await fs.readFile(sessionFilePath, "utf-8")).trim().split("\n");
		const allMessages = [];
		for (const line of lines) try {
			const entry = JSON.parse(line);
			if (entry.type === "message" && entry.message) {
				const msg = entry.message;
				const role = msg.role;
				if ((role === "user" || role === "assistant") && msg.content) {
					if (role === "user" && hasInterSessionUserProvenance(msg)) continue;
					const text = Array.isArray(msg.content) ? msg.content.find((c) => c.type === "text")?.text : msg.content;
					if (text && !text.startsWith("/")) allMessages.push(`${role}: ${text}`);
				}
			}
		} catch {}
		return allMessages.slice(-messageCount).join("\n");
	} catch {
		return null;
	}
}
/**
* Try the active transcript first; if /new already rotated it,
* fallback to the latest .jsonl.reset.* sibling.
*/
async function getRecentSessionContentWithResetFallback(sessionFilePath, messageCount = 15) {
	const primary = await getRecentSessionContent(sessionFilePath, messageCount);
	if (primary) return primary;
	try {
		const dir = path.dirname(sessionFilePath);
		const resetPrefix = `${path.basename(sessionFilePath)}.reset.`;
		const resetCandidates = (await fs.readdir(dir)).filter((name) => name.startsWith(resetPrefix)).toSorted();
		if (resetCandidates.length === 0) return primary;
		const latestResetPath = path.join(dir, resetCandidates[resetCandidates.length - 1]);
		const fallback = await getRecentSessionContent(latestResetPath, messageCount);
		if (fallback) log.debug("Loaded session content from reset fallback", {
			sessionFilePath,
			latestResetPath
		});
		return fallback || primary;
	} catch {
		return primary;
	}
}
function stripResetSuffix(fileName) {
	const resetIndex = fileName.indexOf(".reset.");
	return resetIndex === -1 ? fileName : fileName.slice(0, resetIndex);
}
async function findPreviousSessionFile(params) {
	try {
		const files = await fs.readdir(params.sessionsDir);
		const fileSet = new Set(files);
		const baseFromReset = params.currentSessionFile ? stripResetSuffix(path.basename(params.currentSessionFile)) : void 0;
		if (baseFromReset && fileSet.has(baseFromReset)) return path.join(params.sessionsDir, baseFromReset);
		const trimmedSessionId = params.sessionId?.trim();
		if (trimmedSessionId) {
			const canonicalFile = `${trimmedSessionId}.jsonl`;
			if (fileSet.has(canonicalFile)) return path.join(params.sessionsDir, canonicalFile);
			const topicVariants = files.filter((name) => name.startsWith(`${trimmedSessionId}-topic-`) && name.endsWith(".jsonl") && !name.includes(".reset.")).toSorted().toReversed();
			if (topicVariants.length > 0) return path.join(params.sessionsDir, topicVariants[0]);
		}
		if (!params.currentSessionFile) return;
		const nonResetJsonl = files.filter((name) => name.endsWith(".jsonl") && !name.includes(".reset.")).toSorted().toReversed();
		if (nonResetJsonl.length > 0) return path.join(params.sessionsDir, nonResetJsonl[0]);
	} catch {}
}
/**
* Save session context to memory when /new command is triggered
*/
const saveSessionToMemory = async (event) => {
	if (event.type !== "command" || event.action !== "new") return;
	try {
		log.debug("Hook triggered for /new command");
		const context = event.context || {};
		const cfg = context.cfg;
		const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
		const workspaceDir = cfg ? resolveAgentWorkspaceDir(cfg, agentId) : path.join(resolveStateDir(process.env, os.homedir), "workspace");
		const memoryDir = path.join(workspaceDir, "memory");
		await fs.mkdir(memoryDir, { recursive: true });
		const now = new Date(event.timestamp);
		const dateStr = now.toISOString().split("T")[0];
		const sessionEntry = context.previousSessionEntry || context.sessionEntry || {};
		const currentSessionId = sessionEntry.sessionId;
		let currentSessionFile = sessionEntry.sessionFile || void 0;
		if (!currentSessionFile || currentSessionFile.includes(".reset.")) {
			const sessionsDirs = /* @__PURE__ */ new Set();
			if (currentSessionFile) sessionsDirs.add(path.dirname(currentSessionFile));
			sessionsDirs.add(path.join(workspaceDir, "sessions"));
			for (const sessionsDir of sessionsDirs) {
				const recoveredSessionFile = await findPreviousSessionFile({
					sessionsDir,
					currentSessionFile,
					sessionId: currentSessionId
				});
				if (!recoveredSessionFile) continue;
				currentSessionFile = recoveredSessionFile;
				log.debug("Found previous session file", { file: currentSessionFile });
				break;
			}
		}
		log.debug("Session context resolved", {
			sessionId: currentSessionId,
			sessionFile: currentSessionFile,
			hasCfg: Boolean(cfg)
		});
		const sessionFile = currentSessionFile || void 0;
		const hookConfig = resolveHookConfig(cfg, "session-memory");
		const messageCount = typeof hookConfig?.messages === "number" && hookConfig.messages > 0 ? hookConfig.messages : 15;
		let slug = null;
		let sessionContent = null;
		if (sessionFile) {
			sessionContent = await getRecentSessionContentWithResetFallback(sessionFile, messageCount);
			log.debug("Session content loaded", {
				length: sessionContent?.length ?? 0,
				messageCount
			});
			const allowLlmSlug = !(process.env.OPENCLAW_TEST_FAST === "1" || process.env.VITEST === "true" || process.env.VITEST === "1" || false) && hookConfig?.llmSlug !== false;
			if (sessionContent && cfg && allowLlmSlug) {
				log.debug("Calling generateSlugViaLLM...");
				slug = await generateSlugViaLLM({
					sessionContent,
					cfg
				});
				log.debug("Generated slug", { slug });
			}
		}
		if (!slug) {
			slug = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "").slice(0, 4);
			log.debug("Using fallback timestamp slug", { slug });
		}
		const filename = `${dateStr}-${slug}.md`;
		const memoryFilePath = path.join(memoryDir, filename);
		log.debug("Memory file path resolved", {
			filename,
			path: memoryFilePath.replace(os.homedir(), "~")
		});
		const timeStr = now.toISOString().split("T")[1].split(".")[0];
		const sessionId = sessionEntry.sessionId || "unknown";
		const source = context.commandSource || "unknown";
		const entryParts = [
			`# Session: ${dateStr} ${timeStr} UTC`,
			"",
			`- **Session Key**: ${event.sessionKey}`,
			`- **Session ID**: ${sessionId}`,
			`- **Source**: ${source}`,
			""
		];
		if (sessionContent) entryParts.push("## Conversation Summary", "", sessionContent, "");
		const entry = entryParts.join("\n");
		await fs.writeFile(memoryFilePath, entry, "utf-8");
		log.debug("Memory file written successfully");
		const relPath = memoryFilePath.replace(os.homedir(), "~");
		log.info(`Session context saved to ${relPath}`);
	} catch (err) {
		if (err instanceof Error) log.error("Failed to save session memory", {
			errorName: err.name,
			errorMessage: err.message,
			stack: err.stack
		});
		else log.error("Failed to save session memory", { error: String(err) });
	}
};

//#endregion
export { saveSessionToMemory as default };