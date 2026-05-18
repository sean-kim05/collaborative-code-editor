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
