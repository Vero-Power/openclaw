import "./paths-CyR9Pa1R.js";
import "./registry-BmY4gNy6.js";
import { c as resolveDefaultAgentId, r as resolveAgentDir, s as resolveAgentWorkspaceDir } from "./agent-scope-tDSbswwo.js";
import "./subsystem-B5g771Td.js";
import "./workspace-Dk7qkKmf.js";
import { d as resolveDefaultModelForAgent } from "./model-selection-BymXpuGc.js";
import "./github-copilot-token-Bj7xQtKK.js";
import "./env-DQUuhEFy.js";
import "./boolean-B8-BqKGQ.js";
import "./tokens-BhwtSzyC.js";
import { t as runEmbeddedPiAgent } from "./pi-embedded-D2RkRF84.js";
import "./normalize-9QSaLqXI.js";
import "./accounts-CW8SvMCY.js";
import "./bindings-BAgGomn2.js";
import "./send-BOTas2-1.js";
import "./plugins-BCKDArtV.js";
import "./send-CUiykMpg.js";
import "./deliver-DAcrXq1Q.js";
import "./diagnostic-CMUtW1Mq.js";
import "./diagnostic-session-state-C0Sxjfox.js";
import "./accounts-B9r_l5f8.js";
import "./send-BUt-rhoR.js";
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
import "./reply-prefix-C04eF9J1.js";
import "./manager-C6xOFvrp.js";
import "./gemini-auth-BRIL0wJL.js";
import "./sqlite-DsF9bHNX.js";
import "./retry-BxB_D6Pn.js";
import "./chunk-TRVny4T1.js";
import "./markdown-tables-B8uQVqCj.js";
import "./local-roots-C_Ncbu0N.js";
import "./ir-BwWquvcM.js";
import "./render-CDCvpfhh.js";
import "./commands-registry-DvUlqrF0.js";
import "./runner-CvPKojiN.js";
import "./skill-commands-BTGJIdbT.js";
import "./fetch-DtI0mtzx.js";
import "./send-CrH-hRWc.js";
import "./outbound-attachment-CxVnjJuZ.js";
import "./send-HRN5K3xk.js";
import "./resolve-route-DL2wvbM8.js";
import "./channel-activity-LT3oBvO7.js";
import "./tables-CNBcgHrq.js";
import "./proxy-CBJ1upuz.js";
import "./replies-CkNW_Mj3.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

//#region src/hooks/llm-slug-generator.ts
/**
* LLM-based slug generator for session memory filenames
*/
/**
* Generate a short 1-2 word filename slug from session content using LLM
*/
async function generateSlugViaLLM(params) {
	let tempSessionFile = null;
	try {
		const agentId = resolveDefaultAgentId(params.cfg);
		const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
		const agentDir = resolveAgentDir(params.cfg, agentId);
		const defaultModel = resolveDefaultModelForAgent({
			cfg: params.cfg,
			agentId
		});
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-slug-"));
		tempSessionFile = path.join(tempDir, "session.jsonl");
		const prompt = `Based on this conversation, generate a short 1-2 word filename slug (lowercase, hyphen-separated, no file extension).

Conversation summary:
${params.sessionContent.slice(0, 2e3)}

Reply with ONLY the slug, nothing else. Examples: "vendor-pitch", "api-design", "bug-fix"`;
		const result = await runEmbeddedPiAgent({
			sessionId: `slug-generator-${Date.now()}`,
			sessionKey: "temp:slug-generator",
			agentId,
			sessionFile: tempSessionFile,
			workspaceDir,
			agentDir,
			config: params.cfg,
			prompt,
			timeoutMs: 15e3,
			runId: `slug-gen-${Date.now()}`,
			provider: defaultModel.provider,
			model: defaultModel.model
		});
		if (result.payloads && result.payloads.length > 0) {
			const text = result.payloads[0]?.text;
			if (text) return text.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || null;
		}
		return null;
	} catch (err) {
		console.error("[llm-slug-generator] Failed to generate slug:", err);
		return null;
	} finally {
		if (tempSessionFile) try {
			await fs.rm(path.dirname(tempSessionFile), {
				recursive: true,
				force: true
			});
		} catch {}
	}
}

//#endregion
export { generateSlugViaLLM };