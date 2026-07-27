// A project is a folder on disk, so its name must be a legal directory name on
// Windows as well as POSIX. Anything the user's filename throws at us gets
// reduced to something `getDirectoryHandle` will accept â€” otherwise the create
// throws and is swallowed by RealDir.getDir's catch, silently yielding no project.

const ILLEGAL = /[\\\/:*?"<>|\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_LENGTH = 100;

export function sanitizeProjectName(input: string): string {
  let name = input.replace(/\.(ged|gedcom)$/i, '');
  name = name.replace(ILLEGAL, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/[. ]+$/, '');
  if (name.length > MAX_LENGTH) name = name.slice(0, MAX_LENGTH).trim();
  // Windows reserves these regardless of extension: CON.txt is as illegal as CON.
  const stem = name.split('.')[0] ?? '';
  if (RESERVED.test(stem)) name = `${name} (project)`;
  return name === '' ? 'Untitled' : name;
}

/** First free name in the series `base`, `base (2)`, `base (3)`, â€¦ */
export function uniqueProjectName(base: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

