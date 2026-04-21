const PALETTE = [
  '#F87171', '#FB923C', '#FBBF24', '#34D399',
  '#38BDF8', '#818CF8', '#E879F9', '#F472B6',
];

export function getUserColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
