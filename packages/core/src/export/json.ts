import type { GenealogyModel } from '../types/model.js';

// Lossless export of this app's own model (Maps → arrays). Re-importable by the
// app later; unlike the GEDCOM writer it preserves every modeled field exactly.

export interface ExportedModelJson {
  format: 'genealogy-knowledge-graph/model';
  version: 1;
  header?: GenealogyModel['header'];
  persons: unknown[];
  families: unknown[];
  events: unknown[];
  places: unknown[];
}

/** Serialize the model to a pretty-printed JSON string. */
export function exportModelJson(model: GenealogyModel): string {
  const payload: ExportedModelJson = {
    format: 'genealogy-knowledge-graph/model',
    version: 1,
    persons: [...model.persons.values()],
    families: [...model.families.values()],
    events: [...model.events.values()],
    places: [...model.places.values()],
  };
  if (model.header !== undefined) payload.header = model.header;
  return JSON.stringify(payload, null, 2);
}
