'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MARKER = 'toolbox: keep Bot chats off the classic transcript';
const MODE_BEFORE = `      writeMode(mode);
      surface.set((state) => ({ ...state, mode }));
      if (mode !== "bot") return;`;
const MODE_AFTER = `      writeMode(mode);
      surface.set((state) => ({ ...state, mode }));
      // ${MARKER}. Open an ordinary Session before showing the classic surface.
      if (mode === "agent") {
        const snapshot = roster.getSnapshot();
        if (snapshot.byId[mainView()] !== void 0) {
          const list = ctx.sessions.list.getSnapshot();
          const ordinary = Object.keys(list.byId ?? {}).find((id) => snapshot.byId[id] === void 0 && snapshot.roomsById[id] === void 0 && snapshot.agentOf[id] === void 0);
          if (ordinary !== void 0) show2(ordinary);
        }
        return;
      }`;
const SYNC_BEFORE = `      const main = Object.values(list.byId ?? {}).find((session) => (session?.retainedBy?.mainView ?? 0) > 0)?.id;
      const plain = isAgentSessionId(main);`;
const SYNC_AFTER = `      const main = Object.values(list.byId ?? {}).find((session) => (session?.retainedBy?.mainView ?? 0) > 0)?.id;
      // The classic list exposes Bot handoff acknowledgements as if they were replies.
      // A Bot part selected there belongs in the Bot conversation surface.
      const selectedBot = main === void 0 ? void 0 : roster.getSnapshot().byId[main];
      if (expected2 === null && selectedBot !== void 0 && surface.getSnapshot().mode === "agent") {
        actions.setSurface("bot");
        actions.openSession(selectedBot.id);
        return;
      }
      const plain = isAgentSessionId(main);`;

function patchBotClientSource(source) {
  if (source.includes(MARKER)) return { changed: false, source };
  if (source.split(MODE_BEFORE).length !== 2 || source.split(SYNC_BEFORE).length !== 2) {
    return { changed: false, source, reason: 'unsupported-client-layout' };
  }
  return { changed: true, source: source.replace(MODE_BEFORE, MODE_AFTER).replace(SYNC_BEFORE, SYNC_AFTER) };
}

function ensureBotClassicGuard(dshHome) {
  const root = path.join(dshHome, 'profiles', 'web', 'node_modules', 'ds-bot');
  const clientFile = path.join(root, 'client.js');
  try {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    if (version !== '0.2.1') return { changed: false, reason: `ds-bot-${version}` };
    const original = fs.readFileSync(clientFile, 'utf8');
    const result = patchBotClientSource(original);
    if (!result.changed) return { changed: false, reason: result.reason || 'already-patched' };
    const backup = path.join(dshHome, 'bot', 'toolbox-ds-bot-client-0.2.1.original.js');
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, original);
    const temp = `${clientFile}.tmp-${process.pid}`;
    fs.writeFileSync(temp, result.source);
    fs.renameSync(temp, clientFile);
    return { changed: true, backup };
  } catch (error) {
    return { changed: false, reason: error.message };
  }
}

module.exports = { MARKER, patchBotClientSource, ensureBotClassicGuard };
