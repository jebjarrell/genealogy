import { useMemo, useState } from 'react';
import {
  SAR_RULES,
  SERVICE_KEY,
  generateChecklistStructure,
  evaluateChecklist,
  formatSarDate,
  formatSarPlace,
  type ChecklistStructure,
  type LineageLink,
  type Proof,
  type ProofStatus,
} from '@genealogy/core';
import { useStore } from '../state/store.js';
import { primaryName } from '../graph/personDisplay.js';
import { LocalityReport } from './LocalityReport.js';
import type { SarChecklistState } from '../fs/project.js';

// SAR proof-checklist surface (handoff §5). Pick a patriot; the lineage links +
// the service item are derived from an enumerated ancestral path (collapse-safe).
// Each item is proven by a vault document or a record-copy tie-in (post-1985
// cutoff + multi-generation spans enforced by the core engine). Unproven links
// hand off to the locality research report.

const STATUS_BADGE: Record<ProofStatus, { label: string; cls: string }> = {
  'sourced-by-document': { label: 'document', cls: 'bg-emerald-100 text-emerald-800' },
  'proven-by-record-copy': { label: 'record copy', cls: 'bg-blue-100 text-blue-800' },
  unproven: { label: 'unproven', cls: 'bg-red-100 text-red-800' },
};

function sarVitals(
  model: ReturnType<typeof useStore.getState>['model'],
  personId: string,
): string {
  if (!model) return '';
  const person = model.persons.get(personId);
  if (!person) return personId;
  let birth = '';
  let place = '';
  for (const id of person.eventIds) {
    const ev = model.events.get(id);
    if (ev?.type === 'birth') {
      birth = formatSarDate(ev.date);
      place = formatSarPlace(ev.place);
      break;
    }
  }
  return [birth, place].filter(Boolean).join(' · ');
}

function RecordCopyForm({
  onAdd,
  service,
}: {
  onAdd: (proof: Extract<Proof, { kind: 'record-copy' }>, generations: number) => void;
  service: boolean;
}) {
  const [society, setSociety] = useState<'SAR' | 'DAR'>('DAR');
  const [nationalNumber, setNationalNumber] = useState('');
  const [patriotName, setPatriotName] = useState('');
  const [approvedYear, setApprovedYear] = useState('');
  const [generations, setGenerations] = useState('1');
  const [serviceProofCited, setServiceProofCited] = useState('');

  const year = Number.parseInt(approvedYear, 10);
  const valid = nationalNumber.trim() !== '' && patriotName.trim() !== '' && !Number.isNaN(year);

  return (
    <div className="mt-1 space-y-1 rounded border border-blue-200 bg-blue-50 p-2 text-xs">
      <div className="flex flex-wrap gap-1">
        <select
          className="rounded border border-gray-300 px-1 py-0.5"
          value={society}
          onChange={(e) => setSociety(e.target.value as 'SAR' | 'DAR')}
        >
          <option value="DAR">DAR</option>
          <option value="SAR">SAR</option>
        </select>
        <input
          className="w-28 rounded border border-gray-300 px-1 py-0.5"
          placeholder="National #"
          value={nationalNumber}
          onChange={(e) => setNationalNumber(e.target.value)}
        />
        <input
          className="w-20 rounded border border-gray-300 px-1 py-0.5"
          placeholder="Year"
          value={approvedYear}
          onChange={(e) => setApprovedYear(e.target.value)}
        />
        {!service && (
          <input
            className="w-28 rounded border border-gray-300 px-1 py-0.5"
            placeholder="Covers gens"
            value={generations}
            onChange={(e) => setGenerations(e.target.value)}
            title="How many consecutive links up the line this record copy covers"
          />
        )}
      </div>
      <input
        className="w-full rounded border border-gray-300 px-1 py-0.5"
        placeholder="Patriot name (tie-in)"
        value={patriotName}
        onChange={(e) => setPatriotName(e.target.value)}
      />
      {service && (
        <input
          className="w-full rounded border border-gray-300 px-1 py-0.5"
          placeholder="Underlying service proof cited (e.g. VA pension S12345)"
          value={serviceProofCited}
          onChange={(e) => setServiceProofCited(e.target.value)}
        />
      )}
      {!Number.isNaN(year) && year < SAR_RULES.recordCopyCutoffYear && (
        <p className="text-[11px] text-amber-700">
          Pre-1985 — recorded but not sufficient alone.
        </p>
      )}
      <button
        className="rounded bg-blue-600 px-2 py-0.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        disabled={!valid}
        onClick={() =>
          onAdd(
            {
              kind: 'record-copy',
              coveredKeys: [],
              society,
              nationalNumber: nationalNumber.trim(),
              patriotName: patriotName.trim(),
              approvedYear: year,
              ...(service && serviceProofCited.trim()
                ? { serviceProofCited: serviceProofCited.trim() }
                : {}),
            },
            Math.max(1, Number.parseInt(generations, 10) || 1),
          )
        }
      >
        Add record copy
      </button>
    </div>
  );
}

