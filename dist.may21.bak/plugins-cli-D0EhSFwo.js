import { Dt as theme, Yt as resolveStateDir, _ as defaultRuntime, ct as shortenHomeInString, lt as shortenHomePath, ot as resolveUserPath, rt as resolveConfigDir } from "./entry.js";
import "./auth-profiles-CiQsARKp.js";
import "./exec-CBKBIMpA.js";
import "./agent-scope-BEB0yS_L.js";
import "./github-copilot-token-DuFIqfeC.js";
import "./model-Db-28JMH.js";
import "./pi-model-discovery-Do3xMEtM.js";
import "./frontmatter-D-YR-Ghi.js";
import "./skills-BKnaiOKI.js";
import { m as defaultSlotIdForKey, p as applyExclusiveSlotSelection, s as resolveBundledPluginsDir, t as clearPluginManifestRegistryCache } from "./manifest-registry-DS2iK5AZ.js";
import { i as loadConfig, l as writeConfigFile } from "./config-BZ-sQEmh.js";
import "./client-CnL59tOj.js";
import "./call-CUYAxKYv.js";
import "./message-channel-mz9U3AFl.js";
import "./subagent-registry-vEaOpKkF.js";
import "./sessions-DR2Q7emK.js";
import "./tokens-MGcNqlE_.js";
import "./normalize-G6M_Fobz.js";
import "./accounts-CWNozl33.js";
import "./bindings-BD0BDrVW.js";
import "./logging-CcxUDNcI.js";
import "./send-Cxqp_t_q.js";
import "./plugins-skOiRwEk.js";
import "./send-Q5mQ2dSq.js";
import "./with-timeout-C5wD-6xB.js";
import "./deliver-Ds1FsdFM.js";
import "./diagnostic-Bg3wFx-Z.js";
import "./diagnostic-session-state-DqgfGYqZ.js";
import "./accounts-Dnz84Cq6.js";
import "./send-CySDoLIX.js";
import "./fs-safe-BY9kuZ3o.js";
import "./pi-embedded-helpers-CqzGUWmo.js";
import "./sandbox-DHahf6kq.js";
import "./common-KSoAA9JF.js";
import "./chrome-B_t1ANw9.js";
import { l as promptYesNo } from "./tailscale-BxzsxqAY.js";
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
import "./session-utils-BcCEIdsX.js";
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
import { t as formatDocsLink } from "./links-rnbUL9h5.js";
import "./cli-utils-f9j-_1VT.js";
import "./help-format-5GFCgEVf.js";
import "./progress-Clpi3Ckj.js";
import "./replies-e7HamCHK.js";
import "./onboard-helpers-1IVAZXr5.js";
import "./prompt-style-D7sAEM59.js";
import "./pairing-labels-CfMMR0_C.js";
import { c as resolveArchiveKind } from "./install-safe-path-BiSJziNV.js";
import "./npm-registry-spec-CR15kopk.js";
import "./skill-scanner-CFkJ9nj-.js";
import { i as resolvePluginInstallDir, n as installPluginFromNpmSpec, r as installPluginFromPath, t as recordPluginInstall } from "./installs-CA2kraft.js";
import { t as renderTable } from "./table-D01d2GuY.js";
import { t as buildPluginStatusReport } from "./status-C_xbClts.js";
import { n as updateNpmInstalledPlugins } from "./update-DmX2XB2K.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fs$1 from "node:fs/promises";

