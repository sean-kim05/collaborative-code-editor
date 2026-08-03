const PALETTE = [
  '#F87171', '#FB923C', '#FBBF24', '#34D399',
  '#38BDF8', '#818CF8', '#E879F9', '#F472B6',
];

/**
 * Deterministically map a username to a palette colour.
 *
 * The point is that it's a *pure function of the name*, so every client derives
 * the same colour for the same person with no server coordination and no
 * assignment message — and the colour survives reconnects, unlike anything
 * keyed on a socket id.
 *
 * The hash is the classic `hash * 31 + char` (written as `<< 5` minus itself),
 * the same one Java's `String.hashCode` uses: cheap, and spreads short
 * similar strings ("sean1"/"sean2") across different buckets. `Math.abs` guards
 * against the int32 overflow that makes the accumulator go negative.
 *
 * Collisions are possible and fine — two people can share a colour; names are
 * shown next to cursors anyway.
 */
export function getUserColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
