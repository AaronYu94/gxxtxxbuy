# Wiki schema — how to maintain this knowledge base

This project keeps an **LLM-maintained wiki** in `.nodi-wiki/`. You (the AI agent) own
and write every file here; the human curates sources and asks questions. Knowledge is
**compiled once and kept current**, never re-derived from scratch on each question.
Follow these conventions every session.

## Layout
- `index.md`  — the catalog. Every page listed under a category with a one-line summary.
                Read this FIRST when answering a question; update it on every ingest.
- `log.md`    — append-only timeline. One line per operation:
                `## [YYYY-MM-DD] kind | title`  (kind = ingest | query | lint).
                Never edit past entries.
- `pages/`    — the wiki pages (entities, concepts, summaries, syntheses).
- `raw/`      — immutable source material the human dropped in. Read, never modify.
- `SCHEMA.md` — this file. Co-evolve it as conventions settle.

## Page format
- First line is an H1 title: `# Page Title`.
- Optional YAML frontmatter (tags, date, sources) at the very top.
- Link related pages with `[[Page Title]]` (or `[[pages/slug]]`). Cross-reference
  generously — the links are the value. Nodi renders these as a graph on the canvas.

## Sources (what to ingest)
Two feeds:
1. Files the human drops into `raw/`.
2. **Nodi memory** — this project's captured agent sessions, decisions, and clipped web
   articles. Nodi lists the un-ingested backlog via the `nodi_wiki_sources` MCP tool and
   the Workspace "pending sources" rail. Treat each as a source to fold in.

## Operations

### Ingest (a new source → the wiki)
1. Read the source fully.
2. Discuss the key takeaways with the human (unless batch-ingesting).
3. Write or update a summary page under `pages/`.
4. Update every related entity/concept page — a single source often touches 10–15 pages.
5. Update `index.md` (add/refresh the page's catalog line).
6. Append one line to `log.md`: `## [date] ingest | <source title>`. Use the source's
   title verbatim so Nodi can mark it ingested.

### Query (a question → an answer)
1. Read `index.md`, then drill into the relevant pages.
2. Answer with citations to the pages you used.
3. If the answer is itself worth keeping (a comparison, a synthesis, a discovered
   connection), FILE IT BACK as a new page under `pages/` and add it to `index.md` —
   don't let it vanish into chat. Append `## [date] query | <question>` to `log.md`.

### Lint (health-check)
Periodically scan for: contradictions between pages, stale claims newer sources
superseded, orphan pages with no inbound links, important concepts mentioned but lacking
their own page, missing cross-references. Fix what you can; surface the rest. Append
`## [date] lint | <summary>` to `log.md`.

## Rules
- You write the wiki; the human reads it. Never ask the human to write pages.
- `raw/` is immutable. `index.md` and `log.md` are load-bearing — keep them current.
- The wiki is a git repo of markdown — make small, frequent, descriptive changes.
