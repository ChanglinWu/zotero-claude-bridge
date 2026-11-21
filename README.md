# Claude Bridge for Zotero

[![Release](https://img.shields.io/github/v/release/ChanglinWu/zotero-claude-bridge?label=release)](https://github.com/ChanglinWu/zotero-claude-bridge/releases/latest)
[![Zotero 7–10](https://img.shields.io/badge/Zotero-7%20%E2%80%93%2010-CC2936)](https://www.zotero.org)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin%20%2B%20skill-D97757)](#quick-start)
[![No API key](https://img.shields.io/badge/API%20key-not%20needed-2ea44f)](#how-it-works)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Use Zotero as Claude Code's reference library, with no API key.**
Papers Claude finds go straight into Zotero, with real metadata, the PDF and duplicate checks. Your whole library, including PDFs, highlights, notes and web snapshots, becomes something Claude can search, read and cite.

[中文说明](#中文说明) · [Quick start](#quick-start) · [The /zotero skill](#the-zotero-skill) · [Tools](#tools)

```text
you › find the latest TSMC paper on its EPIC/COUPE photonic integration and put it in cc/光电子学集成
claude › Found it: "Optical and Electrical Characterization of a Compact Universal Photonic Engine",
         ECTC 2025, DOI 10.1109/ECTC51687.2025.00015.
         Already in your library (E3BHWFBK, PDF attached), so no copy was made.
         Filed into cc/光电子学集成 (new collection).

you › /zotero push the other three TSMC papers too
claude › | 2021 | Heterogeneous Integration of a Compact Universal Photonic Engine…        | ECTC | added 2PKPSQGG |
         | 2024 | High Bandwidth and Energy Efficient E-O System Integration Using COUPE | ECTC | added IILN9N2E |
         | 2025 | TSMC in the Silicon Photonics Era – an electrical perspective         | OFC  | added XWM3QGXY |

you › /zotero save https://ispsd2027.com/registration/
claude › Saved to cc/会议资讯 with a full snapshot (9PWZ3AVK). The page says "More information coming soon";
         saving it again later adds a dated snapshot to the same item.
```

## Why this one?

| | Claude Bridge for Zotero | Typical Zotero MCP servers |
|---|---|---|
| API key / zotero.org account | **Not needed** | Needed for writing (Zotero Web API) |
| Extra server to install (Python/Node) | **None.** The server runs inside Zotero | Usually yes |
| Add papers | **By DOI / arXiv / ISBN / PMID / title / URL**, using Zotero's own translators, with PDF and duplicate check | Often limited or Web-API only |
| Web pages | **Full snapshots**, as with the browser connector | Rarely |
| Read PDFs, highlights and notes | Yes, plus export to a local Markdown knowledge base | Varies |
| Ready-made workflows | **`/zotero` skill**: push · save · sort · read · review · ask · cite · check | Tools only |
| Deletes anything? | **Never** | Varies |

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
| **Zotero plugin** (`.xpi`) | inside Zotero | the MCP server and its 25 tools |
| **Claude Code plugin** `zotero` | in Claude Code | the [`/zotero` skill](claude-plugin/skills/zotero/SKILL.md) and the MCP connection |

## Quick start

**1. Zotero plugin.** Download the `.xpi` from the [latest release](https://github.com/ChanglinWu/zotero-claude-bridge/releases/latest). In Zotero 7 or later, open **Tools → Plugins** and drag the `.xpi` onto that window, or use ⚙ → *Install Plugin From File…*. It updates itself from GitHub after that. If drag-and-drop does nothing, use [scripts/install_via_run_javascript.js](scripts/install_via_run_javascript.js) in *Tools → Developer → Run JavaScript*.

**2. Claude Code plugin.** In Claude Code:

```
/plugin install zotero --marketplace ChanglinWu/zotero-claude-bridge
```

On older Claude Code versions:

```bash
claude plugin marketplace add ChanglinWu/zotero-claude-bridge
claude plugin install zotero@zotero-claude-bridge
```

Start a new session and try `/zotero check`. Zotero has to be running while you use it.

Check the connection: `curl http://127.0.0.1:23119/claude-bridge/info`, or run `python3 scripts/smoke_test.py`.

## Claude Code vs. chat

**Use it in Claude Code** (the CLI or the Code tab of the Claude desktop app). That is where Claude can save to Zotero and work with your library interactively.

In **chat** (Claude Desktop chat, claude.ai), Claude cannot reach Zotero the same way. There the skill says so and sticks to **searching the literature**: it lists papers with their DOIs and gives you the `/zotero push …` command to run in Claude Code. It never falls back to clicking through Zotero on screen.

<details>
<summary>Advanced: optional folder mailbox (off by default)</summary>

If you really want chat to use your library, the Zotero plugin can watch a folder mailbox, `~/Zotero/claude-bridge/`. Claude writes a request to `inbox/` and Zotero writes the answer to `outbox/`.

- **Off by default.** While it is off, Zotero never looks at that folder. To turn it on, open Zotero → Settings → Advanced → Config Editor and set `extensions.zotero-claude-bridge.mailbox` to `true`. The change applies immediately.
- **Limits while it is on:** Zotero checks the folder every 1.5 s and writes a heartbeat every 30 s. Exports can only go inside that folder, and nothing is ever deleted from your library.
- **Chat access:** give the chat access to `~/Zotero/claude-bridge` only, not your whole `~/Zotero` folder.
- **Trade-off:** anything that can write to that folder can ask Zotero to add items or notes, so leave it off unless you need it.

</details>

## The `/zotero` skill

| Command | What happens |
|---|---|
| `/zotero push <title / short name / DOI / arXiv / "all" / "#3"> [to <collection>]` | Papers found in the conversation (search results, a digest, a reading list) are matched to a DOI or arXiv ID via Crossref/arXiv, without needing a key, then added with full metadata and an open-access PDF. Duplicates are detected. Without a collection they go to `Claude Inbox`. |
| `/zotero save <URL / page> [to <collection>]` | Saves a web page as the Zotero browser connector does. Zotero's site translators supply the metadata, and a full HTML snapshot is stored and indexed for full-text search. Saving the same URL again adds a new dated snapshot instead of a duplicate. |
| `/zotero sort [goal]` | Surveys the library and proposes a collection tree and tags, either a general tidy-up or a goal such as "for a review on X", which searches the whole library. **Nothing changes until you approve the plan.** Duplicates are reported, not merged. |
| `/zotero read <items / selected / collection / query> [into <folder>]` | Exports items to a local Markdown knowledge base (default `./zotero-kb/`). Each item gets one file with metadata, abstract, notes, PDF highlights and full text. Web snapshots are included and screenshots are copied to `assets/`. Claude then works from these files. |
| `/zotero review <topic>` | Searches the whole library, builds an evidence matrix, writes a review draft that cites only your library, writes `references.bib`, and lists gaps you can fill with `push`. |
| `/zotero ask <question>` | Answers from your library, citing item keys and pages. |
| `/zotero cite <file.tex/.md / keys / collection> [bibtex / ieee / …]` | Builds the bibliography for a manuscript and flags citations that are not in Zotero yet. |
| `/zotero check` | Reports library health: duplicates, missing PDFs, unfiled items. |

Writing `@zotero …` or asking in plain words ("push this paper to Zotero", "整理我的 Zotero") also triggers the skill.

### Use the skill on its own

The skill is a single file, [`claude-plugin/skills/zotero/SKILL.md`](claude-plugin/skills/zotero/SKILL.md). Read it, fork it, or adapt it to your own workflow. To use it without the Claude Code plugin, for example with a different setup or in your own skills folder:

```bash
mkdir -p ~/.claude/skills/zotero
curl -L https://raw.githubusercontent.com/ChanglinWu/zotero-claude-bridge/main/claude-plugin/skills/zotero/SKILL.md -o ~/.claude/skills/zotero/SKILL.md
claude mcp add --transport http --scope user zotero http://127.0.0.1:23119/claude-bridge/mcp
```

The skill needs the Zotero plugin (step 1 of the quick start) for its tools. Personal preferences belong in your own `~/.claude/CLAUDE.md`, not in the skill, for example:

```markdown
# Zotero
- Default collection for `/zotero push`: `Inbox`.
- Conference information (registration pages, calls for papers, deadlines) goes in `Conferences`.
```


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
| `save_webpage` | Save a web page with a full snapshot, using a hidden browser and Zotero's site translators, either as a new item or as a fresh snapshot of an existing one |
| `attach_file` | Attach local files (PDF, EPUB, anything) to an existing item, either as a stored copy or as a linked file; files already attached are skipped |
| `get_job` | Get the result of a call that ran longer than 45 s (large imports keep running in Zotero) |
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
- The optional folder mailbox is **off by default**. When on, it accepts requests from anything that can write to `~/Zotero/claude-bridge/`, so leave it off unless you need it. Read-only mode applies to it too.
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
- `/zotero save <网址/网页>`：像 Zotero 浏览器插件一样保存网页：自动识别元数据，保存完整的网页快照，并支持全文检索。同一网址再存一次时，会给原条目加一份带日期的新快照，不会产生重复条目。
- `/zotero sort [目标]`：整理文献库，可以按主题分类，也可以按特定需求组织，比如「为某主题的综述建一个分类」。整理方案要你确认后才会动手。
- `/zotero read <条目/当前选中/分类/关键词>`：把文献、笔记、PDF 高亮、网页快照和截图导出成本地 Markdown，相当于给 Claude 外挂一个知识库。
- `/zotero review <主题>`：检索整个文献库，写一份只引用你自己库里文献的综述草稿，生成 `references.bib`，并指出还缺哪些文献。
- `/zotero ask <问题>`：根据你的文献库回答问题，并给出条目和页码。
- `/zotero cite <稿件/条目>`：为稿件生成参考文献，并标出 Zotero 里还没有的引用。
- `/zotero check`：检查文献库，包括重复条目、缺 PDF 的条目和未分类的条目。

在对话里写 `@zotero …`，或直接说「推送到 Zotero」「整理我的 Zotero」，也能触发这个 skill。

**Claude Code 和聊天的区别**：请在 Claude Code 里使用，也就是命令行或桌面版的 Code 标签页，这里可以把文献存进 Zotero，也能和文献库交互。在聊天页面（桌面版聊天、claude.ai）里，Claude 无法像在 Claude Code 里那样直接保存和交互，所以 skill 只用来检索文献：它会列出文献和 DOI，并给出可以拿到 Claude Code 里运行的 `/zotero push …` 命令。skill 不会去操作屏幕。另外还有一个可选的文件夹中转功能（`extensions.zotero-claude-bridge.mailbox`），默认关闭，详见英文部分。

**单独使用 skill**：skill 只有一个文件 [`SKILL.md`](claude-plugin/skills/zotero/SKILL.md)，欢迎阅读、fork 或改成适合你自己的工作流。不装 Claude Code 插件也能用：把它放到 `~/.claude/skills/zotero/`，再用 `claude mcp add` 连接 Zotero（命令见上方英文部分）。个人偏好，比如默认分类，写在你自己的 `~/.claude/CLAUDE.md` 里。

**能做什么**：检索文献库（包括 PDF 全文）、读取元数据、全文和 PDF 高亮批注；用 DOI、arXiv、ISBN 或 PMID 一键入库，自动补全元数据、尝试下载开放获取的 PDF、自动查重、归档到指定分类（没有就新建）并打标签；写笔记；导出 BibTeX 或任意 CSL 格式的参考文献。插件**不会删除**任何东西。

**只读模式**：在「设置 → 高级 → 配置编辑器」里把 `extensions.zotero-claude-bridge.readOnly` 设为 `true`。

## License

MIT
