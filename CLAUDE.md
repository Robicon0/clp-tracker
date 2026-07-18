# CLP Tracker — Operating Rules

## Project Identity

CLP Tracker is a standalone tool currently in development. It will
eventually be integrated into DefiDesh (https://defidesh.com), a
multi-chain DeFi LP position tracker. CLP Tracker is being built
separately to allow experimentation without affecting DefiDesh
production stability.

The founder Osho is a non-coder solo founder. All code is executed
via Claude Code in VS Code. Planning, prompt construction, and
roadmap management happen separately in Claude.ai.

## North Star

Build a tool that LP users worldwide can trust completely. Every
number displayed must be correct, every metric must be auditable,
and the platform must work for any user with any wallet on any
supported chain — not just the founder's test wallets.

## Operating Methodology

### A. Investigation-First

Every sprint starts with a read-only Phase A diagnostic before any
code is written. Measure the actual state, identify root cause
precisely with on-chain evidence, then propose a fix architecture.
Never assume — measure.

### B. Plan Gate Stops

After Phase A, stop and present the proposed fix to Osho with a
structured radio-button dialog (REPLACE approval, scope choice,
etc.). Do NOT implement until Osho explicitly approves. Any change
that shifts displayed values for users requires explicit gate
approval. Investigation-only sprints close without code changes.

### C. Platform-Wide Framing

Every bug is a platform bug. Never frame fixes around Osho's
specific wallets or test data. The fix benefits every user
worldwide with similar position shapes, not just the founder.
Frame impact as: "X% of users with Y position shapes on Z chain
see wrong values" — not "my wallet shows wrong."

### D. Explain Before Building

Never just build. Before writing any code, explain in simple terms
what's being fixed, why, and what the user-visible impact will be.
Osho must understand what's happening before code runs.

### E. Step By Step, No Skipping

One sprint at a time per the active queue in this CLAUDE.md. If
new issues surface mid-sprint, add to the queue, don't pivot.
Honor scope discipline rigorously.

### F. Auto Commit and Push When Verified

Once a sprint passes its critical checks cleanly with build + tsc
passing, commit and push to GitHub automatically without asking
permission. Verified work gets shipped immediately.

### G. Update CLAUDE.md Every Session

At the end of each session, update this file to reflect what
shipped (commit hashes, completed phases, new integrations,
invariants established).

### H. Worldwide-User Mindset

Any fix or feature must work correctly for any user worldwide
connecting any wallet (EVM, Solana, Sui) on any chain. Build for
scale — thousands of users from different countries with different
wallets and positions. Never use hardcoded values that only work
for Osho's wallets. Test wallets are verification ground truth
only, never the definition of correctness.

## Correctness Invariants

Marked [ACTIVE] = applies to CLP Tracker today. Marked
[ASPIRATIONAL] = applies once CLP Tracker grows to include
wallet connection, live price feeds, and on-chain reads.

1. [ASPIRATIONAL] **CLMM Fee-Growth U128 Underflow Guard** — When
   `(feeGrowthInside - checkpoint)` wraps to upper half of u128,
   treat per-tick delta as 0. Applies to every Uniswap V3-style
   AMM. Activates when CLP Tracker reads on-chain fee growth.

2. [ASPIRATIONAL] **Claim-Time Historical Pricing (Rule 1a)** —
   Fee USD valuation must use claim-date historical price, never
   current spot. Cascade: hardcoded stablecoin anchor ($1) →
   CoinGecko historical → DeFiLlama historical → pending. Never
   current spot as fallback for fee claims. Activates when
   CLP Tracker auto-fetches token prices instead of manual entry.

3. [ASPIRATIONAL] **Persistent Price Cache** — Use Redis or
   equivalent to cache historical prices keyed by (token, date).
   Fire-and-forget writes acceptable; no-op stub if env vars
   missing. Activates with invariant 2.

4. [ACTIVE] **All Positions Visible** — Show every position
   regardless of status: in range, out of range, closed. Sort
   order: In Range → Out of Range → Closed (dimmed). Never filter
   zero-liquidity positions.

5. [ASPIRATIONAL] **Closed Position Retrieval Per Chain** — EVM
   preserves position NFTs after close (retrievable). Sui and
   Solana destroy position objects on close (require transaction
   history scan via archive RPC or indexer). Check each new
   chain's capability. Activates with on-chain integration.

6. [ACTIVE] **All UI Surfaces Consistent** — Dashboard, analytics,
   LP P&L, position detail, docs, about pages must all show
   consistent data. Same protocol's value in two places must
   agree. Same formula in two pages must produce same number.

7. [ASPIRATIONAL] **Wallet Security** — Per-chain disconnected
   flags (localStorage). Wallets only connect when actively
   unlocked by user. Locked wallets must never auto-connect.
   Activates when CLP Tracker adds wallet connection.

8. [ACTIVE] **Defensive Plausibility Checks** — Boundary checks at
   every route. Never reintroduce a previously fixed bug.

9. [ACTIVE] **Deposited USD Is Derived, Not Typed** — Deposited USD
   is a derived value, not a user input. Computed as (Base Token
   Count × Entry Price) + Quote Token Count. All calculations
   reading position.deposited must go through the
   getEffectiveDeposited helper in lib/calculations.ts so existing
   legacy positions display corrected values (stored value is a
   fallback cache for records with missing token counts, rewritten
   on every Add/Edit save). IL projections use token amounts as
   primary liquidity source. All IL math flows through
   computePositionIL — never duplicate the wrapper per page. Stored
   outOfRangeUpside/Downside are stale-able snapshots; readers must
   prefer live recomputation.

10. [ACTIVE] **Claim → Position Fees Sync** — position.claimed is a
    derived value, not a user input. All display surfaces read via
    getEffectiveClaimed(position, allClaims) which sums stableAmount
    from ALL claims linked to that position (regardless of
    conversion status — stableAmount means USD value of claim, not
    amount cashed out). Stored position.claimed is legacy fallback
    only for positions with no valued claims logged.
    UpdatePositionModal shows Claimed as read-only display; editing
    is only possible by adding/editing/deleting claim records. The
    convertedToStable boolean is purely informational (tracks
    whether user cashed out to stable). One metric intentionally
    stays conversion-gated: Total P&L per-token "stable contributed"
    tracks actual cash-outs and differs from claim USD value. Legacy
    claims saved without a USD value hold null and contribute $0
    until Sprint 8 claim-time historical pricing. newFees (unclaimed
    accrued fees) stays manual. Claim persistence goes through
    persistNewClaim/persistUpdatedClaim in
    components/ClaimFormModal.tsx — never duplicate per page. The
    Close flow creates its claim BEFORE closing the position (safer
    failure ordering).

## Master Formulas (Ground Truth from Google Sheet)

Sheet source: 1fR61R3ZBGLFk8cEWlNC589WsmVZcsu3ZWogdVXnhBR4
(True Defi CLP Positions, Business P&L, Pool P&L 0, All LP
Ranges, Transfers — first five sheets only)

- **Fee APR** = (Total Fees / Deposited) / Days × 365 × 100
- **Fee ROI** = Total Fees / Deposited × 100
- **ADF** = Total Fees / Days
- **Daily APR** = Fee APR / 365
- **Monthly APR** = Fee APR / 12
- **Yearly APR** = Fee APR
- **Wide Range %** = (Range Up − Range Down) / Range Down × 100
- **Profit (Active position)** = Price Diff + Total Fees
- **Profit (Closed position)** = Scalp + Total Fees
- **Total Fees** = Claimed + New Fees
- **Combined LP+Short exposure** = LP Deposited + Short USD Amount
- **Days Active** = (Exit Date if closed, else Today) − Entry Date

## Money Flow Accounting Invariants

- Business P&L Net Total = Σ all LP profit + fee income
- Transfers Net Total = Σ all money moved out to destinations
- Withdrawals Total = Σ money taken out for personal/other use
- **Invariant**: Business P&L Net Total ≈ Transfers Net Total +
  Money Still In Business (small float drift acceptable)
- **Invariant**: Lifetime Earned never decreases. Withdrawals
  reduce Available Balance only.

## Prompt Standards for Claude Code Sessions

Every prompt should be:

- Specific and direct: describe the exact problem, exact expected
  outcome, exact values to verify, all edge cases.
- Always end with: "Build, test on localhost:3001, confirm
  visually that it works, then push to GitHub. Do not mark it
  done until the output is verified."
- Never ask permission to commit and push — when work is verified
  and build is clean, always commit and push automatically.
- Always update this CLAUDE.md at the end of each session.

## Communication Preferences

Osho prefers:

- Concise and direct answers, no over-explaining
- Step-by-step methodology, no skipping
- Clear explanations free of unnecessary jargon (English is
  Osho's second language)
- Honest framing of what's complete vs incomplete

## Sprint Queue (Defined — Methodology Sprints)

These are the sprints planned based on the Google Sheet ground
truth mapping. Order is recommendation only — Osho approves each
at the plan gate.

- Sprint 1: Fee Claims APR Display
- Sprint 2: Bring Back Scalp Field
- Sprint 3: Wide Range % Auto-Calculation
- Sprint 4: Combined LP + Short Exposure Display
- Sprint 5: Full Metric Suite + Three-Way APR View
  (Active / Closed / Combined) — Adds Fee ROI, ADF, Daily/
  Monthly/Yearly APR display where missing. Adds three-way
  APR breakdown on Dashboard and Fee Claims page: Active APR
  (open positions only, deposit-weighted), Closed APR (closed
  positions only, deposit-weighted), Combined APR (all
  positions ever, deposit-weighted). Approved by Osho during
  Sprint 2 plan gate.
- Sprint 7: Business P&L Page (new)
- Sprint 8: Unconverted Token Holdings + Current Value
- Sprint 9: Extended Transfers Page
- Sprint 10: Withdrawals Page (new)
- Sprint 11: Predictive Out-of-Range Display

## Recent Shipped Sprints

- Sprint 0 (bootstrap): CLAUDE.md added to repo root [dcb33d0]
- Sprint 1: Fee APR display on Fee Claims page [8ca1f93]
- Sprint 2: Restore Scalp field with closed-position profit
  branching [e310118]
- Sprint 3: calcIL formula fixes (token-count liquidity +
  entry-outside-range branch), Wide Range % display, auto-suggest
  Deposited + drift warning, IL wrapper centralized [3f82052]
- Sprint 3.1: LP Range layout regression fix, drift warning
  threshold lowered to 1% [4530222]
- Sprint 3.1 Part 4: Deposited USD → display-only auto-calculated
  field, moved to LP Range section, existing positions
  auto-corrected on read via getEffectiveDeposited helper [7a8d50c]
- Sprint 3.2 (investigation-only): claims/positions two-books
  diagnosis — closed without code changes
- Sprint 4: Position-Centric Claim UX + auto-sync (all 8 parts)
  [97bf67f]
- Sprint 5: Claim USD value always captured (converted or not),
  Close modal integrates optional fees-at-close section [3fd0805]
- Pre-Sprint 6 patch [ca378e7]: Edit button added to closed
  positions; info text added to Dashboard Total Profit and
  Total P&L LP P&L cards.
- Health-check remediation (post-diagnostic, pre-Sprint 6):
  Dashboard Sidebar now reads getEffectiveDeposited/
  getEffectiveTotalFees instead of raw position.deposited/
  claimed (was violating Invariant #9/#10 — sidebar could show a
  different net P&L than every other page for legacy positions).
  Settings CSV positions export now writes effective Deposited/
  Claimed/Total Fees instead of raw stored fields, so exported
  numbers match on-screen numbers. Extracted the mount-hydration
  boilerplate (useState+useEffect+setHydrated duplicated across
  7 pages + Sidebar) into lib/useHydrated.ts, clearing 8 of 9
  react-hooks/set-state-in-effect lint errors. Fixed 3
  react-hooks/exhaustive-deps warnings in the position form by
  changing formDeposited/tryComputeIL to take primitive fields
  instead of the whole form object. Deleted CLP_TRACKER_HANDOFF.md
  (untracked, predated the sprint system, cited a conflicting
  Google Sheet ID). tsc/build/lint all clean; Sidebar + CSV export
  fixes verified live in-browser with a seeded position/claim pair
  whose stored vs. derived values deliberately diverged.
- Live-site formula verification session (2026-07-17, no code
  changes): exercised Add Position, Claim, and Close-with-fees
  flows end-to-end on production (clp-tracker-two.vercel.app)
  with temporary seed entries, verified every displayed metric
  against hand calculations — Deposited derivation, Wide Range %,
  Fee APR (active + closed), active profit (price diff + fees),
  closed profit (scalp + fees), IL/out-of-range projections
  (exact CLMM math), claim → position sync on both seed and real
  positions, and cross-page consistency of fees/LP P&L/Net P&L
  across Dashboard, Claims, Pool P&L, Total P&L, and Sidebar.
  Zero console errors. Seed entries removed afterward; user data
  untouched. Sprint 6 Phase A deferred by Osho at the gate.
- Sprint 6: Realized + Unrealized P&L per Token (Pool P&L
  rebuild). Phase A read Pool P&L 0 in the Google Sheet directly
  (per-token books: pairs block with withdraw − initial principal
  P&L excluding fees, short block, per-token net summary). Gate
  approved by Osho. Shipped: calcTokenPnL helper in
  lib/calculations.ts groups positions by base token
  (token1Symbol) — Unrealized = active (current − effective
  deposited), Realized = closed (final − effective deposited),
  Short P&L = Σ shortTotal, Net = realized + unrealized + short;
  fee income shown as separate info column, excluded from Net
  (mirrors the sheet). New "By Token" table on Pool P&L page
  above By Position with totals row. Verified on localhost
  against a mirror of Osho's live data — every cell matched hand
  calculations; token totals agree with the summary cards
  (Invariant #6).

- Out of Range Projection Accuracy fix (Phase B) [44aa138]:
  Fixed Out of Range projection accuracy bug — liquidity (L) now
  derived from both token amounts (quadratic method) when position
  is two-sided and in-range, eliminating entry-price-drift
  amplification. Single-sided and out-of-range cases unchanged.
  In lib/calculations.ts calcIL, the L-derivation now has three
  cases: Case 1 (both token counts > 0 AND entry inside range)
  solves A·L² − B·L − C = 0 with A = 1 − √rangeDown/√rangeUp,
  B = amount0·√rangeDown + amount1/√rangeUp, C = amount0·amount1,
  positive root only; Case 2 (single-sided or entry outside range)
  keeps the Sprint 3 quote-first / base-second logic; Case 3
  (legacy, no token counts) keeps the inv/vpL fallback. Verified
  live: ZEC/USDC (entry 462.9, range 420–503.35, ZEC 4.2725565,
  USDC 2188.56) now shows OOR Upside $4,248.90 (was $4,160.97);
  single-sided cases numerically unchanged. computePositionIL
  output shape unchanged — Add/Edit modal, Net Coverage, Pool P&L
  OOR columns unaffected. tsc/build clean.

## Known Issues

- Exit-before-entry dates accepted: the position form does not
  warn when exit datetime is earlier than entry datetime. The app
  clamps Days Active to 0 (so APR shows 0% instead of breaking),
  but the bad dates persist silently. Seen on a real closed
  SOL/USDC position (entry 2026-07-11, exit 2026-07-04).
  Candidate fix: plausibility warning in Add/Edit/Close forms
  (Invariant #8). Any user worldwide who mistypes a date hits
  this.

## Architecture Notes

- Stack: Next.js 16, TypeScript strict, Tailwind v4, localStorage
  (current), Neon Postgres planned for later
- Deployed at https://clp-tracker-two.vercel.app
- GitHub: Robicon0/clp-tracker
- Git commits must be authored as Robicon0 (Vercel Hobby plan
  restriction). Local git config user.name = "Robicon0",
  user.email = Osho's verified GitHub email.

@AGENTS.md

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->