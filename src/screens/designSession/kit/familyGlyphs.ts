/** The 7 x 7 pixel glyph of one representative kind per family (copied from public/engines/diagram.js GL, the glyphs the canvas draws), for the family buttons. */
export const FAMILY_GLYPH_KIND: Record<string, string> = {"client":"browser","edge":"cdn","compute":"service","data":"sql","messaging":"queue","cache":"cache","security":"auth","observe":"monitor","ai":"llm","external":"external","flow":"decision"}
export const FAMILY_GLYPHS: Record<string, readonly string[]> = {
  client: ['#######', '#.#.###', '#######', '#.....#', '#.....#', '#.....#', '#######'],
  edge: ['..###..', '.#...#.', '#..#..#', '#.###.#', '#..#..#', '.#...#.', '..###..'],
  compute: ['#######', '#.....#', '#.###.#', '#.#.#.#', '#.###.#', '#.....#', '#######'],
  data: ['.#####.', '#.....#', '.#####.', '#.....#', '.#####.', '#.....#', '.#####.'],
  messaging: ['##.##.#', '##.##.#', '##.##.#', '##.##.#', '##.##.#', '##.##.#', '##.##.#'],
  cache: ['...##..', '..##...', '.####..', '...##..', '..##...', '.##....', '.......'],
  security: ['..###..', '.#...#.', '.#...#.', '#######', '###.###', '###.###', '#######'],
  observe: ['.......', '......#', '....##.', '#..#...', '.##....', '#......', '#######'],
  ai: ['.#####.', '#.....#', '#.#.#.#', '#.....#', '#.###.#', '#.....#', '.#####.'],
  external: ['#.#.#.#', '.......', '#.....#', '.......', '#.....#', '.......', '#.#.#.#'],
  flow: ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'],
}
