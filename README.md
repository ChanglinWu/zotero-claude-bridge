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

There are two parts:

| Part | Where it runs | What it does |
|---|---|---|
| **Zotero plugin** (`.xpi`) | inside Zotero | the MCP server and its tools |
| **Claude Code plugin** `zotero` | in Claude Code | the `/zotero` skill (push · sort · read · review · ask · cite · check) and the MCP connection |

## Install

**1. Zotero plugin.** Download `zotero-claude-bridge-x.y.z.xpi` from [Releases](https://github.com/ChanglinWu/zotero-claude-bridge/releases). In Zotero 7 or later, open **Tools → Plugins**, then drag the `.xpi` onto that window, or use ⚙ → *Install Plugin From File…*. If nothing happens, use [scripts/install_via_run_javascript.js](scripts/install_via_run_javascript.js) in *Tools → Developer → Run JavaScript*.

**2. Claude Code plugin.** In Claude Code:

```
/plugin install zotero --marketplace ChanglinWu/zotero-claude-bridge
```

On older Claude Code versions:

```bash
claude plugin marketplace add ChanglinWu/zotero-claude-bridge
claude plugin install zotero@zotero-claude-bridge
```

This adds the `/zotero` skill and connects the Zotero MCP server. Start a new session afterwards. Zotero has to be running while you use it.

*MCP only, without the skill:* `claude mcp add --transport http --scope user zotero http://127.0.0.1:23119/claude-bridge/mcp`

Check that it works: `curl http://127.0.0.1:23119/claude-bridge/info`, or run `python3 scripts/smoke_test.py`.

## The `/zotero` skill

| Command | What happens |
|---|---|
| `/zotero push <title / short name / DOI / arXiv / "all" / "#3"> [to <collection>]` | Papers found in the conversation (search results, a digest, a reading list) are matched to a DOI or arXiv ID via Crossref/arXiv, without needing a key, then added with full metadata and an open-access PDF. Duplicates are detected. Without a collection they go to `Claude Inbox`. |
| `/zotero sort [goal]` | Surveys the library and proposes a collection tree and tags, either a general tidy-up or a goal such as "for a review on X", which searches the whole library. **Nothing changes until you approve the plan.** Duplicates are reported, not merged. |
| `/zotero read <items / selected / collection / query> [into <folder>]` | Exports items to a local Markdown knowledge base (default `./zotero-kb/`). Each item gets one file with metadata, abstract, notes, PDF highlights and full text. Web snapshots are included and screenshots are copied to `assets/`. Claude then works from these files. |
| `/zotero review <topic>` | Searches the whole library, builds an evidence matrix, writes a review draft that cites only your library, writes `references.bib`, and lists gaps you can fill with `push`. |
| `/zotero ask <question>` | Answers from your library, citing item keys and pages. |
| `/zotero cite <file.tex/.md / keys / collection> [bibtex / ieee / …]` | Builds the bibliography for a manuscript and flags citations that are not in Zotero yet. |
| `/zotero check` | Reports library health: duplicates, missing PDFs, unfiled items. |

Writing `@zotero …` or asking in plain words ("push this paper to Zotero", "整理我的 Zotero") also triggers the skill.

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
| `create_collection` / `add_to_collection` / `remove_from_collection` | Organise items; removing only takes an item out of one collection |
| `library_overview` | Counts by type, unfiled items, items without a PDF, duplicate sets, retracted papers, collection tree, top tags |
| `find_duplicates` | Duplicate sets, for you to merge in Zotero |
| `export_markdown` | Writes items as Markdown (with full text, annotations and images) into a local folder, so a large library doesn't have to pass through the chat |
| `find_pdf` | Find and attach an open-access PDF for existing items |
| `select_in_zotero` | Show an item in the Zotero window |

The plugin never deletes or trashes anything.

Example prompts in Claude Code:

- "Find recent reviews on hybrid bonding and add the 5 best to Zotero under *Packaging/Hybrid bonding*."
- "What does my library say about Cu–Cu bonding temperature? Cite item keys."
- "Read the paper I have selected in Zotero and add a summary note to it."
- "Export everything in collection *Thesis/Ch2* as BibTeX."

## Privacy

Everything stays on your computer. The MCP server is your own Zotero on `127.0.0.1`, and this project runs no server of its own and collects no data. Content Claude reads from your library is sent to Anthropic as part of your Claude conversation, like any other text you share with Claude. When you add papers, Zotero itself contacts the usual metadata services (Crossref, arXiv, Unpaywall and others) as it does when you add by identifier in Zotero. The `push` command may query the public Crossref and arXiv APIs with paper titles.

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

1. **Zotero 插件**：从 [Releases](https://github.com/ChanglinWu/zotero-claude-bridge/releases) 下载 `.xpi`，在 Zotero 里打开「工具 → 插件」，把它拖进窗口。
2. **Claude Code 插件**：在 Claude Code 里输入 `/plugin install zotero --marketplace ChanglinWu/zotero-claude-bridge`。旧版本 Claude Code 先运行 `claude plugin marketplace add ChanglinWu/zotero-claude-bridge`，再运行 `claude plugin install zotero@zotero-claude-bridge`。
3. 新开一个会话。使用时 Zotero 要开着。

**`/zotero` 命令**

- `/zotero push <论文名/简称/DOI/arXiv/"全部"/"第3篇">`：把对话里找到的文献推送进 Zotero，自动补全元数据、尝试下载开放获取的 PDF、自动查重。
- `/zotero sort [目标]`：整理文献库，可以按主题分类，也可以按特定需求组织，比如「为某主题的综述建一个分类」。整理方案要你确认后才会动手。
- `/zotero read <条目/当前选中/分类/关键词>`：把文献、笔记、PDF 高亮、网页快照和截图导出成本地 Markdown，相当于给 Claude 外挂一个知识库。
- `/zotero review <主题>`：检索整个文献库，写一份只引用你自己库里文献的综述草稿，生成 `references.bib`，并指出还缺哪些文献。
- `/zotero ask <问题>`：根据你的文献库回答问题，并给出条目和页码。
- `/zotero cite <稿件/条目>`：为稿件生成参考文献，并标出 Zotero 里还没有的引用。
- `/zotero check`：检查文献库，包括重复条目、缺 PDF 的条目和未分类的条目。

在对话里写 `@zotero …`，或直接说「推送到 Zotero」「整理我的 Zotero」，也能触发这个 skill。

**能做什么**：检索文献库（包括 PDF 全文）、读取元数据、全文和 PDF 高亮批注；用 DOI、arXiv、ISBN 或 PMID 一键入库，自动补全元数据、尝试下载开放获取的 PDF、自动查重、归档到指定分类（没有就新建）并打标签；写笔记；导出 BibTeX 或任意 CSL 格式的参考文献。插件**不会删除**任何东西。

**只读模式**：在「设置 → 高级 → 配置编辑器」里把 `extensions.zotero-claude-bridge.readOnly` 设为 `true`。

## License

MIT
