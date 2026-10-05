/**
 * Whether the timed tests run here. Their budgets are set on our own boxes; GitHub's shared runners
 * (where CI is set) are slower and vary, and there a build over its budget stopped the site's deploy
 * (2026-10-05). So on CI they are skipped, and reported so, timings and all; off CI they run and are
 * judged as before.
 */
export const judgesTime = !process.env.CI;
