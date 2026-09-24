# Installer content

`installer-content.json` holds everything the full-screen installer says that
isn't code: task labels, the walkthrough, tips, and announcements. Edit it,
run `bun run test src/tui/content`, and ship. It's bundled into the binary, so
changes go out with the next release.

## Tips and announcements

Both render in the "Tips & news" panel, which rotates through announcements
first and then tips.

```json
{
  "id": "branding",
  "title": "Make AuthKit look like your app",
  "body": "Set your logo and colors so the sign-in page feels like home.",
  "command": "workos branding set",
  "url": "https://workos.com/docs/authkit/branding",
  "frameworks": ["nextjs"]
}
```

- `id`: lowercase-kebab and unique across tips and announcements.
- `command` and `url` are optional. URLs must be `https`.
- `frameworks` is optional. Omit it to show the card for every framework.
  Otherwise it lists integration ids (keys of `frameworks` at the top of the
  file), and the card appears once that framework is detected.
- Announcements also take `startsAt` / `endsAt` (`2026-10-01` or a full ISO
  timestamp). Both are inclusive, so `"endsAt": "2026-10-31"` shows through
  the whole of October 31 (UTC).

## Walkthrough

`walkthrough` maps an installer event (see `src/lib/events.ts`) to the sentence
shown when it happens. Events that aren't listed aren't narrated.

Some events fill `{placeholders}`, for example `"branch:created": "I made a new
branch, {branch}."`. The allowed placeholders per event are in
`WALKTHROUGH_PARAMS` in `schema.ts`. Events with more than one outcome
(`complete`, `validation:complete`) take an object with one sentence per outcome
(see `WALKTHROUGH_VARIANTS`).

## Tasks

`tasks` sets the label for each step in the task list, plus an optional
`activeLabel` shown while that step runs. Which events move a task is code
(`src/tui/model/`), so the set of task ids is fixed.

The tests reject unknown events, placeholders, frameworks, duplicate ids, and
bad dates, with a message naming the exact field.