function ChecklistCard({ checklist }: { checklist: SarChecklistState }) {
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  const focalPersonId = useStore((s) => s.focalPersonId);
  const vaultDocs = useStore((s) => s.vaultDocs);
  const workspace = useStore((s) => s.workspace);
  const addChecklistProof = useStore((s) => s.addChecklistProof);
  const removeChecklistProof = useStore((s) => s.removeChecklistProof);
  const linkDocumentToChecklist = useStore((s) => s.linkDocumentToChecklist);
  const deleteChecklist = useStore((s) => s.deleteChecklist);

  const [recordCopyFor, setRecordCopyFor] = useState<string | null>(null);
  const [localityFor, setLocalityFor] = useState<string | null>(null);

  const structure: ChecklistStructure | null = useMemo(() => {
    if (!graph || !focalPersonId) return null;
    return generateChecklistStructure(SAR_RULES, graph, focalPersonId, checklist.patriotId);
  }, [graph, focalPersonId, checklist.patriotId]);

  if (!model || !graph || !structure) return null;

  const evaluation = evaluateChecklist(SAR_RULES, structure, checklist.proofs);
  const patriotName = model.persons.get(checklist.patriotId)
    ? primaryName(model.persons.get(checklist.patriotId)!)
    : checklist.patriotId;
  const pct = Math.round(evaluation.completeness * 100);

  const nameOf = (id: string) =>
    model.persons.get(id) ? primaryName(model.persons.get(id)!) : id;

  /** Add a record copy covering `generations` consecutive links starting at `startKey`. */
  const addRecordCopy = (
    startKey: string,
    proof: Extract<Proof, { kind: 'record-copy' }>,
    generations: number,
  ) => {
    let coveredKeys: string[];
    if (startKey === SERVICE_KEY) {
      coveredKeys = [SERVICE_KEY];
    } else {
      const startIdx = structure.links.findIndex((l) => l.key === startKey);
      coveredKeys = structure.links
        .slice(startIdx, startIdx + generations)
        .map((l) => l.key);
    }
    addChecklistProof(checklist.id, { ...proof, coveredKeys });
    setRecordCopyFor(null);
  };

  const renderProofControls = (key: string, service: boolean) => (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {workspace && vaultDocs.length > 0 ? (
          <select
            className="rounded border border-gray-300 px-1 py-0.5 text-xs"
            value=""
            onChange={(e) => {
              if (e.target.value) linkDocumentToChecklist(checklist.id, key, e.target.value);
            }}
          >
            <option value="">Link vault document…</option>
            {vaultDocs.map((d) => (
              <option key={d.docId} value={d.docId}>
                {d.originalName}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[11px] text-gray-400">
            {workspace ? 'No vault documents yet' : 'Connect a workspace to link documents'}
          </span>
        )}
        <button
          className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100"
          onClick={() => setRecordCopyFor(recordCopyFor === key ? null : key)}
        >
          Record copy
        </button>
      </div>
      {recordCopyFor === key && (
        <RecordCopyForm service={service} onAdd={(p, g) => addRecordCopy(key, p, g)} />
      )}
    </div>
  );

  const renderLink = (link: LineageLink) => {
    const ev = evaluation.links.find((l) => l.link.key === link.key)!;
    const badge = STATUS_BADGE[ev.status];
    return (
      <li key={link.key} className="rounded border border-gray-200 bg-white p-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-800">
              {nameOf(link.childId)} → {nameOf(link.parentId)}
              <span className="ml-1 text-[11px] text-gray-400">gen {link.generation}</span>
            </div>
            <div className="text-[11px] text-gray-400">{sarVitals(model, link.parentId)}</div>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${badge.cls}`}>
            {badge.label}
          </span>
        </div>
        {ev.recordCopy && (
          <div className="mt-0.5 text-[11px] text-gray-500">
            {ev.recordCopy.society}# {ev.recordCopy.nationalNumber} · {ev.recordCopy.patriotName} ·{' '}
            {ev.recordCopy.approvedYear}
            {!ev.recordCopy.sufficient && (
              <span className="text-amber-700"> — pre-1985, insufficient alone</span>
            )}
          </div>
        )}
        {ev.status === 'unproven' && (
          <>
            {renderProofControls(link.key, false)}
            <button
              className="mt-1 text-[11px] text-emerald-700 hover:underline"
              onClick={() => setLocalityFor(localityFor === link.key ? null : link.key)}
            >
              {localityFor === link.key ? 'Hide' : 'Where to look →'} locality report
            </button>
            {localityFor === link.key && (
              <div className="mt-1">
                <LocalityReport ancestorId={link.parentId} />
              </div>
            )}
          </>
        )}
      </li>
    );
  };

  const serviceBadge = STATUS_BADGE[evaluation.service.status];

  return (
    <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-gray-900">Patriot: {patriotName}</h3>
          <p className="text-xs text-gray-500">
            {structure.reachable
              ? `${structure.links.length} lineage link${structure.links.length === 1 ? '' : 's'} + service`
              : 'Patriot is not an ancestor of the focal person.'}
            {structure.truncated && ' · line capped'}
          </p>
        </div>
        <button
          className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-white"
          onClick={() => deleteChecklist(checklist.id)}
        >
          Remove
        </button>
      </div>

      {/* completeness */}
      <div className="mt-2">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>
            {evaluation.proven} / {evaluation.total} proven
          </span>
          <span>{pct}%</span>
        </div>
        <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* service item */}
      <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-gray-800">{SAR_RULES.serviceItemLabel}</div>
            {evaluation.service.citation && (
              <div className="text-[11px] text-gray-600">{evaluation.service.citation}</div>
            )}
            {evaluation.service.recordCopy && (
              <div className="text-[11px] text-gray-500">
                {evaluation.service.recordCopy.society}# {evaluation.service.recordCopy.nationalNumber} ·{' '}
                {evaluation.service.recordCopy.approvedYear}
                {!evaluation.service.recordCopy.sufficient && (
                  <span className="text-amber-700"> — pre-1985, insufficient alone</span>
                )}
              </div>
            )}
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${serviceBadge.cls}`}>
            {serviceBadge.label}
          </span>
        </div>
        {evaluation.service.status === 'unproven' && renderProofControls(SERVICE_KEY, true)}
      </div>

      {/* lineage links */}
      {structure.reachable && (
        <ul className="mt-3 space-y-2">{structure.links.map(renderLink)}</ul>
      )}

      {/* proofs on file */}
      {checklist.proofs.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Proofs on file
          </div>
          <ul className="mt-1 space-y-1">
            {checklist.proofs.map((p, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-white p-1.5 text-xs"
              >
                <span className="min-w-0 truncate text-gray-700">
                  {p.kind === 'document'
                    ? `Document → ${p.linkKey === SERVICE_KEY ? 'service' : p.linkKey}`
                    : `${p.society}# ${p.nationalNumber} (${p.approvedYear}) covers ${p.coveredKeys.length} item(s)`}
                </span>
                <button
                  className="shrink-0 text-red-600 hover:underline"
                  onClick={() => removeChecklistProof(checklist.id, i)}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function SarPanel() {
  const model = useStore((s) => s.model);
  const focalPersonId = useStore((s) => s.focalPersonId);
  const detailPersonId = useStore((s) => s.detailPersonId);
  const checklists = useStore((s) => s.checklists);
  const createChecklist = useStore((s) => s.createChecklist);

  if (!model) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        Load a file to build an SAR proof checklist.
      </div>
    );
  }
  if (!focalPersonId) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        Choose a focal person (the applicant) first.
      </div>
    );
  }

  const detailName =
    detailPersonId && model.persons.get(detailPersonId)
      ? primaryName(model.persons.get(detailPersonId)!)
      : null;

  return (
    <div className="h-full overflow-y-auto bg-gray-100 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">SAR proof checklist</h2>
          <p className="text-sm text-gray-500">
            Sons of the American Revolution. Select a patriot ancestor in your tree; the
            child-to-parent links and the patriot’s service item are tracked with three-state
            proof. Lineage stops at the patriot.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white p-2">
          <span className="text-sm text-gray-600">
            {detailName ? (
              <>
                Selected: <span className="font-medium">{detailName}</span>
              </>
            ) : (
              'Select a person in the graph to choose them as the patriot.'
            )}
          </span>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            disabled={!detailPersonId || detailPersonId === focalPersonId}
            onClick={() => detailPersonId && createChecklist(detailPersonId)}
            title="Create a checklist for the selected person as patriot ancestor"
          >
            Use as patriot ancestor
          </button>
        </div>

        {checklists.length === 0 ? (
          <p className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            No checklists yet. Select your patriot ancestor in the graph, then “Use as patriot
            ancestor”.
          </p>
        ) : (
          <div className="space-y-4">
            {checklists.map((c) => (
              <ChecklistCard key={c.id} checklist={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
