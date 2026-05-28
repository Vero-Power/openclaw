import { At as createPluginLoaderLogger, jt as loadOpenClawPlugins } from "./reply-DWT0cy8-.js";
import { t as createSubsystemLogger } from "./subsystem-BCQGGxdd.js";
import { D as resolveDefaultAgentWorkspaceDir, c as resolveAgentWorkspaceDir, l as resolveDefaultAgentId } from "./agent-scope-BZLOCEiY.js";
import { i as loadConfig } from "./config-DtbRlmRZ.js";

//#region src/plugins/status.ts
const log = createSubsystemLogger("plugins");
function buildPluginStatusReport(params) {
	const config = params?.config ?? loadConfig();
	const workspaceDir = params?.workspaceDir ? params.workspaceDir : resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config)) ?? resolveDefaultAgentWorkspaceDir();
	return {
		workspaceDir,
		...loadOpenClawPlugins({
			config,
			workspaceDir,
			logger: createPluginLoaderLogger(log)
		})
	};
}

//#endregion
export { buildPluginStatusReport as t };