//#region src/plugins/source-display.ts
function tryRelative(root, filePath) {
	const rel = path.relative(root, filePath);
	if (!rel || rel === ".") return null;
	if (rel === "..") return null;
	if (rel.startsWith(`..${path.sep}`) || rel.startsWith("../") || rel.startsWith("..\\")) return null;
	if (path.isAbsolute(rel)) return null;
	return rel.replaceAll("\\", "/");
}
function resolvePluginSourceRoots(params) {
	return {
		stock: resolveBundledPluginsDir(),
		global: path.join(resolveConfigDir(), "extensions"),
		workspace: params.workspaceDir ? path.join(params.workspaceDir, ".openclaw", "extensions") : void 0
	};
}
function formatPluginSourceForTable(plugin, roots) {
	const raw = plugin.source;
	if (plugin.origin === "bundled" && roots.stock) {
		const rel = tryRelative(roots.stock, raw);
		if (rel) return {
			value: `stock:${rel}`,
			rootKey: "stock"
		};
	}
	if (plugin.origin === "workspace" && roots.workspace) {
		const rel = tryRelative(roots.workspace, raw);
		if (rel) return {
			value: `workspace:${rel}`,
			rootKey: "workspace"
		};
	}
	if (plugin.origin === "global" && roots.global) {
		const rel = tryRelative(roots.global, raw);
		if (rel) return {
			value: `global:${rel}`,
			rootKey: "global"
		};
	}
	return { value: shortenHomeInString(raw) };
}

