// What this app keeps in localStorage, under `tapry:<name>`. Before the rename to Tapry the
// keys were `opentake:<name>`: those are still read, so a guest's ticket, device choices and
// filters from an older version are found, and the next save writes the new key.
// Storage can be missing or throw (private mode, blocked site data): callers guard every call.
const key = (name: string) => `tapry:${name}`;
const oldKey = (name: string) => `opentake:${name}`;

export function readStored(name: string): string | null {
  return localStorage.getItem(key(name)) ?? localStorage.getItem(oldKey(name));
}

export function writeStored(name: string, value: string) {
  localStorage.setItem(key(name), value);
}

export function removeStored(name: string) {
  localStorage.removeItem(key(name));
  localStorage.removeItem(oldKey(name));
}
