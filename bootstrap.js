/* global Zotero, Services */
var ClaudeBridge;

function log(msg) {
  Zotero.debug("[Claude Bridge] " + msg);
}

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  Services.scriptloader.loadSubScript(rootURI + "src/bridge.js");
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
