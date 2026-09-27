// Minor Sabotage web build: this runs inside the Emscripten runtime (--pre-js), where FS and IDBFS live.

// Saved games go to /Saves. Keep that folder in IndexedDB so saves survive reloads and relaunches
// from the Home Screen; autoPersist writes each change back as it happens.
// IDBFS names its database after the mount point, and the Open Fodder port on the same origin
// (tomlupo.github.io) mounts /Saves too, so the two games share one saves database. The engine
// reads saves from /Saves, so separating them needs a remap or an engine change. That is not done
// in this frozen C++ prototype (see docs/adr/0001-*): the demo campaigns keep saves off, and the
// TypeScript game uses its own database.
Module['preRun'] = [].concat(Module['preRun'] || []);
Module['preRun'].push(function () {
  try {
    FS.mkdir('/Saves');
  } catch (e) {
    // The data package already made it
  }
  try {
    FS.mount(IDBFS, { autoPersist: true }, '/Saves');
  } catch (e) {
    console.warn('Minor Sabotage: saves will not survive a reload (' + e + ')');
    return;
  }

  addRunDependency('of-saves');
  FS.syncfs(true, function (err) {
    if (err) console.warn('Minor Sabotage: could not read saved games (' + err + ')');
    removeRunDependency('of-saves');
  });
});
