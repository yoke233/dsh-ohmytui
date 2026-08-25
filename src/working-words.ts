/** Playful activity labels shown while the agent is working. */
export const WORKING_WORDS = [
  'Baking', 'Brewing', 'Caramelizing', 'Cooking', 'Fermenting', 'Flambeing',
  'Frosting', 'Garnishing', 'Julienning', 'Kneading', 'Leavening', 'Marinating',
  'Sauteing', 'Seasoning', 'Simmering', 'Stewing', 'Whisking', 'Drizzling',
  'Proofing', 'Creating', 'Crafting', 'Forming', 'Sketching', 'Composing',
  'Choreographing', 'Orchestrating', 'Architecting', 'Actualizing', 'Envisioning',
  'Imagining', 'Manifesting', 'Crystallizing', 'Embellishing', 'Synthesizing',
  'Ideating', 'Cultivating', 'Generating', 'Germinating', 'Harmonizing', 'Blanching',
  'Dilly-dallying', 'Fiddle-faddling', 'Flibbertigibbeting', 'Puttering',
  'Tomfoolering', 'Flummoxing', 'Befuddling', 'Discombobulating', 'Combobulating',
  'Recombobulating', 'Razzle-dazzling', 'Razzmatazzing', 'Topsy-turvying',
  'Boondoggling', 'Wibbling', 'Wirrling', 'Hullaballooing', 'Flowing', 'Evaporating',
  'Ebbing', 'Cascading', 'Vibrating', 'Swirling', 'Thundering', 'Warping',
  'Precipitating', 'Sublimating', 'Transmuting', 'Transfiguring', 'Unfurling',
  'Unraveling', 'Osmosing', 'Nucleating', 'Ionizing', 'Nebulizing',
  'Photosynthesizing', 'Pollinating', 'Propagating', 'Metamorphosing', 'Misting',
  'Gusting', 'Coalescing', 'Billowing', 'Beaming', 'Sprouting', 'Doing', 'Doodling',
  'Moonwalking', 'Boogieing', 'Jitterbugging', 'Beboppin', 'Grooving', 'Noodling',
  'Canoodling', 'Bloviating', 'Finagling', 'Churning', 'Clamping', 'Honking',
  'Wiggling', 'Clawing', 'Frolicking', 'Yawning', 'Yodeling', 'Yakking', 'Yumming',
  'Zapping', 'Zigzagging', 'Working',
] as const

/** Build the animated activity label with the requested three-dot suffix. */
export function workingActivityText(frame: string, word: string): string {
  return `${frame} ${word}...`
}

/** Format a running turn duration without noisy sub-second precision. */
export function formatWorkingElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor(totalSeconds % 3_600 / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** Keep one random label for five agent turns, then choose a different one. */
export class WorkingWordRotation {
  private turn = 0
  private current: string | undefined

  constructor(private readonly random: () => number = Math.random) {}

  next(): string {
    if (this.current === undefined || this.turn % 5 === 0) {
      const candidates = this.current === undefined
        ? WORKING_WORDS
        : WORKING_WORDS.filter(word => word !== this.current)
      const index = Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))
      this.current = candidates[Math.max(0, index)] ?? 'Working'
    }
    this.turn += 1
    return this.current
  }
}
