/* global Zotero, Services */
/*
 * Claude Bridge for Zotero
 *
 * Registers an MCP (Model Context Protocol) endpoint on Zotero's built-in
 * local HTTP server: http://127.0.0.1:23119/claude-bridge/mcp
 *
 * Transport: MCP "Streamable HTTP" in stateless JSON mode (every POST gets a
 * single application/json response, no SSE). No API key is needed because the
 * server only listens on localhost and Zotero itself rejects requests with a
 * non-local Host header (DNS rebinding) and requests coming from web pages.
 */

Zotero.ClaudeBridge = new function () {
  const ENDPOINT = "/claude-bridge/mcp";
  const INFO_ENDPOINT = "/claude-bridge/info";
  const PREF_READONLY = "extensions.zotero-claude-bridge.readOnly";
  const SERVER_NAME = "zotero";
  const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
  const MAX_TEXT = 200000;

  let version = "0.0.0";

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  this.init = function ({ version: v }) {
    version = v;
    // Zotero's server lacks a few codes MCP uses
    Zotero.Server.responseCodes[202] = Zotero.Server.responseCodes[202] || "Accepted";
    Zotero.Server.responseCodes[405] = Zotero.Server.responseCodes[405] || "Method Not Allowed";

    const self = this;
    const McpEndpoint = function () {};
    McpEndpoint.prototype = {
      supportedMethods: ["GET", "POST", "DELETE"],
      supportedDataTypes: ["application/json"],
      permitBookmarklet: false,
      init: function (req) {
        return self.handleHttp(req);
      },
    };
    Zotero.Server.Endpoints[ENDPOINT] = McpEndpoint;

    const InfoEndpoint = function () {};
    InfoEndpoint.prototype = {
      supportedMethods: ["GET"],
      permitBookmarklet: false,
      init: function (req) {
        return [200, "application/json", JSON.stringify({
          name: "zotero-claude-bridge",
          version,
          zotero: Zotero.version,
          mcp: `http://127.0.0.1:${Zotero.Prefs.get("httpServer.port") || 23119}${ENDPOINT}`,
          readOnly: isReadOnly(),
          tools: TOOLS.map((t) => t.name),
        })];
      },
    };
    Zotero.Server.Endpoints[INFO_ENDPOINT] = InfoEndpoint;
  };

  this.shutdown = function () {
    delete Zotero.Server.Endpoints[ENDPOINT];
    delete Zotero.Server.Endpoints[INFO_ENDPOINT];
  };

  // ---------------------------------------------------------------------------
  // HTTP / JSON-RPC
  // ---------------------------------------------------------------------------

  this.handleHttp = async function (req) {
    // Defense in depth: refuse anything that looks like it came from a web page.
    if (req.headers && req.headers.origin) {
      return [403, "text/plain", "Browser requests are not allowed\n"];
    }
    if (req.method === "GET") {
      // No server-initiated SSE stream in stateless mode
      return [405, { "Content-Type": "text/plain", Allow: "POST" }, "Use POST\n"];
    }
    if (req.method === "DELETE") {
      return [200, "text/plain", "ok\n"];
    }
    const msg = req.data;
    if (!msg || typeof msg !== "object") {
      return jsonResponse(rpcError(null, -32700, "Parse error"));
    }
    if (Array.isArray(msg)) {
      const out = [];
      for (const m of msg) {
        const r = await this.handleMessage(m);
        if (r) out.push(r);
      }
      return out.length ? jsonResponse(out) : 202;
    }
    const r = await this.handleMessage(msg);
    return r ? jsonResponse(r) : 202;
  };

  function jsonResponse(obj) {
    return [200, "application/json; charset=utf-8", JSON.stringify(obj)];
  }

  function rpcError(id, code, message) {
    return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
  }

  function rpcResult(id, result) {
    return { jsonrpc: "2.0", id, result };
  }

  this.handleMessage = async function (msg) {
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;
    if (!method) {
      // A response from the client (we never send requests) - ignore
      return null;
    }
    try {
      switch (method) {
        case "initialize": {
          const asked = params && params.protocolVersion;
          return rpcResult(id, {
            protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, title: "Zotero (Claude Bridge)", version },
            instructions:
              "This server is the user's local Zotero library. Use search_items / get_item / " +
              "get_fulltext to read it. To save a paper, prefer add_by_identifier with a DOI, " +
              "arXiv ID, ISBN or PMID (Zotero fetches the full metadata and open-access PDF " +
              "itself); fall back to add_item only when no identifier exists. Pass a collection " +
              "name to file it. To work with many papers or long texts, export_markdown them to a local " +
              "folder and read the files instead of calling get_fulltext repeatedly. Nothing is ever deleted. " +
              "Item keys are 8-character IDs like 'ABCD2345'.",
          });
        }
        case "ping":
          return isNotification ? null : rpcResult(id, {});
        case "tools/list":
          return rpcResult(id, {
            tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
              name, title, description, inputSchema, annotations,
            })),
          });
        case "tools/call":
          return rpcResult(id, await callTool(params || {}));
        case "resources/list":
          return rpcResult(id, { resources: [] });
        case "prompts/list":
          return rpcResult(id, { prompts: [] });
        default:
          if (isNotification) return null; // notifications/initialized, cancelled, ...
          return rpcError(id, -32601, "Method not found: " + method);
      }
    } catch (e) {
      Zotero.logError(e);
      return isNotification ? null : rpcError(id, -32603, String(e && e.message || e));
    }
  };

  async function callTool({ name, arguments: args }) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      return toolError("Unknown tool: " + name);
    }
    if (tool.write && isReadOnly()) {
      return toolError(
        "Zotero Claude Bridge is in read-only mode (" + PREF_READONLY + " = true). " +
        "Ask the user to turn it off in Zotero's Config Editor to allow changes."
      );
    }
    try {
      const result = await tool.run(args || {});
      let text = typeof result === "string" ? result : JSON.stringify(result, null, 1);
      if (text.length > MAX_TEXT) {
        text = text.slice(0, MAX_TEXT) + "\n…[truncated]";
      }
      return { content: [{ type: "text", text }] };
    } catch (e) {
      Zotero.debug("[Claude Bridge] tool " + name + " failed: " + e);
      return toolError(String(e && e.message || e));
    }
  }

  function toolError(text) {
    return { content: [{ type: "text", text }], isError: true };
  }

  function isReadOnly() {
    return !!Zotero.Prefs.get(PREF_READONLY, true);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getLibraryID(args) {
    if (args.library_id === undefined || args.library_id === null || args.library_id === "") {
      return Zotero.Libraries.userLibraryID;
    }
    const id = parseInt(args.library_id);
    if (!Zotero.Libraries.exists(id)) throw new Error("No library with ID " + args.library_id);
    return id;
  }

  function assertEditable(libraryID) {
    if (!Zotero.Libraries.get(libraryID).editable) {
      throw new Error("Library " + libraryID + " is read-only");
    }
  }

  async function getItemByKey(libraryID, key) {
    if (!key) throw new Error("item key is required");
    key = String(key).trim();
    let item = Zotero.Items.getByLibraryAndKey(libraryID, key);
    if (!item) {
      // try every library
      for (const lib of Zotero.Libraries.getAll()) {
        item = Zotero.Items.getByLibraryAndKey(lib.libraryID, key);
        if (item) break;
      }
    }
    if (!item) throw new Error("No item with key " + key);
    await item.loadAllData();
    return item;
  }

  function field(item, name) {
    try {
      return item.getField(name) || "";
    } catch (e) {
      return "";
    }
  }

  function creatorNames(item, max = 6) {
    const names = item.getCreatorsJSON().map((c) =>
      c.name || [c.lastName, c.firstName].filter(Boolean).join(", ")
    );
    if (names.length > max) {
      return names.slice(0, max - 1).concat(`… +${names.length - max} more, ${names[names.length - 1]}`);
    }
    return names;
  }

  function year(item) {
    const d = field(item, "date");
    if (!d) return "";
    const parsed = Zotero.Date.strToDate(d);
    return parsed && parsed.year ? String(parsed.year) : d;
  }

  function selectURI(item) {
    const lib = Zotero.Libraries.get(item.libraryID);
    const prefix = lib.libraryType === "group" ? `groups/${lib.groupID}` : "library";
    return `zotero://select/${prefix}/items/${item.key}`;
  }

  function summarize(item) {
    const out = {
      key: item.key,
      itemType: item.itemType,
      title: field(item, "title"),
      creators: creatorNames(item),
      year: year(item),
    };
    const pub = field(item, "publicationTitle") || field(item, "proceedingsTitle") ||
      field(item, "bookTitle") || field(item, "repository") || field(item, "publisher");
    if (pub) out.publication = pub;
    const doi = field(item, "DOI");
    if (doi) out.DOI = doi;
    if (item.libraryID !== Zotero.Libraries.userLibraryID) out.libraryID = item.libraryID;
    out.dateAdded = item.dateAdded;
    return out;
  }

  function toTopLevel(items) {
    const seen = new Set();
    const out = [];
    for (let item of items) {
      if (!item) continue;
      if (!item.isTopLevelItem()) {
        item = Zotero.Items.get(item.parentItemID);
        if (!item) continue;
      }
      if (item.deleted || seen.has(item.id)) continue;
      if (item.isAnnotation && item.isAnnotation()) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  function htmlToText(html) {
    if (!html) return "";
    let s = String(html)
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "");
    s = Zotero.Utilities.unescapeHTML(s);
    return s.replace(/\n{3,}/g, "\n\n").trim();
  }

  function escapeHTML(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Very small Markdown -> HTML for notes (headings, lists, bold/italic, code, links, paragraphs)
  function markdownToHTML(md) {
    const inline = (t) => escapeHTML(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
    const lines = String(md).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let list = null;
    let para = [];
    const flushPara = () => {
      if (para.length) out.push("<p>" + para.map(inline).join("<br/>") + "</p>");
      para = [];
    };
    const closeList = () => {
      if (list) out.push(`</${list}>`);
      list = null;
    };
    for (const line of lines) {
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushPara(); closeList();
        out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara();
        const type = /^\s*\d/.test(line) ? "ol" : "ul";
        if (list !== type) { closeList(); out.push(`<${type}>`); list = type; }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if (!line.trim()) {
        flushPara(); closeList();
      } else {
        closeList();
        para.push(line);
      }
    }
    flushPara(); closeList();
    return out.join("\n");
  }

  function noteHTML(content, title) {
    const body = /^\s*</.test(content) ? content : markdownToHTML(content);
    const head = title ? `<h1>${escapeHTML(title)}</h1>\n` : "";
    return `<div data-schema-version="9">${head}${body}</div>`;
  }

  function collectionPath(col) {
    const parts = [col.name];
    let p = col.parentID ? Zotero.Collections.get(col.parentID) : null;
    while (p) {
      parts.unshift(p.name);
      p = p.parentID ? Zotero.Collections.get(p.parentID) : null;
    }
    return parts.join("/");
  }

  /**
   * Find a collection by key, exact path ("Parent/Child") or name (case-insensitive).
   * If create is true and nothing matches, the (path of) collection(s) is created.
   */
  async function resolveCollection(libraryID, ref, create) {
    if (ref === undefined || ref === null || ref === "") return null;
    ref = String(ref).trim();
    const byKey = Zotero.Collections.getByLibraryAndKey(libraryID, ref);
    if (byKey && !byKey.deleted) return byKey;
    const all = Zotero.Collections.getByLibrary(libraryID, true).filter((c) => !c.deleted);
    const lower = ref.toLowerCase().replace(/^\/+|\/+$/g, "");
    let hit = all.find((c) => collectionPath(c).toLowerCase() === lower);
    if (!hit) {
      const byName = all.filter((c) => c.name.toLowerCase() === lower);
      if (byName.length === 1) hit = byName[0];
      else if (byName.length > 1) {
        throw new Error(`Collection name "${ref}" is ambiguous: ` +
          byName.map((c) => `${collectionPath(c)} (${c.key})`).join(", "));
      }
    }
    if (hit) return hit;
    if (!create) throw new Error(`No collection "${ref}". Use list_collections to see them.`);
    // create path segments as needed
    let parent = null;
    for (const name of ref.replace(/^\/+|\/+$/g, "").split("/").filter((s) => s.trim())) {
      const children = parent
        ? Zotero.Collections.getByParent(parent.id).filter((c) => !c.deleted)
        : Zotero.Collections.getByLibrary(libraryID, false).filter((c) => !c.deleted);
      let next = children.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
      if (!next) {
        next = new Zotero.Collection();
        next.libraryID = libraryID;
        next.name = name.trim();
        if (parent) next.parentID = parent.id;
        await next.saveTx();
      }
      parent = next;
    }
    return parent;
  }

  async function addTags(item, tags) {
    if (!tags) return;
    for (const t of [].concat(tags)) {
      if (t && String(t).trim()) item.addTag(String(t).trim());
    }
  }

  async function findExisting(libraryID, ident) {
    // DOIs are case-insensitive, but the search's "is" operator is not: search with
    // "contains" (case-insensitive) and then require an exact case-insensitive match.
    const sameDOI = (want) => (i) => field(i, "DOI").trim().toLowerCase() === want.toLowerCase();
    const tries = [];
    if (ident.DOI) tries.push(["DOI", "contains", ident.DOI, sameDOI(ident.DOI)]);
    if (ident.arXiv) {
      const arxivDOI = "10.48550/arXiv." + ident.arXiv;
      tries.push(["DOI", "contains", arxivDOI, sameDOI(arxivDOI)]);
      tries.push(["url", "contains", "arxiv.org/abs/" + ident.arXiv]);
      tries.push(["extra", "contains", "arXiv:" + ident.arXiv]);
    }
    if (ident.ISBN) tries.push(["ISBN", "contains", ident.ISBN]);
    if (ident.PMID) tries.push(["extra", "contains", "PMID: " + ident.PMID]);
    for (const [f, op, v, check] of tries) {
      const s = new Zotero.Search();
      s.libraryID = libraryID;
      s.addCondition(f, op, v);
      s.addCondition("deleted", "false");
      try {
        const ids = await s.search();
        let items = toTopLevel(await Zotero.Items.getAsync(ids)).filter((i) => i.isRegularItem());
        if (check) items = items.filter(check);
        if (items.length) return items[0];
      } catch (e) {
        // unsupported field condition on this Zotero version - skip
      }
    }
    return null;
  }

  // Other items with the same title (and year, if both have one): likely duplicates that
  // the identifier check could not catch, e.g. an older copy saved without a DOI.
  async function sameTitleItems(item) {
    const norm = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const title = norm(field(item, "title"));
    if (title.length < 12) return [];
    const s = new Zotero.Search();
    s.libraryID = item.libraryID;
    s.addCondition("title", "contains", field(item, "title").slice(0, 60));
    s.addCondition("deleted", "false");
    const y = year(item);
    return toTopLevel(await Zotero.Items.getAsync(await s.search()))
      .filter((i) => i.id !== item.id && i.isRegularItem() && norm(field(i, "title")) === title &&
        (!y || !year(i) || year(i) === y))
      .map((i) => i.key);
  }

  function hasFileAttachment(item) {
    return item.getAttachments().some((id) => {
      const a = Zotero.Items.get(id);
      return a && !a.deleted && a.isFileAttachment() &&
        ["application/pdf", "application/epub+zip"].includes(a.attachmentContentType);
    });
  }

  async function tryAttachPDF(item) {
    if (hasFileAttachment(item)) return "already has a file";
    try {
      const att = await Zotero.Attachments.addAvailableFile(item);
      return att ? "attached open-access file" : "no open-access file found";
    } catch (e) {
      return "file lookup failed: " + e.message;
    }
  }

  function setFields(item, fields) {
    const skipped = [];
    for (const [name, value] of Object.entries(fields || {})) {
      if (value === undefined || value === null || name === "itemType") continue;
      let fieldID = Zotero.ItemFields.getID(name);
      if (fieldID && !Zotero.ItemFields.isValidForType(fieldID, item.itemTypeID)) {
        // e.g. publicationTitle -> bookTitle / proceedingsTitle mapping via base field
        fieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase(item.itemTypeID, fieldID) || null;
      }
      if (!fieldID) {
        skipped.push(name);
        continue;
      }
      item.setField(fieldID, String(value));
    }
    return skipped;
  }

  function parseCreators(item, creators) {
    if (!creators) return;
    const primary = Zotero.CreatorTypes.getPrimaryIDForType(item.itemTypeID);
    const list = [].concat(creators).map((c) => {
      let data;
      if (typeof c === "string") {
        const s = c.trim();
        if (s.includes(",")) {
          const [last, ...rest] = s.split(",");
          data = { lastName: last.trim(), firstName: rest.join(",").trim() };
        } else {
          const parts = s.split(/\s+/);
          data = parts.length > 1
            ? { lastName: parts.pop(), firstName: parts.join(" ") }
            : { lastName: s, firstName: "", fieldMode: 1 };
        }
      } else if (c.name) {
        data = { lastName: c.name, firstName: "", fieldMode: 1 };
      } else {
        data = { lastName: c.lastName || "", firstName: c.firstName || "" };
      }
      let typeID = c && c.creatorType ? Zotero.CreatorTypes.getID(c.creatorType) : null;
      if (!typeID || !Zotero.CreatorTypes.isValidForItemType(typeID, item.itemTypeID)) typeID = primary;
      data.creatorTypeID = typeID;
      return data;
    });
    item.setCreators(list);
  }

  function exportWithTranslator(items, translatorID) {
    return new Promise((resolve, reject) => {
      const tr = new Zotero.Translate.Export();
      tr.setItems(items);
      tr.setTranslator(translatorID);
      tr.setHandler("done", (obj, worked) => {
        if (worked) resolve(obj.string);
        else reject(new Error("Export failed"));
      });
      tr.translate();
    });
  }

  function getStyle(styleRef) {
    let id = styleRef || "apa";
    if (!/^https?:/.test(id)) id = "http://www.zotero.org/styles/" + id;
    const style = Zotero.Styles.get(id);
    if (!style) {
      const available = Object.values(Zotero.Styles.getVisible ? Zotero.Styles.getVisible() : [])
        .map((s) => s.styleID.replace("http://www.zotero.org/styles/", ""));
      throw new Error(`Citation style "${styleRef}" is not installed. Installed: ${available.join(", ")}`);
    }
    return style;
  }

  function getPane() {
    const win = Zotero.getMainWindow && Zotero.getMainWindow();
    return win && win.ZoteroPane ? win.ZoteroPane : null;
  }

  async function attachmentText(att, ensureIndexed) {
    if (!att.isFileAttachment()) return "";
    if (att.attachmentContentType === "text/plain") {
      const path = await att.getFilePathAsync();
      return path ? Zotero.File.getContentsAsync(path) : "";
    }
    const cacheFile = Zotero.FullText.getItemCacheFile(att);
    if (!cacheFile.exists() && ensureIndexed && (await att.fileExists())) {
      try {
        await Zotero.FullText.indexItems([att.id], { complete: true });
      } catch (e) {
        Zotero.debug("[Claude Bridge] indexing failed: " + e);
      }
    }
    if (cacheFile.exists()) {
      return Zotero.File.getContentsAsync(cacheFile.path);
    }
    return "";
  }

  // IOUtils/PathUtils are globals in chrome windows; fall back to the main window's copies
  function io() {
    return typeof IOUtils !== "undefined" ? IOUtils : Zotero.getMainWindow().IOUtils;
  }
  function pu() {
    return typeof PathUtils !== "undefined" ? PathUtils : Zotero.getMainWindow().PathUtils;
  }

  function markdownFileName(item) {
    const first = item.getCreatorsJSON()[0];
    const author = first ? (first.lastName || first.name || "") : "";
    const title = (field(item, "shortTitle") || field(item, "title") || (item.isNote() ? item.getNoteTitle() : "") || "untitled")
      .split(/\s+/).slice(0, 6).join(" ");
    const slug = `${author}${year(item)} ${title}`
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 80);
    return `${slug || "item"}_${item.key}.md`;
  }

  const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

  async function itemToMarkdown(item, { fulltext, maxChars, assetsDir }) {
    const y = (v) => JSON.stringify(v == null ? "" : String(v));
    const title = item.isNote() ? item.getNoteTitle() : field(item, "title");
    const collections = item.getCollections().map((id) => collectionPath(Zotero.Collections.get(id)));
    const tags = item.getTags().map((t) => t.tag);
    const fm = [
      "---",
      `zotero_key: ${y(item.key)}`,
      `title: ${y(title)}`,
      `item_type: ${y(item.itemType)}`,
      `authors: [${creatorNames(item, 1000).map(y).join(", ")}]`,
      `year: ${y(year(item))}`,
    ];
    for (const f of ["publicationTitle", "proceedingsTitle", "bookTitle", "publisher", "DOI", "ISBN", "url"]) {
      const v = field(item, f);
      if (v) fm.push(`${f}: ${y(v)}`);
    }
    fm.push(`collections: [${collections.map(y).join(", ")}]`);
    fm.push(`tags: [${tags.map(y).join(", ")}]`);
    fm.push(`zotero_link: ${y(selectURI(item))}`);
    fm.push("---", "");
    const out = [fm.join("\n"), `# ${title || item.key}`, ""];
    out.push(`**Authors:** ${creatorNames(item, 1000).join("; ") || "—"}  `);
    const pub = field(item, "publicationTitle") || field(item, "proceedingsTitle") || field(item, "bookTitle");
    out.push(`**Published:** ${[pub, year(item)].filter(Boolean).join(", ") || "—"}  `);
    if (field(item, "DOI")) out.push(`**DOI:** https://doi.org/${field(item, "DOI")}  `);
    out.push(`**Zotero:** ${selectURI(item)}`, "");

    if (item.isNote()) {
      out.push(htmlToText(item.getNote()));
      return { text: out.join("\n") + "\n", hasFullText: false, images: 0 };
    }
    const abs = field(item, "abstractNote");
    if (abs) out.push("## Abstract", "", abs, "");

    const notes = item.isRegularItem() ? item.getNotes().map((id) => Zotero.Items.get(id)) : [];
    if (notes.length) {
      out.push("## Notes", "");
      for (const n of notes) out.push(htmlToText(n.getNote()), "", "---", "");
    }

    const atts = item.isAttachment() ? [item]
      : item.getAttachments().map((id) => Zotero.Items.get(id)).filter((x) => x && !x.deleted);
    const ann = [];
    for (const att of atts) {
      if (!att.isFileAttachment() || !att.getAnnotations) continue;
      for (const an of att.getAnnotations()) {
        const line = [
          `- p.${an.annotationPageLabel || "?"} (${an.annotationType})`,
          an.annotationText ? ` “${an.annotationText.replace(/\s+/g, " ")}”` : "",
          an.annotationComment ? ` — ${an.annotationComment.replace(/\s+/g, " ")}` : "",
        ].join("");
        ann.push(line);
      }
    }
    if (ann.length) out.push("## Annotations", "", ...ann, "");

    let images = 0;
    const imgLines = [];
    for (const att of atts) {
      if (!att.isFileAttachment() || !IMAGE_TYPES.includes(att.attachmentContentType)) continue;
      const src = await att.getFilePathAsync();
      if (!src) continue;
      await io().makeDirectory(assetsDir, { createAncestors: true, ignoreExisting: true });
      const name = `${att.key}_${pu().filename(src)}`;
      const dest = pu().join(assetsDir, name);
      await io().copy(src, dest);
      imgLines.push(`![${att.getField("title") || name}](assets/${encodeURI(name)})`, `Local file: ${dest}`, "");
      images++;
    }
    if (imgLines.length) out.push("## Images", "", ...imgLines);

    const links = atts.filter((att) => !att.isFileAttachment() && att.getField("url"));
    if (links.length) {
      out.push("## Links", "", ...links.map((l) => `- [${l.getField("title") || "link"}](${l.getField("url")})`), "");
    }

    let hasFullText = false;
    if (fulltext) {
      let budget = maxChars;
      for (const att of atts) {
        if (budget <= 0) break;
        const t = await attachmentText(att, true);
        if (!t || !t.trim()) continue;
        hasFullText = true;
        const chunk = t.length > budget ? t.slice(0, budget) + "\n…[truncated]" : t;
        budget -= chunk.length;
        const path = await att.getFilePathAsync();
        out.push(`## Full text: ${att.getField("title")} (${att.attachmentContentType})`, "");
        if (path) out.push(`Source file: ${path}`, "");
        out.push(chunk, "");
      }
    }
    return { text: out.join("\n") + "\n", hasFullText, images };
  }

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  const LIB = {
    library_id: {
      type: "integer",
      description: "Library ID (from list_libraries). Omit for My Library.",
    },
  };

  const READ = { readOnlyHint: true, openWorldHint: false };
  const ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  const TOOLS = [
    // ---------------- read ----------------
    {
      name: "search_items",
      title: "Search Zotero",
      description:
        "Search the Zotero library. mode 'titleCreatorYear' (default) matches title/author/year; " +
        "'fields' matches all fields and tags; 'everything' also searches notes and the full text of PDFs. " +
        "Can be filtered by collection, tag and item type. Returns top-level items with their keys.",
      annotations: READ,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search words. May be empty if a filter is given." },
          mode: { type: "string", enum: ["titleCreatorYear", "fields", "everything"] },
          collection: { type: "string", description: "Collection key, name or path to search within" },
          tag: { type: "string" },
          item_type: { type: "string", description: "e.g. journalArticle, book, preprint, conferencePaper, thesis" },
          unfiled: { type: "boolean", description: "Only items that are in no collection" },
          limit: { type: "integer", default: 25 },
          offset: { type: "integer", default: 0 },
          ...LIB,
        },
      },
      async run(a) {
        const libraryID = getLibraryID(a);
        const s = new Zotero.Search();
        s.libraryID = libraryID;
        if (a.query && a.query.trim()) {
          s.addCondition("quicksearch-" + (a.mode || "titleCreatorYear"), "contains", a.query.trim());
        }
        if (a.collection) {
          const col = await resolveCollection(libraryID, a.collection, false);
          s.addCondition("collection", "is", col.key);
          s.addCondition("recursive", "true");
        }
        if (a.tag) s.addCondition("tag", "is", a.tag);
        if (a.item_type) s.addCondition("itemType", "is", a.item_type);
        if (a.unfiled) s.addCondition("unfiled", "true");
        if (!a.query && !a.collection && !a.tag && !a.item_type && !a.unfiled) {
          throw new Error("Give a query or at least one filter");
        }
        s.addCondition("deleted", "false");
        const ids = await s.search();
        let items = toTopLevel(await Zotero.Items.getAsync(ids))
          .filter((i) => i.isRegularItem() || i.isNote() || i.isAttachment());
        items.sort((x, y) => (y.dateModified > x.dateModified ? 1 : -1));
        const limit = a.limit || 25;
        const offset = Math.max(0, a.offset || 0);
        return { total: items.length, offset, items: items.slice(offset, offset + limit).map(summarize) };
      },
    },
    {
      name: "get_item",
      title: "Get item details",
      description:
        "Full metadata of one item by key: all fields, abstract, creators, tags, collections, " +
        "child notes (as text) and attachments (with local file paths).",
      annotations: READ,
      inputSchema: {
        type: "object",
        required: ["key"],
        properties: { key: { type: "string" }, ...LIB },
      },
      async run(a) {
        const item = await getItemByKey(getLibraryID(a), a.key);
        const json = item.toJSON();
        delete json.relations;
        json.key = item.key;
        json.libraryID = item.libraryID;
        json.zoteroLink = selectURI(item);
        json.collections = item.getCollections().map((id) => {
          const c = Zotero.Collections.get(id);
          return { key: c.key, path: collectionPath(c) };
        });
        if (item.isNote()) json.note = htmlToText(item.getNote());
        if (item.isRegularItem()) {
          json.notes = item.getNotes().map((id) => {
            const n = Zotero.Items.get(id);
            return { key: n.key, text: htmlToText(n.getNote()) };
          });
          json.attachments = [];
          for (const id of item.getAttachments()) {
            const att = Zotero.Items.get(id);
            if (!att || att.deleted) continue;
            json.attachments.push({
              key: att.key,
              title: att.getField("title"),
              contentType: att.attachmentContentType,
              path: att.isFileAttachment() ? await att.getFilePathAsync() : undefined,
              url: att.getField("url") || undefined,
              hasFullText: att.isFileAttachment() && Zotero.FullText.getItemCacheFile(att).exists(),
            });
          }
        }
        return json;
      },
    },
    {
      name: "get_fulltext",
      title: "Read full text",
      description:
        "Read the extracted text of an item's PDF/EPUB/HTML attachment(s) (or of an attachment key). " +
        "Indexes the file first if needed. Use offset/max_chars to page through long papers.",
      annotations: READ,
      inputSchema: {
        type: "object",
        required: ["key"],
        properties: {
          key: { type: "string", description: "Parent item key or attachment key" },
          offset: { type: "integer", default: 0 },
          max_chars: { type: "integer", default: 60000 },
          ...LIB,
        },
      },
      async run(a) {
        const item = await getItemByKey(getLibraryID(a), a.key);
        const atts = item.isAttachment()
          ? [item]
          : item.getAttachments().map((id) => Zotero.Items.get(id)).filter((x) => x && !x.deleted);
        let text = "";
        const used = [];
        for (const att of atts) {
          const t = await attachmentText(att, true);
          if (t && t.trim()) {
            text += (text ? "\n\n" : "") + `===== ${att.getField("title")} (${att.key}) =====\n` + t;
            used.push(att.key);
          }
        }
        if (!text) {
          return "No full text available. The item has no indexed PDF/EPUB attachment. " +
            "Try find_pdf to fetch an open-access copy, or read the abstract via get_item.";
        }
        const offset = Math.max(0, a.offset || 0);
        const max = Math.min(a.max_chars || 60000, 180000);
        const chunk = text.slice(offset, offset + max);
        const header = `[chars ${offset}-${offset + chunk.length} of ${text.length}` +
          (offset + chunk.length < text.length ? `; continue with offset=${offset + chunk.length}` : "") + "]\n";
        return header + chunk;
      },
    },
    {
      name: "get_annotations",
      title: "Get PDF annotations",
      description: "Highlights, underlines and comments made in Zotero's PDF reader for an item.",
      annotations: READ,
      inputSchema: {
        type: "object",
        required: ["key"],
        properties: { key: { type: "string" }, ...LIB },
      },
      async run(a) {
        const item = await getItemByKey(getLibraryID(a), a.key);
        const atts = item.isAttachment()
          ? [item]
          : item.getAttachments().map((id) => Zotero.Items.get(id)).filter(Boolean);
        const out = [];
        for (const att of atts) {
          if (!att.isFileAttachment() || !att.getAnnotations) continue;
          for (const an of att.getAnnotations()) {
            out.push({
              attachment: att.key,
              type: an.annotationType,
              page: an.annotationPageLabel,
              text: an.annotationText || undefined,
              comment: an.annotationComment || undefined,
              color: an.annotationColor,
              tags: an.getTags().map((t) => t.tag),
            });
          }
        }
        return out.length ? out : "No annotations.";
      },
    },
    {
      name: "list_collections",
      title: "List collections",
      description: "All collections (folders) in a library with key, full path and item count.",
      annotations: READ,
      inputSchema: { type: "object", properties: { ...LIB } },
      async run(a) {
        const libraryID = getLibraryID(a);
        return Zotero.Collections.getByLibrary(libraryID, true)
          .filter((c) => !c.deleted)
          .map((c) => ({
            key: c.key,
            path: collectionPath(c),
            items: c.getChildItems(true, false).length,
          }))
          .sort((x, y) => x.path.localeCompare(y.path));
      },
    },
    {
      name: "get_collection_items",
      title: "Items in collection",
      description: "List items in a collection (by key, name or path).",
      annotations: READ,
      inputSchema: {
        type: "object",
        required: ["collection"],
        properties: {
          collection: { type: "string" },
          include_subcollections: { type: "boolean", default: false },
          limit: { type: "integer", default: 100 },
          ...LIB,
        },
      },
      async run(a) {
        const libraryID = getLibraryID(a);
        const col = await resolveCollection(libraryID, a.collection, false);
        let ids = col.getChildItems(true, false);
        if (a.include_subcollections) {
          for (const sub of col.getDescendents(false, "collection")) {
            ids = ids.concat(Zotero.Collections.get(sub.id).getChildItems(true, false));
          }
        }
        const items = toTopLevel(await Zotero.Items.getAsync([...new Set(ids)]));
        return {
          collection: collectionPath(col),
          total: items.length,
          items: items.slice(0, a.limit || 100).map(summarize),
        };
      },
    },
    {
      name: "recent_items",
      title: "Recently added",
      description: "Most recently added items in a library.",
      annotations: READ,
      inputSchema: {
        type: "object",
        properties: { limit: { type: "integer", default: 20 }, ...LIB },
      },
      async run(a) {
        const libraryID = getLibraryID(a);
        const ids = await Zotero.DB.columnQueryAsync(
          "SELECT itemID FROM items WHERE libraryID=? " +
          "AND itemID NOT IN (SELECT itemID FROM deletedItems) " +
          "AND itemID NOT IN (SELECT itemID FROM itemAttachments WHERE parentItemID IS NOT NULL) " +
          "AND itemID NOT IN (SELECT itemID FROM itemNotes WHERE parentItemID IS NOT NULL) " +
          "AND itemID NOT IN (SELECT itemID FROM itemAnnotations) " +
          "ORDER BY dateAdded DESC LIMIT ?",
          [libraryID, a.limit || 20]
        );
        return (await Zotero.Items.getAsync(ids)).map(summarize);
      },
    },
    {
      name: "get_selected_items",
      title: "Items selected in Zotero",
      description:
        "The items the user currently has selected in the Zotero window, plus the open collection. " +
        "Use when the user says 'this paper' / 'the ones I selected'.",
      annotations: READ,
      inputSchema: { type: "object", properties: {} },
      async run() {
        const pane = getPane();
        if (!pane) throw new Error("Zotero main window is not open");
        const col = pane.getSelectedCollection && pane.getSelectedCollection();
        return {
          collection: col ? { key: col.key, path: collectionPath(col) } : null,
          items: pane.getSelectedItems().map(summarize),
        };
      },
    },
    {
      name: "list_libraries",
      title: "List libraries",
      description: "My Library and group libraries, with IDs and whether they are editable.",
      annotations: READ,
      inputSchema: { type: "object", properties: {} },
      async run() {
        return Zotero.Libraries.getAll().filter((l) => l.libraryType !== "feed").map((l) => ({
          library_id: l.libraryID,
          name: l.name,
          type: l.libraryType,
          editable: l.editable,
        }));
      },
    },
    {
      name: "export_citations",
      title: "Export citations",
      description:
        "Format items as a bibliography or in-text citations with a CSL style (default 'apa'; e.g. " +
        "'ieee', 'nature', 'chicago-author-date' if installed), or export as bibtex, biblatex, ris or csljson.",
      annotations: READ,
      inputSchema: {
        type: "object",
        required: ["keys"],
        properties: {
          keys: { type: "array", items: { type: "string" } },
          format: {
            type: "string",
            enum: ["bibliography", "citation", "bibtex", "biblatex", "ris", "csljson"],
            default: "bibliography",
          },
          style: { type: "string", description: "CSL style ID for bibliography/citation" },
          ...LIB,
        },
      },
      async run(a) {
        const libraryID = getLibraryID(a);
        const items = [];
        for (const k of a.keys || []) items.push(await getItemByKey(libraryID, k));
        if (!items.length) throw new Error("No keys given");
        const fmt = a.format || "bibliography";
        const translators = {
          bibtex: "9cb70025-a888-4a29-a210-93ec52da40d4",
          biblatex: "b6e39b57-8942-4d11-8259-342c46ce395f",
          ris: "32d59d2d-b65a-4da4-b0a3-bdd3cfb979e7",
        };
        if (translators[fmt]) return exportWithTranslator(items, translators[fmt]);
        if (fmt === "csljson") {
          return items.map((i) => Zotero.Utilities.Item.itemToCSLJSON(i));
        }
        const style = getStyle(a.style);
        const locale = Zotero.Prefs.get("export.quickCopy.locale") || "en-US";
        const engine = style.getCiteProc(locale, "text");
        return Zotero.Cite.makeFormattedBibliographyOrCitationList(
          engine, items.filter((i) => i.isRegularItem()), "text", fmt === "citation"
        );
      },
    },

    // ---------------- write (additive only, never deletes) ----------------
    {
      name: "add_by_identifier",
      title: "Add paper by DOI/arXiv/ISBN/PMID",
      description:
        "Add one or more papers to Zotero from identifiers (DOI, arXiv ID, ISBN, PMID; may be mixed in " +
        "free text or as DOI/arXiv URLs). Zotero fetches complete metadata itself and, by default, tries " +
        "to attach an open-access PDF. Existing items with the same identifier are reused, not duplicated. " +
        "Optionally file into a collection (created if missing) and add tags.",
      annotations: ADD,
      write: true,
      inputSchema: {
        type: "object",
        required: ["identifiers"],
        properties: {
          identifiers: {
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
            description: "e.g. '10.1038/s41586-021-03819-2' or ['arXiv:2401.01234', '978-0262035613']",
          },
          collection: { type: "string", description: "Collection key, name or path like 'Reading/2026'" },
          tags: { type: "array", items: { type: "string" } },
          attach_pdf: { type: "boolean", default: true },
          ...LIB,
        },
      },
      async run(a) {
        const libraryID = getLibraryID(a);
        assertEditable(libraryID);
        // Zotero's extractIdentifiers() returns only one identifier *type* per call
        // (DOIs win over arXiv etc.), so parse each entry/line on its own.
        const pieces = [].concat(a.identifiers).join("\n").split(/[\n,;]+|\s{2,}/)
          .map((s) => s.trim()
            .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
            .replace(/^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf)\/([^\s?#]+?)(v\d+)?(\.pdf)?$/i, "arXiv:$3"))
          .filter(Boolean);
        const idents = [];
        const unrecognised = [];
        for (const p of pieces) {
          const found = Zotero.Utilities.extractIdentifiers(p);
          if (found.length) idents.push(...found);
          else unrecognised.push(p);
        }
        if (!idents.length) throw new Error("No DOI, arXiv ID, ISBN or PMID recognised in: " + pieces.join(" | "));
        const col = await resolveCollection(libraryID, a.collection, true);
        const results = [];
        for (const ident of idents) {
          const label = Object.entries(ident).map(([k, v]) => `${k}:${v}`).join(" ");
          try {
            let item = await findExisting(libraryID, ident);
            let status = "existing";
            if (!item) {
              const tr = new Zotero.Translate.Search();
              tr.setIdentifier(ident);
              const translators = await tr.getTranslators();
              if (!translators.length) throw new Error("no translator can resolve this identifier");
              tr.setTranslator(translators);
              const newItems = await tr.translate({
                libraryID,
                collections: col ? [col.id] : false,
                saveAttachments: !!(a.attach_pdf !== false),
              });
              if (!newItems || !newItems.length) throw new Error("lookup returned nothing");
              item = newItems[0];
              status = "added";
            }
            if (col && !item.inCollection(col.id)) item.addToCollection(col.id);
            await addTags(item, a.tags);
            await item.saveTx();
            const r = { identifier: label, status, ...summarize(item) };
            if (status === "added") {
              const dups = await sameTitleItems(item);
              if (dups.length) {
                r.possibleDuplicates = dups;
                r.note = "Items with the same title were already in the library; the user can merge them in Zotero's Duplicate Items view.";
              }
            }
            if (col) r.collection = collectionPath(col);
            if (a.attach_pdf !== false) r.pdf = await tryAttachPDF(item);
            results.push(r);
          } catch (e) {
            results.push({ identifier: label, status: "failed", error: String(e.message || e) });
          }
        }
        for (const p of unrecognised) {
          results.push({ identifier: p, status: "failed", error: "not a recognised DOI/arXiv/ISBN/PMID" });
        }
        return results;
      },
    },
    {
      name: "add_item",
      title: "Add item from metadata",
      description:
        "Create an item from metadata when there is no DOI/arXiv/ISBN/PMID (otherwise use add_by_identifier). " +
        "fields uses Zotero field names: title, date, publicationTitle, volume, issue, pages, DOI, url, " +
        "abstractNote, publisher, place, conferenceName, institution, language, extra… " +
        "creators: ['First Last', 'Last, First'] or [{firstName,lastName,creatorType}].",
      annotations: ADD,
      write: true,
      inputSchema: {
        type: "object",
        required: ["fields"],
        properties: {
          item_type: {
            type: "string", default: "journalArticle",
            description: "journalArticle, preprint, conferencePaper, book, bookSection, thesis, report, webpage, patent, dataset, …",
          },
          fields: { type: "object", additionalProperties: { type: "string" } },
          creators: { type: "array", items: {} },
          collection: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          url_attachment: { type: "boolean", default: false, description: "Also save fields.url as a link attachment" },
          ...LIB,
        },
      },
      async run(a) {
        const libraryID = getLibraryID(a);
        assertEditable(libraryID);
        const typeName = a.item_type || "journalArticle";
        const typeID = Zotero.ItemTypes.getID(typeName);
        if (!typeID) throw new Error("Unknown item type: " + typeName);
        const fields = a.fields || {};
        if (fields.DOI) {
          const existing = await findExisting(libraryID, { DOI: Zotero.Utilities.cleanDOI(fields.DOI) || fields.DOI });
          if (existing) {
            return { status: "existing", note: "An item with this DOI already exists", ...summarize(existing) };
          }
        }
        const item = new Zotero.Item(typeName);
        item.libraryID = libraryID;
        const skipped = setFields(item, fields);
        parseCreators(item, a.creators);
        await addTags(item, a.tags);
        const col = await resolveCollection(libraryID, a.collection, true);
        if (col) item.addToCollection(col.id);
        await item.saveTx();
        if (a.url_attachment && fields.url) {
          await Zotero.Attachments.linkFromURL({ url: fields.url, parentItemID: item.id, title: "Link" });
        }
        const r = { status: "added", ...summarize(item) };
        if (col) r.collection = collectionPath(col);
        if (skipped.length) r.skippedFields = skipped;
        const dups = await sameTitleItems(item);
        if (dups.length) r.possibleDuplicates = dups;
        return r;
      },
    },
    {
      name: "update_item",
      title: "Update item",
      description:
        "Change fields of an existing item and/or add or remove tags. Only the fields given are changed.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      write: true,
      inputSchema: {
        type: "object",
        required: ["key"],
        properties: {
          key: { type: "string" },
          fields: { type: "object", additionalProperties: { type: "string" } },
          add_tags: { type: "array", items: { type: "string" } },
          remove_tags: { type: "array", items: { type: "string" } },
          ...LIB,
        },
      },
      async run(a) {
        const item = await getItemByKey(getLibraryID(a), a.key);
        assertEditable(item.libraryID);
        const skipped = setFields(item, a.fields);
        await addTags(item, a.add_tags);
        for (const t of a.remove_tags || []) item.removeTag(t);
        await item.saveTx();
        return { status: "updated", ...summarize(item), tags: item.getTags().map((t) => t.tag), skippedFields: skipped.length ? skipped : undefined };
      },
    },
    {
      name: "add_note",
      title: "Add note",
      description:
        "Add a note (Markdown or HTML) to an item, or a standalone note in a collection. " +
        "Good for saving summaries, reading notes or literature-review drafts.",
      annotations: ADD,
      write: true,
      inputSchema: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string", description: "Markdown (or HTML starting with '<')" },
          title: { type: "string", description: "Optional heading for the note" },
          parent_key: { type: "string", description: "Item to attach the note to; omit for standalone" },
          collection: { type: "string", description: "For standalone notes" },
          tags: { type: "array", items: { type: "string" } },
          ...LIB,
        },
      },
      async run(a) {
        let libraryID = getLibraryID(a);
        const note = new Zotero.Item("note");
        if (a.parent_key) {
          const parent = await getItemByKey(libraryID, a.parent_key);
          if (!parent.isRegularItem()) throw new Error("Notes can only be attached to regular items");
          libraryID = parent.libraryID;
          note.parentID = parent.id;
        }
        assertEditable(libraryID);
        note.libraryID = libraryID;
        note.setNote(noteHTML(a.content, a.title));
        await addTags(note, a.tags);
        if (!a.parent_key && a.collection) {
          const col = await resolveCollection(libraryID, a.collection, true);
          note.addToCollection(col.id);
        }
        await note.saveTx();
        return { status: "added", key: note.key, parent: a.parent_key || null, zoteroLink: selectURI(note) };
      },
    },
    {
      name: "create_collection",
      title: "Create collection",
      description: "Create a collection. Use a path like 'Projects/Thesis/Ch2' to create nested ones.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      write: true,
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" }, ...LIB },
      },
      async run(a) {
        const libraryID = getLibraryID(a);
        assertEditable(libraryID);
        const col = await resolveCollection(libraryID, a.name, true);
        return { key: col.key, path: collectionPath(col) };
      },
    },
    {
      name: "add_to_collection",
      title: "File items into collection",
      description: "Add existing items to a collection (created if missing). Items stay in their other collections.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      write: true,
      inputSchema: {
        type: "object",
        required: ["keys", "collection"],
        properties: {
          keys: { type: "array", items: { type: "string" } },
          collection: { type: "string" },
          ...LIB,
        },
      },
      async run(a) {
        const libraryID = getLibraryID(a);
        assertEditable(libraryID);
        const col = await resolveCollection(libraryID, a.collection, true);
        const done = [];
        for (const k of a.keys || []) {
          const item = await getItemByKey(libraryID, k);
          if (!item.isTopLevelItem()) continue;
          item.addToCollection(col.id);
          await item.saveTx();
          done.push(item.key);
        }
        return { collection: collectionPath(col), added: done };
      },
    },
    {
      name: "find_pdf",
      title: "Find open-access PDF",
      description: "Ask Zotero to find and attach an open-access PDF for existing items (via DOI / Unpaywall / URL).",
      annotations: ADD,
      write: true,
      inputSchema: {
        type: "object",
        required: ["keys"],
        properties: { keys: { type: "array", items: { type: "string" } }, ...LIB },
      },
      async run(a) {
        const libraryID = getLibraryID(a);
        const out = [];
        for (const k of a.keys || []) {
          const item = await getItemByKey(libraryID, k);
          out.push({ key: item.key, title: field(item, "title"), result: await tryAttachPDF(item) });
        }
        return out;
      },
    },
    {
      name: "remove_from_collection",
      title: "Remove items from a collection",
      description:
        "Take items out of one collection (to move them, add_to_collection first, then this). " +
        "The items stay in the library and in their other collections; nothing is deleted.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      write: true,
      inputSchema: {
        type: "object",
        required: ["keys", "collection"],
        properties: {
          keys: { type: "array", items: { type: "string" } },
          collection: { type: "string" },
          ...LIB,
        },
      },
      async run(a) {
        const libraryID = getLibraryID(a);
        assertEditable(libraryID);
        const col = await resolveCollection(libraryID, a.collection, false);
        const done = [];
        for (const k of a.keys || []) {
          const item = await getItemByKey(libraryID, k);
          if (!item.inCollection(col.id)) continue;
          item.removeFromCollection(col.id);
          await item.saveTx();
          done.push(item.key);
        }
        return { collection: collectionPath(col), removed: done };
      },
    },
    {
      name: "library_overview",
      title: "Library overview",
      description:
        "Statistics for organising a library: item counts by type, unfiled items, items without a PDF, " +
        "duplicate sets, retracted papers, collection tree with counts and the most used tags.",
      annotations: READ,
      inputSchema: { type: "object", properties: { top_tags: { type: "integer", default: 40 }, ...LIB } },
      async run(a) {
        const libraryID = getLibraryID(a);
        const s = new Zotero.Search();
        s.libraryID = libraryID;
        s.addCondition("deleted", "false");
        const items = (await Zotero.Items.getAsync(await s.search()))
          .filter((i) => i.isRegularItem() && i.isTopLevelItem());
        const byType = {};
        const tagCount = {};
        let noFile = 0;
        let unfiled = 0;
        for (const i of items) {
          byType[i.itemType] = (byType[i.itemType] || 0) + 1;
          if (!hasFileAttachment(i)) noFile++;
          if (!i.getCollections().length) unfiled++;
          for (const t of i.getTags()) tagCount[t.tag] = (tagCount[t.tag] || 0) + 1;
        }
        let duplicateSets = null;
        try {
          const dup = new Zotero.Duplicates(libraryID);
          const ds = await dup.getSearchObject();
          const ids = await ds.search();
          const seen = new Set();
          duplicateSets = 0;
          for (const id of ids) {
            if (seen.has(id)) continue;
            dup.getSetItemsByItemID(id).forEach((x) => seen.add(x));
            duplicateSets++;
          }
        } catch (e) { /* ignore */ }
        let retracted = null;
        try {
          const rs = new Zotero.Search();
          rs.libraryID = libraryID;
          rs.addCondition("retracted", "true");
          retracted = (await rs.search()).length;
        } catch (e) { /* ignore */ }
        return {
          totalItems: items.length,
          byType,
          unfiled,
          withoutPDF: noFile,
          duplicateSets,
          retracted,
          collections: Zotero.Collections.getByLibrary(libraryID, true).filter((c) => !c.deleted)
            .map((c) => `${collectionPath(c)} (${c.getChildItems(true, false).length})`).sort(),
          topTags: Object.entries(tagCount).sort((x, y) => y[1] - x[1]).slice(0, a.top_tags || 40)
            .map(([t, n]) => `${t} (${n})`),
        };
      },
    },
    {
      name: "find_duplicates",
      title: "Find duplicates",
      description:
        "List sets of duplicate items (Zotero's own duplicate detection). Merging is left to the user " +
        "in Zotero's 'Duplicate Items' view, since it is irreversible.",
      annotations: READ,
      inputSchema: { type: "object", properties: { limit: { type: "integer", default: 50 }, ...LIB } },
      async run(a) {
        const libraryID = getLibraryID(a);
        const dup = new Zotero.Duplicates(libraryID);
        const ds = await dup.getSearchObject();
        const ids = await ds.search();
        const seen = new Set();
        const sets = [];
        for (const id of ids) {
          if (seen.has(id)) continue;
          const set = dup.getSetItemsByItemID(id);
          set.forEach((x) => seen.add(x));
          sets.push((await Zotero.Items.getAsync(set)).map((i) => ({
            key: i.key, title: field(i, "title"), year: year(i), dateAdded: i.dateAdded,
            attachments: i.isRegularItem() ? i.getAttachments().length : 0,
          })));
          if (sets.length >= (a.limit || 50)) break;
        }
        return { duplicateSets: sets.length, sets };
      },
    },
    {
      name: "export_markdown",
      title: "Export to local Markdown knowledge base",
      description:
        "Write items to a local folder as Markdown files (YAML front matter, metadata, abstract, notes, " +
        "PDF annotations and, optionally, the full text of PDFs/EPUBs/web snapshots). Image attachments " +
        "(screenshots, figures) are copied to <folder>/assets and linked. Also writes <folder>/index.md. " +
        "Use this instead of get_fulltext when the content should stay available on disk, and to save tokens: " +
        "the text goes straight to disk and only a file list comes back. Choose items with keys, a collection, " +
        "or a search query.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        type: "object",
        required: ["folder"],
        properties: {
          folder: { type: "string", description: "Absolute path of the output folder (created if missing)" },
          keys: { type: "array", items: { type: "string" } },
          collection: { type: "string", description: "Export a whole collection (with subcollections)" },
          query: { type: "string", description: "Export the results of an 'everything' search" },
          include_fulltext: { type: "boolean", default: true },
          max_chars_per_item: { type: "integer", default: 400000 },
          limit: { type: "integer", default: 200 },
          ...LIB,
        },
      },
      async run(a) {
        const libraryID = getLibraryID(a);
        const folder = String(a.folder || "").trim();
        if (!folder.startsWith("/") && !/^[A-Za-z]:\\/.test(folder)) {
          throw new Error("folder must be an absolute path");
        }
        if (/^\/(System|usr|bin|sbin|etc|private\/etc|Library)(\/|$)/.test(folder)) {
          throw new Error("Refusing to write into a system folder");
        }
        // collect items
        let items = [];
        for (const k of a.keys || []) items.push(await getItemByKey(libraryID, k));
        if (a.collection) {
          const col = await resolveCollection(libraryID, a.collection, false);
          let ids = col.getChildItems(true, false);
          for (const sub of col.getDescendents(false, "collection")) {
            ids = ids.concat(Zotero.Collections.get(sub.id).getChildItems(true, false));
          }
          items = items.concat(await Zotero.Items.getAsync([...new Set(ids)]));
        }
        if (a.query) {
          const s = new Zotero.Search();
          s.libraryID = libraryID;
          s.addCondition("quicksearch-everything", "contains", a.query);
          s.addCondition("deleted", "false");
          items = items.concat(await Zotero.Items.getAsync(await s.search()));
        }
        items = toTopLevel(items).slice(0, a.limit || 200);
        if (!items.length) throw new Error("Nothing to export: give keys, a collection or a query");

        await io().makeDirectory(folder, { createAncestors: true, ignoreExisting: true });
        const assetsDir = pu().join(folder, "assets");
        const written = [];
        const index = ["# Zotero export", "", `Exported ${new Date().toISOString()} from Zotero`, ""];
        for (const item of items) {
          await item.loadAllData();
          const md = await itemToMarkdown(item, {
            fulltext: a.include_fulltext !== false,
            maxChars: a.max_chars_per_item || 400000,
            assetsDir,
          });
          const file = pu().join(folder, markdownFileName(item));
          await Zotero.File.putContentsAsync(file, md.text);
          written.push({ key: item.key, file, chars: md.text.length, fulltext: md.hasFullText, images: md.images });
          index.push(`- [${field(item, "title") || item.key}](${markdownFileName(item)}) — ` +
            `${creatorNames(item, 3).join("; ")} ${year(item)} \`${item.key}\``);
        }
        await Zotero.File.putContentsAsync(pu().join(folder, "index.md"), index.join("\n") + "\n");
        return { folder, files: written.length, items: written };
      },
    },
    {
      name: "save_webpage",
      title: "Save web page with snapshot",
      description:
        "Save a web page to Zotero the way the browser connector does: load it in a hidden browser, " +
        "run Zotero's site translators (journal/publisher/news pages get full metadata, e.g. a journal " +
        "article instead of a web page) and store a full HTML snapshot (or the PDF, for PDF URLs). The " +
        "snapshot is indexed, so it is searchable and readable with get_fulltext / export_markdown. " +
        "If the URL is already in the library, a new dated snapshot is added to that item instead of " +
        "creating a duplicate. With parent_key, the snapshot is attached to that existing item.",
      annotations: ADD,
      write: true,
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "http(s) URL of the page" },
          collection: { type: "string", description: "Collection key, name or path (created if missing)" },
          tags: { type: "array", items: { type: "string" } },
          title: { type: "string", description: "Override the page title" },
          parent_key: { type: "string", description: "Attach the snapshot to this existing item instead" },
          use_translators: { type: "boolean", default: true, description: "Try Zotero's site translators for metadata" },
          ...LIB,
        },
      },
      async run(a) {
        let libraryID = getLibraryID(a);
        const url = String(a.url || "").trim();
        if (!/^https?:\/\/\S+$/i.test(url)) throw new Error("url must be an http(s) URL");
        const stamp = new Date().toISOString().slice(0, 10);
        const cu = typeof ChromeUtils !== "undefined" ? ChromeUtils : Zotero.getMainWindow().ChromeUtils;
        const { HiddenBrowser } = cu.importESModule("chrome://zotero/content/HiddenBrowser.mjs");

        let parent = null;
        if (a.parent_key) {
          parent = await getItemByKey(libraryID, a.parent_key);
          if (!parent.isRegularItem()) throw new Error("parent_key must be a regular item");
          libraryID = parent.libraryID;
        }
        assertEditable(libraryID);
        const col = parent ? null : await resolveCollection(libraryID, a.collection, true);

        // A DOI or arXiv ID in the URL (doi.org/…, arxiv.org/abs|pdf/…, publisher URLs with /doi/…)
        // identifies the work even when a saved copy has a different URL.
        const idText = url
          .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
          .replace(/^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf)\/([^\s?#]+?)(v\d+)?(\.pdf)?$/i, "arXiv:$3")
          .replace(/^https?:\/\/[^/]+\/(?:.*\/)?doi\/(?:abs\/|full\/|pdf\/)?(10\.\d{4,}\/[^?#]+)$/i, "$1");
        let urlIdents = [];
        if (idText !== url) {
          try {
            urlIdents = Zotero.Utilities.extractIdentifiers(decodeURIComponent(idText));
          } catch (e) { /* ignore */ }
        }

        // Same URL or same work already saved? Then refresh it with a new snapshot instead of duplicating.
        let existing = null;
        if (!parent) {
          const s = new Zotero.Search();
          s.libraryID = libraryID;
          s.addCondition("url", "is", url);
          s.addCondition("deleted", "false");
          existing = toTopLevel(await Zotero.Items.getAsync(await s.search())).find((i) => i.isRegularItem()) || null;
          for (const ident of urlIdents) {
            if (existing) break;
            existing = await findExisting(libraryID, ident);
          }
        }

        let item = parent || existing;
        const status = parent ? "snapshot added to item" : existing ? "existing item, new snapshot added" : "added";
        let method = item ? "snapshot" : null;
        let created = false; // an item made by this call is removed again if saving fails
        let isPDF = /\.pdf($|[?#])/i.test(url) || /arxiv\.org\/pdf\//i.test(url);
        const browser = new HiddenBrowser({ docShell: { allowImages: true } });
        try {
          // A new work with a DOI/arXiv ID: get the metadata by identifier, as add_by_identifier does.
          if (!item && urlIdents.length && a.use_translators !== false) {
            try {
              const tr = new Zotero.Translate.Search();
              tr.setIdentifier(urlIdents[0]);
              const translators = await tr.getTranslators();
              if (translators.length) {
                tr.setTranslator(translators);
                const items = await tr.translate({ libraryID, collections: col ? [col.id] : false, saveAttachments: true });
                if (items && items.length) {
                  item = items[0];
                  created = true;
                  method = "identifier: " + Object.entries(urlIdents[0]).map(([k, v]) => `${k} ${v}`).join("");
                }
              }
            } catch (e) {
              Zotero.debug("[Claude Bridge] identifier lookup failed, using the page: " + e);
            }
          }

          if (!isPDF) {
            await browser.load(url, { requireSuccessfulStatus: true });
            isPDF = Zotero.Attachments.isPDFJSBrowser(browser) || browser.documentContentType === "application/pdf";
          }

          if (!item && !isPDF && a.use_translators !== false) {
            const { RemoteTranslate } = cu.importESModule("chrome://zotero/content/RemoteTranslate.mjs");
            const tr = new RemoteTranslate();
            try {
              await tr.setBrowser(browser);
              const translators = await tr.detect();
              if (translators && translators.length) {
                const items = await tr.translate({
                  libraryID,
                  collections: col ? [col.id] : false,
                  saveAttachments: true,
                });
                if (items && items.length) {
                  item = items[0];
                  created = true;
                  method = "translator: " + translators[0].label;
                }
              }
            } catch (e) {
              Zotero.debug("[Claude Bridge] translation failed, saving as web page: " + e);
            } finally {
              tr.dispose();
            }
          }

          if (!item) {
            item = new Zotero.Item("webpage");
            item.libraryID = libraryID;
            let title = a.title || (!isPDF && browser.contentTitle) || "";
            if (!title) {
              try {
                title = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || url);
              } catch (e) {
                title = url;
              }
            }
            item.setField("title", title);
            item.setField("url", url);
            item.setField("accessDate", Zotero.Date.dateToSQL(new Date(), true));
            try {
              item.setField("websiteTitle", new URL(url).hostname.replace(/^www\./, ""));
            } catch (e) { /* ignore */ }
            if (col) item.addToCollection(col.id);
            await item.saveTx();
            created = true;
            method = isPDF ? "PDF" : "web page";
          } else if (a.title && created) {
            item.setField("title", a.title);
          }
          if (col && !item.inCollection(col.id)) item.addToCollection(col.id);
          await addTags(item, a.tags);
          await item.saveTx();

          // Make sure there is a fresh file for *this* save (translators may already have saved one)
          const since = Zotero.Date.dateToSQL(new Date(Date.now() - 10 * 60000), true);
          const fresh = () => item.getAttachments().map((id) => Zotero.Items.get(id))
            .filter((x) => x && !x.deleted && x.isFileAttachment() && x.dateAdded >= since);
          let att = created && method !== "web page" && method !== "PDF" ? fresh()[0] : null;
          if (!att && isPDF) {
            att = await Zotero.Attachments.importFromURL({
              libraryID,
              url,
              parentItemID: item.id,
              contentType: "application/pdf",
              title: created ? "PDF" : `PDF ${stamp}`,
            });
          } else if (!att) {
            att = await Zotero.Attachments.importFromDocument({
              libraryID,
              browser,
              parentItemID: item.id,
              title: `Snapshot ${stamp}`,
            });
          }

          let chars = 0;
          if (att) {
            try {
              chars = (await attachmentText(att, true)).length;
            } catch (e) { /* ignore */ }
          }
          const r = {
            status,
            method,
            ...summarize(item),
            url,
            snapshot: att ? { key: att.key, title: att.getField("title"), contentType: att.attachmentContentType, indexedChars: chars } : null,
          };
          if (col) r.collection = collectionPath(col);
          if (status === "added") {
            const dups = await sameTitleItems(item);
            if (dups.length) r.possibleDuplicates = dups;
          }
          return r;
        } catch (e) {
          // Roll back an item this call created, so a failed save leaves nothing half-made behind
          if (created && item && item.id) {
            try {
              await item.eraseTx();
            } catch (e2) { /* ignore */ }
          }
          throw e;
        } finally {
          browser.destroy();
        }
      },
    },
    {
      name: "select_in_zotero",
      title: "Show item in Zotero",
      description: "Bring the Zotero window forward and select the given item so the user can look at it.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        type: "object",
        required: ["key"],
        properties: { key: { type: "string" }, ...LIB },
      },
      async run(a) {
        const item = await getItemByKey(getLibraryID(a), a.key);
        const pane = getPane();
        if (!pane) throw new Error("Zotero main window is not open");
        await pane.selectItem(item.id);
        const win = Zotero.getMainWindow();
        if (win) win.focus();
        return "Selected " + (field(item, "title") || item.key);
      },
    },
  ];
}();
