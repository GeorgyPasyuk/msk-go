# GST-9: Пустые выходные выглядят как поломка

## Product Direction

**The problem**: When a weekend has no events, its section is simply absent.
The calendar visually jumps from one weekend to another with no explanation for the gap.
This reads as a broken page, not an intentional UI — users lose trust.

**The insight**: The site's entire promise is "куда сходить на выходных" — every weekend
matters. Skipping a weekend in the UI says "мы забыли про эти выходные", not
"на эти выходные ничего не нашлось".

**The fix**: Every weekend from now through a visible horizon always shows up — with
or without events. The UI never jumps or disappears. Empty weekends feel like a
pause, not a crash. Same voice as the rest of the site: direct, honest, helpful.

---

## Issues

### GST-9a — Continuous weekend rendering + empty state

**Assignee**: CTO (locked technical plan → Implementer)

**Description**:
Render every weekend from the current one through a rolling horizon (8 weeks /
last-event + 1), filling gaps with a friendly placeholder. The empty state must
look intentional, not like an error.

**Acceptance Criteria**:
1. All weekends from the current weekend through +8 weeks (or 1 week past the
   last event, whichever is later) appear as `<section class="weekend">` elements
2. Weekends with events render cards as before (no regression)
3. Weekends without events render a placeholder: weekend header + message
   "В эти выходные ничего не нашлось" + suggestion to check other weekends
   or visit the "Где искать" links
4. Pre-first-event gaps are filled (current weekend → first event weekend)
5. Post-last-event gaps are filled (last event weekend → horizon)
6. If zero events exist at all (groups.length === 0), show the existing generic
   message — never 8 empty weekends
7. Past mode is unchanged

### GST-9b — Smarter filter-empty message

**Assignee**: CTO (locked technical plan → Implementer)

**Description**:
When filters yield no results, differentiate between "no filters active, no data"
and "filters too narrow" — and provide a better next action.

**Acceptance Criteria**:
1. If filters are active and yield zero results: "Ничего не нашлось по этим
   категориям. Сними фильтры, чтобы увидеть всё."
2. If no filters are active and there's genuinely no data: "Пока ничего не
   нашлось. Загляни позже — события появляются каждый день."
3. Past mode keeps its existing message (improve if needed)
