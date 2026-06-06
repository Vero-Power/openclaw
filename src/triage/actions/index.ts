import { coperniqFirestoreIngestAction } from "./gcf/coperniq-firestore-ingest.js";
import { ActionRegistry } from "./registry.js";

/**
 * Day-one action catalog. Other actions (remaining 5 gcf functions, Slack ops,
 * GitHub ops, Coperniq direct, notify shortcuts, filing, bash escape hatch)
 * are added in the follow-up plan `phase3-catalog-buildout.md`.
 */
export function bootstrapActionCatalog(): ActionRegistry {
  const reg = new ActionRegistry();
  reg.register(coperniqFirestoreIngestAction);
  return reg;
}

export { ActionRegistry } from "./registry.js";
export type { CatalogAction, ActionContext } from "./types.js";
