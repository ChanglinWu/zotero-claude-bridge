---
name: zotero
description: Use the user's Zotero library as Claude's reference library. Subcommands - push (save papers found in this conversation to Zotero by title or short name), sort (organise the library into collections, or build a topic collection for a goal such as a literature review), read (pull Zotero items, PDFs, notes, web snapshots and screenshots into a local Markdown knowledge base), review (write a literature review from the library), ask (answer a question from the library with citations), cite (BibTeX/bibliography for a manuscript), save (save a web page with a full snapshot, like the Zotero browser connector), check (library health). Use whenever the user types /zotero or @zotero, or says things like "push this paper to Zotero", "add these to Zotero", "save to my library", "organise my Zotero", "what does my library say about", "整理我的 Zotero", "推送到 Zotero", "存到文献库", "从 Zotero 里找", "写文献综述", "save this page to Zotero", "把这个网页存到 Zotero", "网页快照".
argument-hint: "push|save|sort|read|review|ask|cite|check [what]"
---

# Zotero

The user's Zotero library is reached through the **Claude Bridge for Zotero** plugin running inside the
user's own Zotero app (no API key; its tools never delete anything). Its tools are `search_items`, `get_item`,
`get_fulltext`, `get_annotations`, `list_collections`, `get_collection_items`, `recent_items`,
`get_selected_items`, `library_overview`, `find_duplicates`, `export_citations`, `export_markdown`,
`add_by_identifier`, `add_item`, `update_item`, `add_note`, `create_collection`, `add_to_collection`,
`remove_from_collection`, `find_pdf`, `save_webpage`, `attach_file`, `get_job`, `select_in_zotero`. They are
available directly in
**Claude Code** (CLI or the desktop app's Code tab). See "Where this skill works" below for chat.

Request: `$ARGUMENTS`

Read the first word of the request as the subcommand. If there is none, infer it from the request
(a paper title → push; a web page URL or "this page" → save; a question → ask). With no request at all, briefly list the subcommands.

## Where this skill works

**Never operate Zotero through screen control, computer use or by clicking its UI**, never edit
`zotero.sqlite`, and never script around missing tools with ad-hoc HTTP calls.

**Claude Code (full use).** If tools ending in `search_items`, `add_by_identifier` … are available, call them
directly. Everything below (push, save, sort, read, review, ask, cite, check) works here.
If they are missing: Zotero must be running with the **Claude Bridge for Zotero** plugin (Zotero → Tools →
Plugins → drag in the .xpi from https://github.com/ChanglinWu/zotero-claude-bridge/releases); then start a new
session or reconnect with `/mcp`. Check with `curl -s http://127.0.0.1:23119/claude-bridge/info`
(connection refused → Zotero is not running; `No endpoint found` → the Zotero plugin is not installed).

**Chat mode (Claude Desktop chat, claude.ai): search only.** If the Zotero tools are not available here, say
so once, in one sentence: *in chat mode Claude cannot save to Zotero or work with the library interactively as
it does in Claude Code; chat is recommended only for searching the literature.* Then:
- search for papers (web search), and present the results with title, authors, year, venue and DOI/arXiv
  link, so the user can pick;
- to save them, tell the user to run `/zotero push <names or DOIs>` in Claude Code (the desktop app's Code tab),
  and give the exact command with the identifiers you found;
- do not ask for folder access, do not use screen control, and do not attempt push, save, sort, notes or any
  other change to the library from chat.

**Optional folder mailbox (advanced, off by default).** Only if the user has turned it on themselves (Zotero →
Settings → Advanced → Config Editor → `extensions.zotero-claude-bridge.mailbox` = true) and this chat can open
`~/Zotero/claude-bridge` (ask for access to that folder only, never the whole `~/Zotero`):
- `~/Zotero/claude-bridge/status.json` exists and its `updated` time is less than ~2 minutes old → mailbox on.
- For each call write `~/Zotero/claude-bridge/inbox/<id>.json` with a new unique `<id>` (letters, digits, `-`,
  `_`): `{"id": "push-01", "tool": "add_by_identifier", "arguments": {"identifiers": ["10.1038/…"], "collection": "cc"}}`.
- Read the answer from `~/Zotero/claude-bridge/outbox/<id>.json` (`{"ok": …, "result" | "text": …}`); it
  takes a few seconds, up to a minute for adding papers or saving pages. Calls run one at a time.
- `export_markdown` through the mailbox can only write inside `~/Zotero/claude-bridge/` (e.g. `…/kb/<topic>`).
Do not suggest turning the mailbox on unless the user asks how to do more in chat.

## General rules

- Item keys are 8-character IDs such as `3PEADCUU`; always show them so the user can refer back.
- Collections can be given by key, name or path (`Projects/Thesis/Ch2`). Write tools create missing ones.
- Prefer `add_by_identifier` (DOI, arXiv, ISBN, PMID) over `add_item`: Zotero then fetches the real metadata
  and an open-access PDF itself. Never invent identifiers or metadata.
- Show results as a compact table, not raw JSON. End with what changed in Zotero.
- Large reads go to disk: use `export_markdown` and then read/grep the files, rather than pulling many full
  texts into the conversation with `get_fulltext`.
- Reorganising (moving items, removing them from collections, bulk tagging) needs the user's OK on a
  shown plan first. Adding papers they asked for and creating new collections do not.
- Duplicates are reported, never merged: merging is done by the user in Zotero's "Duplicate Items" view.
- A call that runs longer than ~45 s returns `{"status": "running", "job_id": …}` and keeps working in Zotero:
  call `get_job` with that id (repeat until `status` is `done` or `failed`) instead of calling the tool again.

## push — save papers to Zotero

`/zotero push <paper name | short name | DOI | arXiv | URL | "all" | numbers from a list> [to <collection>] [#tag …]`

1. **Work out which papers are meant.** Short names ("the AlphaFold paper", "#3", "all of them",
   "those two reviews") refer to papers already in this conversation (search results, a /report digest,
   a reading list). Collect title, authors, year and any DOI/arXiv/URL already shown.
2. **Find an identifier for each** that lacks one:
   - URL of doi.org / arxiv.org / a publisher page → take the DOI or arXiv ID from it;
   - otherwise query Crossref (no key needed):
     `curl -s "https://api.crossref.org/works?rows=3&select=DOI,title,author,issued,container-title&query.bibliographic=<url-encoded title + first author + year>"`
   - for preprints try arXiv: `curl -s "http://export.arxiv.org/api/query?max_results=3&search_query=ti:%22<title>%22"`
   - accept a match only if the title clearly matches (ignoring case/punctuation) and the year/author agree.
     If two candidates are plausible, ask. If none is found, use web search; if you have the paper's
     landing-page URL, `save_webpage` it (Zotero's translators then read the metadata from the page); as a
     last resort `add_item` with only the metadata you actually have (plus `url`).
3. **Add** with one `add_by_identifier` call for all identifiers:
   - collection: the one the user named; otherwise the collection named in the user's Zotero preference
     (CLAUDE.md or memory) if any; otherwise `Claude Inbox`.
   - tags: the user's tags, if any.
4. **Report** a table: title · status (added / already in library / failed) · key · PDF found? ·
   collection. If a result lists `possibleDuplicates`, say so and suggest merging them in Zotero's
   *Duplicate Items* view. For failures, say why and offer `add_item`. Offer `select_in_zotero` for the first item.

## save — web pages with a snapshot

`/zotero save <URL | page name found in this conversation> [to <collection>] [#tag …]`

For anything that is a web page rather than a paper with an identifier: conference sites, registration
and call-for-papers pages, news, blog posts, documentation, datasheets, product pages.

1. Find the URL (from the conversation, or search the web for the official page; prefer the organiser's
   own site over aggregators).
2. `save_webpage` with the collection (rules as for push; the user's CLAUDE.md may route some kinds of pages,
   e.g. conference information, to a specific collection). Zotero runs its site translators, so a journal or
   news page becomes a properly described item, and stores a full HTML snapshot that is full-text indexed.
   Saving the same URL again adds a new dated snapshot to the existing item, which is how to keep
   a page's history (e.g. re-save a registration page once fees are published).
3. Report: title, item type and how it was saved (`method`), key, snapshot key and indexed size,
   collection. If the snapshot has very little text (a login wall, a page that needs JavaScript or a
   cookie banner), say so. Offer a short `add_note` with the key facts from the page (dates, fees,
   deadlines) when that is what the user cares about.

## sort — organise the library

`/zotero sort [goal]`, e.g. `/zotero sort`, `/zotero sort by research topic`,
`/zotero sort for a review on chiplet thermal management`, `/zotero sort unfiled`.

1. **Survey**: `library_overview` (types, unfiled count, items without PDF, duplicate sets, collection tree,
   top tags). For the items in scope, page through `search_items` (with `unfiled: true`, a collection, or a
   topic query; use `offset`) and read titles/abstracts with `get_item` where titles are not enough.
2. **Design** a scheme that fits the goal:
   - *General tidy-up*: keep the user's existing collections, add a small number of topic collections
     (2 levels deep at most, 5–9 per level), place unfiled items, and suggest consistent tags
     (e.g. `type:review`, `method:…`, `status:to-read`).
   - *Goal-driven* (review, thesis chapter, proposal): search the WHOLE library for the topic with several
     queries (synonyms, abbreviations, `mode: "everything"` for full text), then build one collection such
     as `Review: <topic>` with subcollections per theme. Items are *added* there, not moved, so existing
     organisation is untouched.
3. **Show the plan** before changing anything: a tree with item counts, sample titles per node, items that
   would be moved or removed from a collection, and items you could not place. Ask for confirmation.
4. **Apply** with `create_collection`, `add_to_collection`, `update_item` (tags) and, only for agreed moves,
   `remove_from_collection`. Work in batches and report progress.
5. **Finish** with a summary, the duplicate sets (`find_duplicates`) for the user to merge, and the items
   still without a PDF (offer `find_pdf`).

## read — local knowledge base

`/zotero read <keys | "selected" | collection | search query> [into <folder>]`

1. Resolve the items: "selected"/"this" → `get_selected_items`; a collection name → that collection;
   otherwise a search (show matches and confirm if more than ~20).
2. `export_markdown` to the folder the user gave, else `<current project>/zotero-kb/` (absolute path).
   Each item becomes one `.md` file with front matter, abstract, notes, PDF annotations and full text;
   web snapshots are included as text and screenshots/figures are copied to `assets/`.
3. Read `index.md`, then Read/Grep the files as needed; view images in `assets/` with Read.
4. Tell the user where the knowledge base is, and that later questions can be answered from it
   (re-run `read` to refresh it after changes in Zotero).

## review — literature review from the library

`/zotero review <topic> [length/format/focus]`

1. Search the whole library with several queries (`mode: "everything"`), plus `/zotero sort`-style
   collection building if the user wants it filed. Show the shortlist (key, year, title) and ask only if it
   is clearly too broad or too thin.
2. `export_markdown` the shortlist into `<project>/zotero-kb/<topic-slug>/`, then read abstracts for all
   and full text for the core papers.
3. Build an evidence table (paper · problem · method · data/setup · key result · limitation) and save it as
   `review-matrix.md`.
4. Write the review (`review-<topic-slug>.md`): themes, comparison, open problems, gaps. Cite as
   `[@citationKey]` or (Author, Year) and only cite items from the library; mark claims that would need
   sources outside it.
5. `export_citations` with `format: "bibtex"` → `references.bib` next to the draft.
6. List gaps: important subtopics with few or no papers in the library, and offer to find and `push` papers.
7. Optionally save a short summary as a standalone note in the review collection with `add_note`.

## ask — answer from the library

`/zotero ask <question>`: search (titles first, then `mode: "everything"`), read the most relevant abstracts
and the needed passages with `get_fulltext` (use `offset`) or the local knowledge base if it exists, then
answer citing item keys and pages. Say clearly when the library does not cover something.

## cite — bibliography for a manuscript

`/zotero cite <file.tex|file.md | keys | collection> [bibtex|biblatex|ris|<CSL style e.g. ieee, nature, apa>]`
- For a manuscript: collect its citation keys (`\cite{…}`, `[@…]`) or reference titles, match them to library
  items (search by title, compare `citationKey` from `get_item`), write `references.bib` (or the requested
  format) next to the file, and list citations that are not in the library (offer to `push` them).
- For keys/collections: `export_citations` and print or save the result.

## Other helpers

- `check`: `library_overview` + `find_duplicates`; offer `find_pdf` for items missing PDFs and a `sort`
  for unfiled items.
- `note <item> <text>` / "save this summary to Zotero": `add_note` (Markdown) on the item, or as a
  standalone note in a collection.
- `attach <item> <files>`: `attach_file` with absolute paths (inside the home folder). `mode: "import"`
  (default) stores a copy in Zotero, `"link"` links the file in place. Files already attached (same content)
  are reported as `existing`. Split very large batches over several calls.
- `open <item>`: `select_in_zotero`.
- `snapshot <item> [url]`: `save_webpage` with `parent_key` to attach a fresh snapshot to an existing item.
- `recent`: `recent_items`.
- `annotations <item>`: `get_annotations`, grouped by colour/page.
