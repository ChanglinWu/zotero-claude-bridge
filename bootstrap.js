/* global Zotero, Services */
var ClaudeBridge;

function log(msg) {
  Zotero.debug("[Claude Bridge] " + msg);
}

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  // ignoreCache: otherwise an upgraded plugin keeps running the previous version's cached script
  Services.scriptloader.loadSubScriptWithOptions(rootURI + "src/bridge.js", { ignoreCache: true });
  ClaudeBridge = Zotero.ClaudeBridge;
  ClaudeBridge.init({ id, version, rootURI });
  log("started " + version);
}

function shutdown() {
  if (ClaudeBridge) ClaudeBridge.shutdown();
  ClaudeBridge = undefined;
  delete Zotero.ClaudeBridge;
}

function install() {}
function uninstall() {}
function onMainWindowLoad() {}
function onMainWindowUnload() {}
