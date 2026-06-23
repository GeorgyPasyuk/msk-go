# CTO Architecture Review — msk-go

## Current architecture

```
┌─────────────────────────────┐
│     Data Sources            │
│  KudaGo (API, no key)       │
│  Timepad (API, bearer)      │
│  Telegram (t.me/s/ scrape)  │
│  Curated (manual JSON)      │
└──────────┬──────────────────┘
           │
┌──────────▼──────────────────┐
│    fetch_telegram.py         │
│    → LLM-extract (OpenRouter)│
│    → tg_cache.json           │
│    → telegram.json           │
└──────────┬──────────────────┘
           │
┌──────────▼──────────────────┐
│    fetch_events.py           │
│    → KudaGo pagination       │
│    → Timepad pagination      │
│    → Geocoding (Nominatim)   │
│    → Cross-source dedup      │
│    → Merge curated+telegram  │
│    → events.json             │
└──────────┬──────────────────┘
           │
┌──────────▼──────────────────┐
│    Front-end                 │
│    index.html + assets/      │
│    → Vanilla JS (no deps)    │
│    → Яндекс.Карты            │
│    → Freshness indicator     │
└─────────────────────────────┘
```

## State transitions

| State | Trigger | Output |
|-------|---------|--------|
| Pipeline run | Cron (GA + VPS) | events.json + telegram.json |
| Data fresh | generated_at < 24h | Green dot in hero |
| Data aging | 24h < generated_at < 48h | Yellow dot |
| Data stale | generated_at > 48h | Red dot + banner shown |
| Source down | Network error in fetch | Graceful: writes curated-only |

## Recent changes

- **GST-7** (HEAD): always-visible freshness indicator in hero (color-coded dot + human-readable age). Replaced stale-banner-only approach.
- **Data dedup** (GEO-94): cross-source dedup with coordinate-based cluster splitting.
- **Pipeline VPS** (GEO-97/99): Docker + compose + cron on VPS, parallel to GitHub Actions.

## Data quality issues found & fixed

| Issue | Severity | Fix |
|-------|----------|-----|
| Kids events (плавание для детей) leaking through as `recreation` | High | Added title-based kids filter in `kudago_base()` |
| Timepad yoga duplicates (Йога день / Йога день от Сенсилис) | Medium | Cross-title dedup by (lat, lon, day) and (address, day) |
| Past events containing exhibition/filarmonia | Low | Data stale; cleared on next pipeline run |
| Many Timepad events empty `description` + `price` | Low | Acceptable — fields backfilled from duplicates |

## Code quality

### Python pipeline (`fetch_events.py`, `fetch_telegram.py`)
- Standard library only ✓
- Graceful degradation on network errors ✓
- Cross-source dedup with geo-clustering ✓
- LLM extraction with cache + retry across models ✓
- **Missing:** function-level error isolation (geocode/LLM errors don't cascade)

### Frontend (`assets/app.js`)
- Vanilla JS, no framework ✓
- IntersectionObserver for reveal ✓
- Theme via `prefers-color-scheme` ✓
- Freshness indicator with 3 tiers + stale banner ✓
- **Missing:** error boundary for data load failures (catches at top level but doesn't retry)

### CI/CD
- Basic syntax + JSON validation ✓
- Python unit tests added (this review) ✓
- Browser QA (Puppeteer) available but optional ✓
- **Missing:** no PR preview environment, no visual regression

## Edge cases

### Known and handled
1. **KudaGo down** → writes curated-only, stale banner shown
2. **Telegram unreachable** → previous telegram.json reused (not overwritten)
3. **Empty address** → geocoding skipped, event shown without map pin
4. **Recurring events** → Timepad dedup by truncated title hash
5. **Negative/endless timestamps** → sentinel handling in KudaGo dates

### Known and NOT handled (risk register)
1. **Clock skew between GA and VPS** → VPS runs on Moscow TZ, GA on UTC. `generated_at` may differ → freshness indicator may show wrong age if data source switches.
2. **events.json truncated write** → if pipeline crashes mid-write, old file is lost. Should write to `.tmp` + atomic rename.
3. **Nominatim rate limit (3600/hr)** → currently 1 req/sec, no retry on 429. Silent data loss on geo.
4. **telegram.json growth** → posts pile up; cache trimmed to 1000 entries but telegram.json itself grows unbounded.
5. **LLM cost blowup** → if all 4 OpenRouter models fail, retries 4× per post with 45s timeout each.

## Implementation plan

### Phase 1 (immediate, assigned to Implementer)
| Item | Effort | AC |
|------|--------|----|
| Atomic events.json write (tmp + rename) | 1h | File write uses `.tmp` then `os.rename` |
| Python unit tests from `CTO_REVIEW` | 2h | `python -m unittest discover -s tests -v` passes |
| Kids title filter + cross-title dedup | 1h | No kids-content events pass filter; same-day same-loc dupes deduped |
| Browser QA script as `tests/qa_freshness.js` | 2h | Tests fresh/aging/stale/unknown states in headless Chrome |

### Phase 2 (next sprint)
| Item | Effort | AC |
|------|--------|----|
| Telegram JSON trim (keep last N posts) | 2h | `telegram.json` capped at 500 posts |
| Nominatim 429 retry with backoff | 2h | Retries 3× with exponential backoff on 429 |
| data-source freshness info in events.json | 2h | Per-source `last_ok` timestamp visible in debug |

### Phase 3 (backlog)
| Item | Effort | AC |
|------|--------|----|
| PR preview via GitHub Pages deploy from branch | 4h | PR URL `https://georgypasyuk.github.io/msk-go/pr/<number>/` |
| Pipeline health dashboard | 8h | `/health` endpoint from VPS showing last pipeline run, errors, event count |
| Dependency lock with reproducible build | 4h | Python scripts via pip freeze + requirements.txt |

## Rollback plan

If any change causes issues:
1. `git revert <sha>` and push
2. For pipeline: `docker compose up --force-recreate` on VPS rebuilds from image
3. For frontend: Pages deploy fast-forwards; previous commit restores old UI
