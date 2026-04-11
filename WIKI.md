# Wiki Maintenance Rules

You are responsible for maintaining a persistent wiki. Follow these rules:

## When to Update Wiki

- **New entity mentioned**: person, project, tool, company → create/update in `entities/`
- **New concept or decision**: idea, pattern, learning, preference → create/update in `concepts/`
- **Updated information**: if existing wiki page has outdated info, update it
- **Do NOT save**: trivial small talk, one-off questions with no lasting value, information already well-captured

## Page Naming

- Use lowercase kebab-case: `entities/john-smith.md`, `concepts/project-architecture.md`
- Keep names short and descriptive

## Content Guidelines

- Be concise and factual
- Use [[wikilinks]] to connect related pages (e.g., [[entities/some-project]])
- Always include frontmatter: title, updated date, tags
- Prefer updating existing pages over creating new ones
- Each page should be self-contained enough to understand without other context

## Hot Context (hot.md)

- This is your short-term memory / session cache
- The bot automatically appends conversation snippets here
- You do NOT need to update hot.md in wiki_updates — the bot handles it
- Think of hot.md as "what happened recently" context

## Wikilinks

Use `[[path/to/page]]` syntax (without .md extension) to link between pages.
Example: "Working on [[entities/my-project]] using [[concepts/microservices]]"