//#endregion
//#region src/plugins/uninstall.ts
function resolveUninstallDirectoryTarget(params) {
	if (!params.hasInstall) return null;
	if (params.installRecord?.source === "path") return null;
	let defaultPath;
	try {
		defaultPath = resolvePluginInstallDir(params.pluginId, params.extensionsDir);
	} catch {
		return null;
	}
	const configuredPath = params.installRecord?.installPath;
	if (!configuredPath) return defaultPath;
	if (path.resolve(configuredPath) === path.resolve(defaultPath)) return configuredPath;
	return defaultPath;
}
/**
* Remove plugin references from config (pure config mutation).
* Returns a new config with the plugin removed from entries, installs, allow, load.paths, and slots.
*/
function removePluginFromConfig(cfg, pluginId) {
	const actions = {
		entry: false,
		install: false,
		allowlist: false,
		loadPath: false,
		memorySlot: false
	};
	const pluginsConfig = cfg.plugins ?? {};
	let entries = pluginsConfig.entries;
	if (entries && pluginId in entries) {
		const { [pluginId]: _, ...rest } = entries;
		entries = Object.keys(rest).length > 0 ? rest : void 0;
		actions.entry = true;
	}
	let installs = pluginsConfig.installs;
	const installRecord = installs?.[pluginId];
	if (installs && pluginId in installs) {
		const { [pluginId]: _, ...rest } = installs;
		installs = Object.keys(rest).length > 0 ? rest : void 0;
		actions.install = true;
	}
	let allow = pluginsConfig.allow;
	if (Array.isArray(allow) && allow.includes(pluginId)) {
		allow = allow.filter((id) => id !== pluginId);
		if (allow.length === 0) allow = void 0;
		actions.allowlist = true;
	}
	let load = pluginsConfig.load;
	if (installRecord?.source === "path" && installRecord.sourcePath) {
		const sourcePath = installRecord.sourcePath;
		const loadPaths = load?.paths;
		if (Array.isArray(loadPaths) && loadPaths.includes(sourcePath)) {
			const nextLoadPaths = loadPaths.filter((p) => p !== sourcePath);
			load = nextLoadPaths.length > 0 ? {
				...load,
				paths: nextLoadPaths
			} : void 0;
			actions.loadPath = true;
		}
	}
	let slots = pluginsConfig.slots;
	if (slots?.memory === pluginId) {
		slots = {
			...slots,
			memory: defaultSlotIdForKey("memory")
		};
		actions.memorySlot = true;
	}
	if (slots && Object.keys(slots).length === 0) slots = void 0;
	const cleanedPlugins = {
		...pluginsConfig,
		entries,
		installs,
		allow,
		load,
		slots
	};
	if (cleanedPlugins.entries === void 0) delete cleanedPlugins.entries;
	if (cleanedPlugins.installs === void 0) delete cleanedPlugins.installs;
	if (cleanedPlugins.allow === void 0) delete cleanedPlugins.allow;
	if (cleanedPlugins.load === void 0) delete cleanedPlugins.load;
	if (cleanedPlugins.slots === void 0) delete cleanedPlugins.slots;
	return {
		config: {
			...cfg,
			plugins: Object.keys(cleanedPlugins).length > 0 ? cleanedPlugins : void 0
		},
		actions
	};
}
/**
* Uninstall a plugin by removing it from config and optionally deleting installed files.
* Linked plugins (source === "path") never have their source directory deleted.
*/
async function uninstallPlugin(params) {
	const { config, pluginId, deleteFiles = true, extensionsDir } = params;
	const hasEntry = pluginId in (config.plugins?.entries ?? {});
	const hasInstall = pluginId in (config.plugins?.installs ?? {});
	if (!hasEntry && !hasInstall) return {
		ok: false,
		error: `Plugin not found: ${pluginId}`
	};
	const installRecord = config.plugins?.installs?.[pluginId];
	const isLinked = installRecord?.source === "path";
	const { config: newConfig, actions: configActions } = removePluginFromConfig(config, pluginId);
	const actions = {
		...configActions,
		directory: false
	};
	const warnings = [];
	const deleteTarget = deleteFiles && !isLinked ? resolveUninstallDirectoryTarget({
		pluginId,
		hasInstall,
		installRecord,
		extensionsDir
	}) : null;
	if (deleteTarget) {
		const existed = await fs$1.access(deleteTarget).then(() => true).catch(() => false) ?? false;
		try {
			await fs$1.rm(deleteTarget, {
				recursive: true,
				force: true
			});
			actions.directory = existed;
		} catch (error) {
			warnings.push(`Failed to remove plugin directory ${deleteTarget}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return {
		ok: true,
		config: newConfig,
		pluginId,
		actions,
		warnings
	};
}

//#endregion
//#region src/cli/plugins-cli.ts
function resolveFileNpmSpecToLocalPath(raw) {
	const trimmed = raw.trim();
	if (!trimmed.toLowerCase().startsWith("file:")) return null;
	const rest = trimmed.slice(5);
	if (!rest) return {
		ok: false,
		error: "unsupported file: spec: missing path"
	};
	if (rest.startsWith("///")) return {
		ok: true,
		path: rest.slice(2)
	};
	if (rest.startsWith("//localhost/")) return {
		ok: true,
		path: rest.slice(11)
	};
	if (rest.startsWith("//")) return {
		ok: false,
		error: "unsupported file: URL host (expected \"file:<path>\" or \"file:///abs/path\")"
	};
	return {
		ok: true,
		path: rest
	};
}
function formatPluginLine(plugin, verbose = false) {
	const status = plugin.status === "loaded" ? theme.success("loaded") : plugin.status === "disabled" ? theme.warn("disabled") : theme.error("error");
	const name = theme.command(plugin.name || plugin.id);
	const idSuffix = plugin.name && plugin.name !== plugin.id ? theme.muted(` (${plugin.id})`) : "";
	const desc = plugin.description ? theme.muted(plugin.description.length > 60 ? `${plugin.description.slice(0, 57)}...` : plugin.description) : theme.muted("(no description)");
	if (!verbose) return `${name}${idSuffix} ${status} - ${desc}`;
	const parts = [
		`${name}${idSuffix} ${status}`,
		`  source: ${theme.muted(shortenHomeInString(plugin.source))}`,
		`  origin: ${plugin.origin}`
	];
	if (plugin.version) parts.push(`  version: ${plugin.version}`);
	if (plugin.providerIds.length > 0) parts.push(`  providers: ${plugin.providerIds.join(", ")}`);
	if (plugin.error) parts.push(theme.error(`  error: ${plugin.error}`));
	return parts.join("\n");
}
function applySlotSelectionForPlugin(config, pluginId) {
	const report = buildPluginStatusReport({ config });
	const plugin = report.plugins.find((entry) => entry.id === pluginId);
	if (!plugin) return {
		config,
		warnings: []
	};
	const result = applyExclusiveSlotSelection({
		config,
		selectedId: plugin.id,
		selectedKind: plugin.kind,
		registry: report
	});
	return {
		config: result.config,
		warnings: result.warnings
	};
}
function createPluginInstallLogger() {
	return {
		info: (msg) => defaultRuntime.log(msg),
		warn: (msg) => defaultRuntime.log(theme.warn(msg))
	};
}
function enablePluginInConfig(config, pluginId) {
	return {
		...config,
		plugins: {
			...config.plugins,
			entries: {
				...config.plugins?.entries,
				[pluginId]: {
					...config.plugins?.entries?.[pluginId],
					enabled: true
				}
			}
		}
	};
}
function logSlotWarnings(warnings) {
	if (warnings.length === 0) return;
	for (const warning of warnings) defaultRuntime.log(theme.warn(warning));
}
function registerPluginsCli(program) {
	const plugins = program.command("plugins").description("Manage OpenClaw plugins and extensions").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/plugins", "docs.openclaw.ai/cli/plugins")}\n`);
	plugins.command("list").description("List discovered plugins").option("--json", "Print JSON").option("--enabled", "Only show enabled plugins", false).option("--verbose", "Show detailed entries", false).action((opts) => {
		const report = buildPluginStatusReport();
		const list = opts.enabled ? report.plugins.filter((p) => p.status === "loaded") : report.plugins;
		if (opts.json) {
			const payload = {
				workspaceDir: report.workspaceDir,
				plugins: list,
				diagnostics: report.diagnostics
			};
			defaultRuntime.log(JSON.stringify(payload, null, 2));
			return;
		}
		if (list.length === 0) {
			defaultRuntime.log(theme.muted("No plugins found."));
			return;
		}
		const loaded = list.filter((p) => p.status === "loaded").length;
		defaultRuntime.log(`${theme.heading("Plugins")} ${theme.muted(`(${loaded}/${list.length} loaded)`)}`);
		if (!opts.verbose) {
			const tableWidth = Math.max(60, (process.stdout.columns ?? 120) - 1);
			const sourceRoots = resolvePluginSourceRoots({ workspaceDir: report.workspaceDir });
			const usedRoots = /* @__PURE__ */ new Set();
			const rows = list.map((plugin) => {
				const desc = plugin.description ? theme.muted(plugin.description) : "";
				const formattedSource = formatPluginSourceForTable(plugin, sourceRoots);
				if (formattedSource.rootKey) usedRoots.add(formattedSource.rootKey);
				const sourceLine = desc ? `${formattedSource.value}\n${desc}` : formattedSource.value;
				return {
					Name: plugin.name || plugin.id,
					ID: plugin.name && plugin.name !== plugin.id ? plugin.id : "",
					Status: plugin.status === "loaded" ? theme.success("loaded") : plugin.status === "disabled" ? theme.warn("disabled") : theme.error("error"),
					Source: sourceLine,
					Version: plugin.version ?? ""
				};
			});
			if (usedRoots.size > 0) {
				defaultRuntime.log(theme.muted("Source roots:"));
				for (const key of [
					"stock",
					"workspace",
					"global"
				]) {
					if (!usedRoots.has(key)) continue;
					const dir = sourceRoots[key];
					if (!dir) continue;
					defaultRuntime.log(`  ${theme.command(`${key}:`)} ${theme.muted(dir)}`);
				}
				defaultRuntime.log("");
			}
			defaultRuntime.log(renderTable({
				width: tableWidth,
				columns: [
					{
						key: "Name",
						header: "Name",
						minWidth: 14,
						flex: true
					},
					{
						key: "ID",
						header: "ID",
						minWidth: 10,
						flex: true
					},
					{
						key: "Status",
						header: "Status",
						minWidth: 10
					},
					{
						key: "Source",
						header: "Source",
						minWidth: 26,
						flex: true
					},
					{
						key: "Version",
						header: "Version",
						minWidth: 8
					}
				],
				rows
			}).trimEnd());
			return;
		}
		const lines = [];
		for (const plugin of list) {
			lines.push(formatPluginLine(plugin, true));
			lines.push("");
		}
		defaultRuntime.log(lines.join("\n").trim());
	});
	plugins.command("info").description("Show plugin details").argument("<id>", "Plugin id").option("--json", "Print JSON").action((id, opts) => {
		const plugin = buildPluginStatusReport().plugins.find((p) => p.id === id || p.name === id);
		if (!plugin) {
			defaultRuntime.error(`Plugin not found: ${id}`);
			process.exit(1);
		}
		const install = loadConfig().plugins?.installs?.[plugin.id];
		if (opts.json) {
			defaultRuntime.log(JSON.stringify(plugin, null, 2));
			return;
		}
		const lines = [];
		lines.push(theme.heading(plugin.name || plugin.id));
		if (plugin.name && plugin.name !== plugin.id) lines.push(theme.muted(`id: ${plugin.id}`));
		if (plugin.description) lines.push(plugin.description);
		lines.push("");
		lines.push(`${theme.muted("Status:")} ${plugin.status}`);
		lines.push(`${theme.muted("Source:")} ${shortenHomeInString(plugin.source)}`);
		lines.push(`${theme.muted("Origin:")} ${plugin.origin}`);
		if (plugin.version) lines.push(`${theme.muted("Version:")} ${plugin.version}`);
		if (plugin.toolNames.length > 0) lines.push(`${theme.muted("Tools:")} ${plugin.toolNames.join(", ")}`);
		if (plugin.hookNames.length > 0) lines.push(`${theme.muted("Hooks:")} ${plugin.hookNames.join(", ")}`);
		if (plugin.gatewayMethods.length > 0) lines.push(`${theme.muted("Gateway methods:")} ${plugin.gatewayMethods.join(", ")}`);
		if (plugin.providerIds.length > 0) lines.push(`${theme.muted("Providers:")} ${plugin.providerIds.join(", ")}`);
		if (plugin.cliCommands.length > 0) lines.push(`${theme.muted("CLI commands:")} ${plugin.cliCommands.join(", ")}`);
		if (plugin.services.length > 0) lines.push(`${theme.muted("Services:")} ${plugin.services.join(", ")}`);
		if (plugin.error) lines.push(`${theme.error("Error:")} ${plugin.error}`);
		if (install) {
			lines.push("");
			lines.push(`${theme.muted("Install:")} ${install.source}`);
			if (install.spec) lines.push(`${theme.muted("Spec:")} ${install.spec}`);
			if (install.sourcePath) lines.push(`${theme.muted("Source path:")} ${shortenHomePath(install.sourcePath)}`);
			if (install.installPath) lines.push(`${theme.muted("Install path:")} ${shortenHomePath(install.installPath)}`);
			if (install.version) lines.push(`${theme.muted("Recorded version:")} ${install.version}`);
			if (install.installedAt) lines.push(`${theme.muted("Installed at:")} ${install.installedAt}`);
		}
		defaultRuntime.log(lines.join("\n"));
	});
	plugins.command("enable").description("Enable a plugin in config").argument("<id>", "Plugin id").action(async (id) => {
		const cfg = loadConfig();
		let next = {
			...cfg,
			plugins: {
				...cfg.plugins,
				entries: {
					...cfg.plugins?.entries,
					[id]: {
						...(cfg.plugins?.entries)?.[id],
						enabled: true
					}
				}
			}
		};
		const slotResult = applySlotSelectionForPlugin(next, id);
		next = slotResult.config;
		await writeConfigFile(next);
		logSlotWarnings(slotResult.warnings);
		defaultRuntime.log(`Enabled plugin "${id}". Restart the gateway to apply.`);
	});
	plugins.command("disable").description("Disable a plugin in config").argument("<id>", "Plugin id").action(async (id) => {
		const cfg = loadConfig();
		await writeConfigFile({
			...cfg,
			plugins: {
				...cfg.plugins,
				entries: {
					...cfg.plugins?.entries,
					[id]: {
						...(cfg.plugins?.entries)?.[id],
						enabled: false
					}
				}
			}
		});
		defaultRuntime.log(`Disabled plugin "${id}". Restart the gateway to apply.`);
	});
	plugins.command("uninstall").description("Uninstall a plugin").argument("<id>", "Plugin id").option("--keep-files", "Keep installed files on disk", false).option("--keep-config", "Deprecated alias for --keep-files", false).option("--force", "Skip confirmation prompt", false).option("--dry-run", "Show what would be removed without making changes", false).action(async (id, opts) => {
		const cfg = loadConfig();
		const report = buildPluginStatusReport({ config: cfg });
		const extensionsDir = path.join(resolveStateDir(process.env, os.homedir), "extensions");
		const keepFiles = Boolean(opts.keepFiles || opts.keepConfig);
		if (opts.keepConfig) defaultRuntime.log(theme.warn("`--keep-config` is deprecated, use `--keep-files`."));
		const plugin = report.plugins.find((p) => p.id === id || p.name === id);
		const pluginId = plugin?.id ?? id;
		const hasEntry = pluginId in (cfg.plugins?.entries ?? {});
		const hasInstall = pluginId in (cfg.plugins?.installs ?? {});
		if (!hasEntry && !hasInstall) {
			if (plugin) defaultRuntime.error(`Plugin "${pluginId}" is not managed by plugins config/install records and cannot be uninstalled.`);
			else defaultRuntime.error(`Plugin not found: ${id}`);
			process.exit(1);
		}
		const install = cfg.plugins?.installs?.[pluginId];
		const isLinked = install?.source === "path";
		const preview = [];
		if (hasEntry) preview.push("config entry");
		if (hasInstall) preview.push("install record");
		if (cfg.plugins?.allow?.includes(pluginId)) preview.push("allowlist entry");
		if (isLinked && install?.sourcePath && cfg.plugins?.load?.paths?.includes(install.sourcePath)) preview.push("load path");
		if (cfg.plugins?.slots?.memory === pluginId) preview.push(`memory slot (will reset to "memory-core")`);
		const deleteTarget = !keepFiles ? resolveUninstallDirectoryTarget({
			pluginId,
			hasInstall,
			installRecord: install,
			extensionsDir
		}) : null;
		if (deleteTarget) preview.push(`directory: ${shortenHomePath(deleteTarget)}`);
		const pluginName = plugin?.name || pluginId;
		defaultRuntime.log(`Plugin: ${theme.command(pluginName)}${pluginName !== pluginId ? theme.muted(` (${pluginId})`) : ""}`);
		defaultRuntime.log(`Will remove: ${preview.length > 0 ? preview.join(", ") : "(nothing)"}`);
		if (opts.dryRun) {
			defaultRuntime.log(theme.muted("Dry run, no changes made."));
			return;
		}
		if (!opts.force) {
			if (!await promptYesNo(`Uninstall plugin "${pluginId}"?`)) {
				defaultRuntime.log("Cancelled.");
				return;
			}
		}
		const result = await uninstallPlugin({
			config: cfg,
			pluginId,
			deleteFiles: !keepFiles,
			extensionsDir
		});
		if (!result.ok) {
			defaultRuntime.error(result.error);
			process.exit(1);
		}
		for (const warning of result.warnings) defaultRuntime.log(theme.warn(warning));
		await writeConfigFile(result.config);
		const removed = [];
		if (result.actions.entry) removed.push("config entry");
		if (result.actions.install) removed.push("install record");
		if (result.actions.allowlist) removed.push("allowlist");
		if (result.actions.loadPath) removed.push("load path");
		if (result.actions.memorySlot) removed.push("memory slot");
		if (result.actions.directory) removed.push("directory");
		defaultRuntime.log(`Uninstalled plugin "${pluginId}". Removed: ${removed.length > 0 ? removed.join(", ") : "nothing"}.`);
		defaultRuntime.log("Restart the gateway to apply changes.");
	});
	plugins.command("install").description("Install a plugin (path, archive, or npm spec)").argument("<path-or-spec>", "Path (.ts/.js/.zip/.tgz/.tar.gz) or an npm package spec").option("-l, --link", "Link a local path instead of copying", false).option("--pin", "Record npm installs as exact resolved <name>@<version>", false).action(async (raw, opts) => {
		const fileSpec = resolveFileNpmSpecToLocalPath(raw);
		if (fileSpec && !fileSpec.ok) {
			defaultRuntime.error(fileSpec.error);
			process.exit(1);
		}
		const resolved = resolveUserPath(fileSpec && fileSpec.ok ? fileSpec.path : raw);
		const cfg = loadConfig();
		if (fs.existsSync(resolved)) {
			if (opts.link) {
				const existing = cfg.plugins?.load?.paths ?? [];
				const merged = Array.from(new Set([...existing, resolved]));
				const probe = await installPluginFromPath({
					path: resolved,
					dryRun: true
				});
				if (!probe.ok) {
					defaultRuntime.error(probe.error);
					process.exit(1);
				}
				let next = enablePluginInConfig({
					...cfg,
					plugins: {
						...cfg.plugins,
						load: {
							...cfg.plugins?.load,
							paths: merged
						}
					}
				}, probe.pluginId);
				next = recordPluginInstall(next, {
					pluginId: probe.pluginId,
					source: "path",
					sourcePath: resolved,
					installPath: resolved,
					version: probe.version
				});
				const slotResult = applySlotSelectionForPlugin(next, probe.pluginId);
				next = slotResult.config;
				await writeConfigFile(next);
				logSlotWarnings(slotResult.warnings);
				defaultRuntime.log(`Linked plugin path: ${shortenHomePath(resolved)}`);
				defaultRuntime.log(`Restart the gateway to load plugins.`);
				return;
			}
			const result = await installPluginFromPath({
				path: resolved,
				logger: createPluginInstallLogger()
			});
			if (!result.ok) {
				defaultRuntime.error(result.error);
				process.exit(1);
			}
			clearPluginManifestRegistryCache();
			let next = enablePluginInConfig(cfg, result.pluginId);
			const source = resolveArchiveKind(resolved) ? "archive" : "path";
			next = recordPluginInstall(next, {
				pluginId: result.pluginId,
				source,
				sourcePath: resolved,
				installPath: result.targetDir,
				version: result.version
			});
			const slotResult = applySlotSelectionForPlugin(next, result.pluginId);
			next = slotResult.config;
			await writeConfigFile(next);
			logSlotWarnings(slotResult.warnings);
			defaultRuntime.log(`Installed plugin: ${result.pluginId}`);
			defaultRuntime.log(`Restart the gateway to load plugins.`);
			return;
		}
		if (opts.link) {
			defaultRuntime.error("`--link` requires a local path.");
			process.exit(1);
		}
		if (raw.startsWith(".") || raw.startsWith("~") || path.isAbsolute(raw) || raw.endsWith(".ts") || raw.endsWith(".js") || raw.endsWith(".mjs") || raw.endsWith(".cjs") || raw.endsWith(".tgz") || raw.endsWith(".tar.gz") || raw.endsWith(".tar") || raw.endsWith(".zip")) {
			defaultRuntime.error(`Path not found: ${resolved}`);
			process.exit(1);
		}
		const result = await installPluginFromNpmSpec({
			spec: raw,
			logger: createPluginInstallLogger()
		});
		if (!result.ok) {
			defaultRuntime.error(result.error);
			process.exit(1);
		}
		clearPluginManifestRegistryCache();
		let next = enablePluginInConfig(cfg, result.pluginId);
		const resolvedSpec = result.npmResolution?.resolvedSpec;
		const recordSpec = opts.pin && resolvedSpec ? resolvedSpec : raw;
		if (opts.pin && !resolvedSpec) defaultRuntime.log(theme.warn("Could not resolve exact npm version for --pin; storing original npm spec."));
		if (opts.pin && resolvedSpec) defaultRuntime.log(`Pinned npm install record to ${resolvedSpec}.`);
		next = recordPluginInstall(next, {
			pluginId: result.pluginId,
			source: "npm",
			spec: recordSpec,
			installPath: result.targetDir,
			version: result.version,
			resolvedName: result.npmResolution?.name,
			resolvedVersion: result.npmResolution?.version,
			resolvedSpec: result.npmResolution?.resolvedSpec,
			integrity: result.npmResolution?.integrity,
			shasum: result.npmResolution?.shasum,
			resolvedAt: result.npmResolution?.resolvedAt
		});
		const slotResult = applySlotSelectionForPlugin(next, result.pluginId);
		next = slotResult.config;
		await writeConfigFile(next);
		logSlotWarnings(slotResult.warnings);
		defaultRuntime.log(`Installed plugin: ${result.pluginId}`);
		defaultRuntime.log(`Restart the gateway to load plugins.`);
	});
	plugins.command("update").description("Update installed plugins (npm installs only)").argument("[id]", "Plugin id (omit with --all)").option("--all", "Update all tracked plugins", false).option("--dry-run", "Show what would change without writing", false).action(async (id, opts) => {
		const cfg = loadConfig();
		const installs = cfg.plugins?.installs ?? {};
		const targets = opts.all ? Object.keys(installs) : id ? [id] : [];
		if (targets.length === 0) {
			if (opts.all) {
				defaultRuntime.log("No npm-installed plugins to update.");
				return;
			}
			defaultRuntime.error("Provide a plugin id or use --all.");
			process.exit(1);
		}
		const result = await updateNpmInstalledPlugins({
			config: cfg,
			pluginIds: targets,
			dryRun: opts.dryRun,
			logger: {
				info: (msg) => defaultRuntime.log(msg),
				warn: (msg) => defaultRuntime.log(theme.warn(msg))
			},
			onIntegrityDrift: async (drift) => {
				const specLabel = drift.resolvedSpec ?? drift.spec;
				defaultRuntime.log(theme.warn(`Integrity drift detected for "${drift.pluginId}" (${specLabel})\nExpected: ${drift.expectedIntegrity}\nActual:   ${drift.actualIntegrity}`));
				if (drift.dryRun) return true;
				return await promptYesNo(`Continue updating "${drift.pluginId}" with this artifact?`);
			}
		});
		for (const outcome of result.outcomes) {
			if (outcome.status === "error") {
				defaultRuntime.log(theme.error(outcome.message));
				continue;
			}
			if (outcome.status === "skipped") {
				defaultRuntime.log(theme.warn(outcome.message));
				continue;
			}
			defaultRuntime.log(outcome.message);
		}
		if (!opts.dryRun && result.changed) {
			await writeConfigFile(result.config);
			defaultRuntime.log("Restart the gateway to load plugins.");
		}
	});
	plugins.command("doctor").description("Report plugin load issues").action(() => {
		const report = buildPluginStatusReport();
		const errors = report.plugins.filter((p) => p.status === "error");
		const diags = report.diagnostics.filter((d) => d.level === "error");
		if (errors.length === 0 && diags.length === 0) {
			defaultRuntime.log("No plugin issues detected.");
			return;
		}
		const lines = [];
		if (errors.length > 0) {
			lines.push(theme.error("Plugin errors:"));
			for (const entry of errors) lines.push(`- ${entry.id}: ${entry.error ?? "failed to load"} (${entry.source})`);
		}
		if (diags.length > 0) {
			if (lines.length > 0) lines.push("");
			lines.push(theme.warn("Diagnostics:"));
			for (const diag of diags) {
				const target = diag.pluginId ? `${diag.pluginId}: ` : "";
				lines.push(`- ${target}${diag.message}`);
			}
		}
		const docs = formatDocsLink("/plugin", "docs.openclaw.ai/plugin");
		lines.push("");
		lines.push(`${theme.muted("Docs:")} ${docs}`);
		defaultRuntime.log(lines.join("\n"));
	});
}

//#endregion
export { registerPluginsCli };