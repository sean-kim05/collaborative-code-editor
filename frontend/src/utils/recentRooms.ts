/**
 * Recently-visited rooms, in localStorage.
 *
 * Rooms have no owner and no directory, so a link is the only handle you have
 * on one — losing it means losing the room. This is the client-side substitute
 * for the "your projects" list an account system would provide.
 *
 * Every read is defensive (`try`/`catch` plus a shape check) because
 * localStorage is shared, user-editable, and can be disabled outright in
 * private-browsing modes: a corrupt entry degrades to an empty list rather than
 * throwing on app start.
 */
const STORAGE_KEY = 'collab_recent_rooms';
const MAX_ROOMS = 10;

export type RecentRoom = {
  roomId: string;
  visitedAt: number;
};

function read(): RecentRoom[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => r && typeof r.roomId === 'string' && typeof r.visitedAt === 'number');
  } catch {
    return [];
  }
}

function write(rooms: RecentRoom[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  } catch {
    /* quota or disabled — ignore */
  }
}

export function getRecentRooms(): RecentRoom[] {
  return read().sort((a, b) => b.visitedAt - a.visitedAt);
}

/** Record a visit. Remove-then-unshift keeps the list MRU-ordered and free of
 *  duplicates in one pass; the tail beyond `MAX_ROOMS` is dropped. */
export function addRecentRoom(roomId: string): void {
  if (!roomId) return;
  const now = Date.now();
  const filtered = read().filter((r) => r.roomId !== roomId);
  filtered.unshift({ roomId, visitedAt: now });
  write(filtered.slice(0, MAX_ROOMS));
}

export function removeRecentRoom(roomId: string): void {
  write(read().filter((r) => r.roomId !== roomId));
}

/** "just now" / "5m ago" / "3h ago" / "2d ago", falling back to an absolute
 *  date past a month — beyond that, relative time stops being informative. */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
