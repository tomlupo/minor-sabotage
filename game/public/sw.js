// Not the game's service worker: a handover. Until this site served the TypeScript game, its
// root was the C++ prototype, whose worker (at this same path, scope the whole site) keeps the
// prototype's page in a cache and answers from it first. Left alone it would go on showing the
// prototype on any phone that had played it, since a missing worker script does not remove
// the worker. So this file stands at the old path: the browser takes it as an update, and it
// unregisters itself and reloads the pages the old worker was serving, which then load the game
// from the network. It leaves the caches alone: the prototype, now at prototype/, registers its
// own worker there, uses the same cache names and cleans up after itself.
// tools/check-sw-handover.mjs plays this through in Chrome.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: "window" });
    for (const page of pages) page.navigate(page.url);
  })());
});
