/** Full speaking turns in podcast-turns-v3.mp4; transitions remain in the quiet gaps. */
export const HERO_CONVERSATION_DURATION = 12.25;

export function heroSpeakerAt(time: number): number {
  if (time >= 0.5 && time < 3.75) return 0;
  if (time >= 4.5 && time < 7.75) return 1;
  if (time >= 8.5 && time < 11.75) return 2;
  return -1;
}
