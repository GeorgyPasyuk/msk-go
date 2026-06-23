# GST-10: Пустые выходные выглядят как поломка — Product Refinement

## Context

GST-9a/b already implemented continuous weekend rendering with gap-filling and
differentiated filter/no-data messages. The code now renders every weekend from
now through an 8-week horizon and fills empty slots with a placeholder.

## Remaining problem

With real Moscow data (22 events total, ~5 summer-long), the 8-week horizon
produces 5–6 consecutive empty weekends after the first 1–2 busy ones. The page
becomes a wall of identical "В эти выходные ничего не нашлось" blocks —
which reads as a rendering bug, not intentional design.

The user's trust breaks in two moments:
1. **First weekend is sparse →** the user doubts the site is working at all
2. **Endless empty blocks →** the user doesn't know if they should scroll or leave

## Product direction

Empty weekends should look *intentional, human, and helpful* — never like an
error state or a Rendering Bug. The site should acknowledge emptiness warmly,
reassure the user that this is normal, and guide them to what still has value.

Three gaps to close:

### Gap A — Collapse consecutive empty weekends (highest impact)
6 identical empty blocks in a row is the main source of the "broken" feeling.
Collapse them into a single compact summary.

### Gap B — First-weekend-empty treatment
When the very first weekend (current weekend) has ≤1 event, special handling
so the user doesn't bounce.

### Gap C — Sparse horizon → bridge to summer/links
When the whole calendar is thin (<5 events across all weekends), bridge
visually to summer-long activities and links so the page feels full of options
even when the weekend calendar is quiet.

## Issues

See child issues on the board (GST-10a, GST-10b, GST-10c).

## Handoff

Lead issue GST-10 → CTO for technical execution plan + assignment to Implementer.
