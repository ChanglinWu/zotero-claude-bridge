---
name: zotero
description: Use the user's Zotero library as Claude's reference library. Subcommands - push (save papers found in this conversation to Zotero by title or short name), sort (organise the library into collections, or build a topic collection for a goal such as a literature review), read (pull Zotero items, PDFs, notes, web snapshots and screenshots into a local Markdown knowledge base), review (write a literature review from the library), ask (answer a question from the library with citations), cite (BibTeX/bibliography for a manuscript), check (library health). Use whenever the user types /zotero or @zotero, or says things like "push this paper to Zotero", "add these to Zotero", "save to my library", "organise my Zotero", "what does my library say about", "整理我的 Zotero", "推送到 Zotero", "存到文献库", "从 Zotero 里找", "写文献综述".
argument-hint: "push|sort|read|review|ask|cite|check [what]"
---

# Zotero

The user's Zotero library is reached through the **Zotero MCP tools** (server `zotero`; tool names end in
`search_items`, `get_item`, `get_fulltext`, `get_annotations`, `list_collections`, `get_collection_items`,
`recent_items`, `get_selected_items`, `library_overview`, `find_duplicates`, `export_citations`,
`export_markdown`, `add_by_identifier`, `add_item`, `update_item`, `add_note`, `create_collection`,
`add_to_collection`, `remove_from_collection`, `find_pdf`, `select_in_zotero`). The tools run inside the
user's own Zotero app, so there are no API keys, and they never delete anything.

Request: `$ARGUMENTS`

Read the first word of the request as the subcommand. If there is none, infer it from the request
(a paper title → push; a question → ask). With no request at all, briefly list the subcommands.

## If the Zotero tools are missing or fail to connect

Zotero must be running with the **Claude Bridge for Zotero** plugin. Check with
`curl -s http://127.0.0.1:23119/claude-bridge/info`:
- connection refused → ask the user to start Zotero;
- `No endpoint found` → the plugin is not installed: point them to
  https://github.com/ChanglinWu/zotero-claude-bridge/releases (Zotero → Tools → Plugins → drag in the .xpi);
- info works but no tools here → the MCP server is not connected to this session; it is bundled with this
  plugin, so a new session (or `/mcp` reconnect) fixes it.

## General rules

- Item keys are 8-character IDs such as `3PEADCUU`; always show them so the user can refer back.
- Collections can be given by key, name or path (`Projects/Thesis/Ch2`). Write tools create missing ones.
- Prefer `add_by_identifier` (DOI, arXiv, ISBN, PMID) over `add_item`: Zotero then fetches the real metadata
  and an open-access PDF itself. Never invent identifiers or metadata.
- Show results as a compact table, not raw JSON. End with what changed in Zotero.
- Large reads go to disk: use `export_markdown` and then Read/Grep the files, rather than pulling many full
  texts into the conversation with `get_fulltext`.
- Reorganising (moving items, removing them from collections, bulk tagging) needs the user's OK on a
  shown plan first. Adding papers they asked for and creating new collections do not.
- Duplicates are reported, never merged: merging is done by the user in Zotero's "Duplicate Items" view.

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
     If two candidates are plausible, ask. If none is found, use web search, and as a last resort
     `add_item` with only the metadata you actually have (plus `url`).
3. **Add** with one `add_by_identifier` call for all identifiers:
   - collection: the one the user named; otherwise the collection named in the user's Zotero preference
     (CLAUDE.md or memory) if any; otherwise `Claude Inbox`.
   - tags: the user's tags, if any.
4. **Report** a table: title · status (added / already in library / failed) · key · PDF found? ·
   collection. If a result lists `possibleDuplicates`, say so and suggest merging them in Zotero's
   *Duplicate Items* view. For failures, say why and offer `add_item`. Offer `select_in_zotero` for the first item.

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
- `open <item>`: `select_in_zotero`.
- `recent`: `recent_items`.
- `annotations <item>`: `get_annotations`, grouped by colour/page.
