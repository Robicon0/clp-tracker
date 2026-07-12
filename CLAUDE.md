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

9. [ACTIVE] **IL Projections From Token Amounts** — IL projections
   must use stored token amounts as primary source, Deposited USD
   as secondary fallback only. Divergence between Deposited USD and
   TokenCount × EntryPrice indicates data entry error and must warn
   the user non-blockingly (>1% drift threshold). All IL math flows
   through computePositionIL in lib/calculations.ts — never
   duplicate the wrapper per page. Stored outOfRangeUpside/Downside
   are stale-able snapshots; readers must prefer live recomputation.

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
- Sprint 6: Realized + Unrealized P&L per Token (Pool P&L rebuild)
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

## Known Issues

[Empty — to be populated as issues are identified]

## Architecture Notes

- Stack: Next.js 16, TypeScript strict, Tailwind v4, localStorage
  (current), Neon Postgres planned for later
- Deployed at https://clp-tracker-two.vercel.app
- GitHub: Robicon0/clp-tracker
- Git commits must be authored as Robicon0 (Vercel Hobby plan
  restriction). Local git config user.name = "Robicon0",
  user.email = Osho's verified GitHub email.

@AGENTS.md
