// Small wrappers around Web Storage that never throw (private mode, blocked storage, ...).

const NAME_KEY = 'n5-name';
const MUTED_KEY = 'n5-muted';
const hostKeyKey = (roomId: string) => `n5-host-${roomId}`;
const tokenKey = (roomId: string) => `n5-token-${roomId}`;

function get(storage: () => Storage, key: string): string | undefined {
  try {
    return storage().getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function set(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    // Storage unavailable: the game still works, only reconnects are lost.
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

export const savedName = () => get(local, NAME_KEY);
export const saveName = (name: string) => set(local, NAME_KEY, name);
export const savedMuted = () => get(local, MUTED_KEY) === '1';
export const saveMuted = (muted: boolean) => set(local, MUTED_KEY, muted ? '1' : '0');

// Session storage keeps identities per tab, so several tabs can play in the same room.
export const savedHostKey = (roomId: string) => get(session, hostKeyKey(roomId));
export const saveHostKey = (roomId: string, key: string) => set(session, hostKeyKey(roomId), key);
export const savedToken = (roomId: string) => get(session, tokenKey(roomId));
export const saveToken = (roomId: string, token: string) => set(session, tokenKey(roomId), token);
