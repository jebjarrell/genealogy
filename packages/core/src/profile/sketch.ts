import type { Event, GenealogyModel, Graph, Person, Sex } from '../types/index.js';
import { militaryServiceOf } from '../military/wars.js';
import { firstEvent } from '../model/person-events.js';

// A compact, FamilySearch-style summary of a person for the profile header.
// Pure: derived from the model + graph, no rendering concerns. The detail panel
// keeps the full event/relationship/source lists below this sketch.

export interface SketchEvent {
  /** Verbatim date string (preserved). */
  dateRaw?: string;
  year?: number;
  /** Verbatim place string (preserved). */
  place?: string;
}

export interface SketchSpouse {
  id: string;
  name: string;
}

export interface PersonSketch {
  id: string;
  name: string;
  sex: Sex;
  birth?: SketchEvent;
  death?: SketchEvent;
  /** Years between birth and death when both are known. */
  ageAtDeath?: number;
  spouses: SketchSpouse[];
  childrenCount: number;
  military: { served: boolean; wars: string[] };
}

function primaryName(person: Person): string {
  const n = person.names[0];
  return (n?.full || n?.raw || '(unnamed)').trim();
}

function sketchEvent(event: Event | undefined): SketchEvent | undefined {
  if (!event) return undefined;
  const out: SketchEvent = {};
  if (event.date?.raw) out.dateRaw = event.date.raw;
  if (event.date?.year !== undefined) out.year = event.date.year;
  if (event.place?.raw) out.place = event.place.raw;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Build the bio sketch for a person; null if the id is unknown. */
export function personSketch(
  model: GenealogyModel,
  graph: Graph,
  personId: string,
): PersonSketch | null {
  const person = model.persons.get(personId);
  if (!person) return null;

  const birth = sketchEvent(firstEvent(person, model, 'birth'));
  const death = sketchEvent(firstEvent(person, model, 'death'));
  const service = militaryServiceOf(model, personId);

  const spouses: SketchSpouse[] = (graph.spousesOf.get(personId) ?? [])
    .map((id) => {
      const p = model.persons.get(id);
      return p ? { id, name: primaryName(p) } : null;
    })
    .filter((s): s is SketchSpouse => s !== null);

  const sketch: PersonSketch = {
    id: personId,
    name: primaryName(person),
    sex: person.sex,
    spouses,
    childrenCount: (graph.childrenOf.get(personId) ?? []).length,
    military: { served: service.served, wars: service.wars.map((w) => w.name) },
  };
  if (birth) sketch.birth = birth;
  if (death) sketch.death = death;
  if (birth?.year !== undefined && death?.year !== undefined) {
    sketch.ageAtDeath = death.year - birth.year;
  }
  return sketch;
}
