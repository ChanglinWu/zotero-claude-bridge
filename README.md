# Claude Bridge for Zotero

A Zotero plugin that lets **Claude Code** (desktop app or CLI) work directly with your Zotero library.
**No API key, no zotero.org account and no extra server to install.**

[中文说明](#中文说明)

- Papers Claude finds can go straight into Zotero, with full metadata and an open-access PDF when one exists.
- Claude can use your Zotero library as its reference collection: search it, read full texts and your PDF highlights, and write notes.

## How it works

Zotero already runs a small local web server on `127.0.0.1:23119`; the Zotero browser connector uses it.
This plugin adds an [MCP](https://modelcontextprotocol.io) endpoint to that server:

```
Claude Code ──MCP over HTTP──▶ http://127.0.0.1:23119/claude-bridge/mcp ──▶ Zotero's own JavaScript API
```

Because the plugin runs inside Zotero, it writes through Zotero's normal API. Nothing goes through the zotero.org web API, so no key is needed. If you use Zotero sync, new items sync as usual.

## Install

1. Download `zotero-claude-bridge-x.y.z.xpi` from [Releases](https://github.com/ChanglinWu/zotero-claude-bridge/releases).
2. In Zotero 7 or later, open **Tools → Plugins**, then drag the `.xpi` onto that window, or use ⚙ → *Install Plugin From File…*.
3. Connect Claude Code (one time, in a terminal):

   ```bash
   claude mcp add --transport http --scope user zotero http://127.0.0.1:23119/claude-bridge/mcp
   ```

4. Restart or start a new Claude Code session. Zotero has to be running while you use it.

Check that it works: open <http://127.0.0.1:23119/claude-bridge/info> in a terminal with `curl`, or run `python3 scripts/smoke_test.py`.

> Claude Desktop (chat) only supports stdio servers. If you want it there too, add
> `{"command": "npx", "args": ["mcp-remote", "http://127.0.0.1:23119/claude-bridge/mcp"]}` to `claude_desktop_config.json`.

## Tools

| Tool | What it does |
|---|---|
| `search_items` | Quick search (title/author/year, all fields, or everything including PDF full text); filter by collection, tag or type |
| `get_item` | All metadata, abstract, notes, attachments (with local PDF paths), collections |
| `get_fulltext` | Text of the PDF/EPUB, paged; indexes the file first if needed |
| `get_annotations` | Highlights and comments from Zotero's PDF reader |
| `list_collections` / `get_collection_items` | Browse collections |
| `recent_items` | Recently added items |
| `get_selected_items` | Whatever is selected in the Zotero window right now ("summarise this paper") |
| `list_libraries` | My Library and group libraries |
| `export_citations` | Bibliography or citations in any installed CSL style, or BibTeX / BibLaTeX / RIS / CSL-JSON |
| `add_by_identifier` | **Add papers by DOI, arXiv ID, ISBN or PMID.** Zotero fetches the metadata and an OA PDF; duplicates are detected; can file into a collection and add tags |
| `add_item` | Add an item from metadata when there is no identifier |
| `update_item` | Edit fields, add or remove tags |
| `add_note` | Add a Markdown note to an item, or a standalone note |
| `create_collection` / `add_to_collection` | Organise items |
| `find_pdf` | Find and attach an open-access PDF for existing items |
| `select_in_zotero` | Show an item in the Zotero window |

The plugin never deletes or trashes anything.

Example prompts in Claude Code:

- "Find recent reviews on hybrid bonding and add the 5 best to Zotero under *Packaging/Hybrid bonding*."
- "What does my library say about Cu–Cu bonding temperature? Cite item keys."
- "Read the paper I have selected in Zotero and add a summary note to it."
- "Export everything in collection *Thesis/Ch2* as BibTeX."

## Security

- The plugin only listens on localhost. Zotero rejects requests whose `Host` header is not local, which blocks DNS rebinding, and requests from web pages. The plugin also refuses any request that has an `Origin` header.
- Any program running as your user on this Mac can reach the endpoint. That is the same trust level as Zotero's existing connector and local API.
- Read-only mode: in Zotero, open Settings → Advanced → Config Editor and set `extensions.zotero-claude-bridge.readOnly` to `true`. Write tools then return an error.

## Build

```bash
./build.sh   # → dist/zotero-claude-bridge-<version>.xpi and dist/updates.json
```

The source is plain JavaScript with no build step: `bootstrap.js` and `src/bridge.js`.

---

## 中文说明

这个 Zotero 插件让 **Claude Code** 直接读写你的 Zotero 文献库。**不需要 API 密钥，不需要 zotero.org 账号，也不需要另装服务器。**

**原理**：Zotero 本身在 `127.0.0.1:23119` 跑着一个本地服务，浏览器插件用的就是它。本插件在这个服务上加了一个 MCP 接口，Claude Code 连上后，通过 Zotero 自己的内部 API 操作文献库，所以不需要密钥。开了同步的话，新条目会照常同步到云端。

**安装**

1. 从 [Releases](https://github.com/ChanglinWu/zotero-claude-bridge/releases) 下载 `.xpi`。
2. 在 Zotero 里打开「工具 → 插件」，把 `.xpi` 拖进窗口；也可以点 ⚙ →「从文件安装插件…」。
3. 在终端运行一次：
   ```bash
   claude mcp add --transport http --scope user zotero http://127.0.0.1:23119/claude-bridge/mcp
   ```
4. 新开一个 Claude Code 会话。使用时 Zotero 要开着。

**能做什么**：检索文献库（包括 PDF 全文）、读取元数据、全文和 PDF 高亮批注；用 DOI、arXiv、ISBN 或 PMID 一键入库，自动补全元数据、尝试下载开放获取的 PDF、自动查重、归档到指定分类（没有就新建）并打标签；写笔记；导出 BibTeX 或任意 CSL 格式的参考文献。插件**不会删除**任何东西。

**只读模式**：在「设置 → 高级 → 配置编辑器」里把 `extensions.zotero-claude-bridge.readOnly` 设为 `true`。

## License

MIT
