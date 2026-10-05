/**
 * Whether a test judges wall-clock time here. The budgets are set on our own boxes; GitHub's shared
 * runners (where CI is set) are slower and vary, and there a 319 ms build of the prop art against
 * its 300 ms budget stopped the site's deploy (2026-10-05). So on CI the timed tests are skipped,
 * and reported so; on our boxes they are judged as before.
 */
export const judgesTime = !process.env.CI;
