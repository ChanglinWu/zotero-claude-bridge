// Alternative installer if drag-and-drop into Tools → Plugins does nothing.
// Zotero: Tools → Developer → Run JavaScript, tick "Run as async function", paste, set the path, click Run.
const XPI = "/path/to/zotero-claude-bridge-x.y.z.xpi";
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const install = await AddonManager.getInstallForFile(Zotero.File.pathToFile(XPI));
if (install.error) return "Install error code: " + install.error + " / state " + install.state;
try {
  const addon = await install.install();
  return `Installed ${addon.id} ${addon.version}, active=${addon.isActive}`;
} catch (e) {
  return "Install failed: " + e + " | error code " + install.error;
}
