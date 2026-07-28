# Full Relationship Editing — Design

**Date:** 2026-07-28
**Status:** Approved, building

## Problem

Relationship editing is half-built. You can add a **new** person and attach them
as a parent, child, or spouse. You cannot:

1. Link a person who **already exists** in the tree to anyone. The only way to
   record "this existing man is actually his father" is to create a duplicate.
2. Remove a spouse link. Parent-child removal shipped on 2026-07-27; spouse
   links have no control at all.

Both gaps matter most when correcting an imported GEDCOM, which is the dominant
use of this app. The engine already supports every operation involved; only the
store and the UI are missing.

## What already works

- `applyLink` in `packages/core/src/edit/ops.ts` accepts an **existing**
  `familyId`. `familyCopy` copies the family when it exists and creates one when
  it does not, so adding a parent to an established family needs no core change.
- `applyUnlink` with `relation: 'spouse'` strips only `spouseIds` and leaves
  `childIds` untouched, so removing a spouse leaves the children attached to the
  family with the remaining parent. That is the correct semantic and needs no
  core change either.
- `unlinkRelationship` already exists on the store.
- `walk` in `graph/traversal.ts` carries a `seen` set, so a cycle in the data
  terminates traversal rather than hanging.

The single blocking limitation is in the store: `linkRelationship` always mints a
new family id via `nextId(model.families.keys(), 'FU')`, so every attach creates
a fresh couple. That is how a child ends up with two separate parent families.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Join the obvious family silently; ask **only when ambiguous** | One candidate is the common case and should be one click. Several candidates (a remarriage) is a real case in this data - `multiple-marriages.ged` is an existing fixture - and guessing there produces a wrong tree. |
| 2 | **Block** cycles and self-links; **warn** on implausible dates | A person cannot be their own ancestor, and a cycle silently corrupts generation numbering and pedigree-collapse output with nothing pointing back to the edit. Dates in sources are frequently estimates, so date problems inform rather than refuse. |
| 3 | **Search first, create as fallback** | Correcting an imported tree means most people already exist. The add button opens a search; the last row is always "Create a new person <query>", handing off to the existing create form. |

## Non-goals

- Fixing `Person.familyIdAsChild` being singular. When a child joins a second
  family `applyLink` overwrites it. Parent lists render correctly because they
  derive from families' `childIds`, but a GEDCOM export will show one `FAMC`
  where the UI showed two. Pre-existing; out of scope.
- Divorce (`DIV`) or any other family-level event. Removing a spouse link
  records that the link is not there, not why.
- Merging duplicate people. That already exists separately.

## Architecture

### Core: which families can a link join?

New `packages/core/src/edit/link-targets.ts`:

```ts
export interface FamilyCandidate {
  familyId: string;
  spouseIds: string[];
  childIds: string[];
}

export function candidateFamiliesForParent(
  model: GenealogyModel, childId: string,
): FamilyCandidate[];

export function candidateFamiliesForChild(
  model: GenealogyModel, parentId: string,
): FamilyCandidate[];
```

`ForParent` returns the families the child already belongs to, so a new parent
can join one. `ForChild` returns the families where the parent is recorded as a
spouse, so a new child can join one. Both return them in model order.

An empty result means "create a new family". A single result is joined without
asking. Several means the UI shows a chooser, which always also offers a new
family. The UI never decides which family on its own.

### Core: should the link be allowed?

New `packages/core/src/edit/link-validation.ts`:

```ts
export type LinkSeverity = 'block' | 'warn';
export interface LinkIssue { severity: LinkSeverity; message: string }

export function checkParentChildLink(
  model: GenealogyModel, graph: Graph, parentId: string, childId: string,
): LinkIssue[];

export function checkSpouseLink(
  model: GenealogyModel, graph: Graph, aId: string, bId: string,
): LinkIssue[];
```

**Blocking:**
- Self-link (`parentId === childId`, or a person married to themself).
- Cycle: the proposed parent is already a descendant of the child. Implemented
  with `getDescendants(graph, childId)`, which is already cycle-safe.

**Warning:**
- Parent born after the child.
- Parent under 13 at the child's birth.
- Child born more than a year after the parent's death.
- The two people are already linked in that relationship.

Every date rule compares only when **both** dates are known and resolvable to a
year. A missing or unparseable date is never an objection.

### Store

`linkRelationship(relation, ids, familyId?)` gains an optional third argument.
When supplied, the op targets that family; when omitted, it mints a new id
exactly as today, so existing callers are unaffected.

Blocking validation lives in the store action, not only the modal, so no caller
can bypass it. A blocked link sets a notice and records no op. This makes
`linkRelationship` refuse cycles for **every** caller including the existing
create-and-attach flow - a deliberate widening.

Spouse removal needs no store change: `unlinkRelationship(familyId, 'spouse',
{ spouseAId, spouseBId })` already exists and already behaves correctly.

### UI

**`apps/web/src/panels/AttachPersonModal.tsx`** (new). Opened by the existing
add buttons in the detail panel. A search field over `store.search(query)`,
results showing name and lifespan, and a final row offering to create a new
person with the typed name - which hands off to the existing `PersonEditor`
unchanged.

Choosing an existing person resolves candidate families, shows the chooser only
when there is more than one, runs validation, and presents a single confirmation
naming both people and the family being joined. Blocking issues are shown with
no way to proceed; warnings are shown with an explicit override.

**Extract `RelationshipList` from `DetailPanel.tsx` into its own file.** It is
the most complex thing in a 440-line file and is about to gain a third detach
direction. Splitting it now keeps both files focused.

Spouse rows gain a remove control. Its confirmation differs from parent-child:
removing a spouse link does not affect children, and the copy says so rather
than reusing the couple warning.

## Testing

Core carries the load, matching how `family-link` was tested:

- **link-targets** - no family, exactly one, several (multiple marriages), and a
  parent whose families include one where they are a spouse but childless.
- **link-validation** - direct cycle, indirect cycle, self-link, each date rule
  at its boundary, unknown dates producing no issue, already-linked.
- **store** - an explicit family id is joined; omitting it mints a new one; a
  blocked link records no op and sets a notice.
- **UI** - search then pick then link; the ambiguous chooser; a blocked cycle
  offering no proceed; an overridden warning; spouse removal leaving children
  attached.

## Risks

| Risk | Mitigation |
|---|---|
| Blocking cycles changes behavior for existing callers | Intentional. Covered by a store test asserting the create-and-attach path is refused too. |
| Date parsing varies across GEDCOM formats | Compare only resolved years; treat anything unparseable as unknown and raise no issue. |
| The modal duplicates `FocalPicker`'s search UI | Accepted. They differ in purpose and result actions; a shared abstraction over two callers would be premature. |
