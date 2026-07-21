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
   SCOPE RULE (2026-07-21): "current standing" totals scope to
   ACTIVE positions only — Dashboard Total Deposited (Active) and
   Current Value; Total P&L's Total Invested (Active), Total
   Current Value, Fees Earned (Active), Total Short P&L, LP P&L
   and Net P&L; and Sidebar Net P&L, which must always equal Total
   P&L's Net P&L. Capital in a closed position has been withdrawn
   and redeployed, so counting it again double-counts. Metrics
   that describe money EARNED still span all positions: Dashboard
   Total Fees Earned, Total Profit and Average Fee APR. Because
   the two scopes now coexist, a label may not be reused across
   scopes — Total P&L's fees card is deliberately "Fees Earned
   (Active)" rather than "Total Fees Earned", since the Dashboard
   card of that name spans everything and the two figures differ
   ($1,163.82 vs $1,428.22 in verification). Closed positions are
   never hidden: they keep their own column in Total P&L's
   Active/Closed breakdown, and Lifetime Total Deposited on both
   pages spans every position ever opened.

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

## Sprint Queue (all defined sprints shipped as of 2026-07-18)

## Sprint Queue History (Defined — Methodology Sprints)

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
- Sprint 11: Predictive Out-of-Range Display (SHIPPED — see below)

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

- Out of Range Projection Accuracy fix (Phase B) [79a2d1f]:
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

- Sprint 7: Business P&L page (2026-07-18). Phase A read the
  Business P&L sheet directly: five PAIRS blocks (ETH/BTC/SOL/
  SUI/HYPE) logging per-claim token + USDC rewards and claim-time
  USD value ("Usdc Coverted"), a Total Tokens summary (lifetime
  qty × manually-typed current price), All Total = SUM of current
  values, Usdc Converted = Σ block claim-time totals, P&L =
  Converted − All Total, plus hardcoded period checkpoints
  ("Accumulate the yield after 25/02/2026" = −1836, after
  25/05/2026 = −3108). Gate approved by Osho: full scope, manual
  price inputs, checkpoints derived from claim dates (not
  hardcoded). Shipped: calcBusinessPnL + calcYieldAfter in
  lib/calculations.ts (quantities summed per reward token from
  claim token1/token2 amounts; stables USDC/USDT/DAI default $1;
  unpriced tokens excluded from All Total and flagged);
  BusinessPnLSettings {prices, checkpoints} persisted under new
  clp_business_pnl key in lib/storage.ts (included in Settings
  JSON export/import); new /business-pnl page — 3 summary cards,
  Total Tokens table with editable price column, Yield
  Checkpoints (add/remove date, accumulated = Σ stableAmount of
  claims after date), claims ledger grouped by chain with block
  totals and Converted/"Still in X" status; Sidebar nav entry.
  Verified on localhost:3001 with seeded claims — every number
  matched hand calculations (All Total 750, Converted 770, P&L
  +20, checkpoint 570); persistence across reload confirmed;
  zero console errors; seeds removed. tsc/lint/build clean.
- Sprint 8: Unconverted Token Holdings + Current Value
  (2026-07-18). Phase A: every FeeClaim has convertedToStable;
  when false the reward tokens are still held ("Still in X" rows
  in the sheet). Business P&L's All Total sums ALL reward tokens
  (converted + unconverted) and never isolated the still-held,
  price-exposed subset. Gate approved by Osho: full scope (qty +
  current value + cost basis + P&L per token), placed as a
  section on the existing /business-pnl page reusing the same
  clp_business_pnl prices (no duplicate price entry). Shipped:
  calcUnconvertedHoldings in lib/calculations.ts — sums token
  amounts only from claims where convertedToStable === false;
  per-claim cost basis allocation attributes stablecoin sides at
  face value and the residual stableAmount to the volatile
  side(s) (multi-volatile claims split residual by current-price
  weight). Correctness guard: if ANY of a token's unconverted
  claims lacks a claim-time USD value (stableAmount null), that
  token's cost basis and P&L render "—" instead of a partial
  (inflated) figure, and an amber banner flags it — quantity and
  current value still show since those are known. "Unconverted
  Holdings" section on /business-pnl: 3 summary cards (Current
  Value, Cost Basis, Unrealized P&L) + per-token table with
  totals row. Verified on localhost with seeded converted +
  unconverted + null-basis claims: converted ETH excluded, ZEC
  250/270/-20, USDC flat, SOL with a null-basis claim correctly
  shows current $225 but basis/P&L "—" (not an inflated +$75),
  totals 625/420/-20, warning banner rendered; zero console
  errors; seeds removed. tsc/lint/build clean.
- Sprint 11: Predictive Out-of-Range Display (2026-07-18). Phase
  A: Position stores entryPrice/bottomRange/topRange but NO
  current price, and status (active/closed) is manual, not
  price-derived — so the app couldn't warn before a position
  drifts out of range. entryPrice and the range bounds share
  units (quote per base), so current pair price =
  usd(baseToken)/usd(quoteToken) via the Sprint 8.5 /api/prices
  route (stable quote → base price directly). Gate approved by
  Osho: auto-fetch + manual fallback, badge on each active row
  PLUS a Range Health summary, "Getting Close" threshold 5% of an
  edge. Shipped: calcRangeHealth in lib/calculations.ts (status
  safe/close/out/unknown, bandPosition, distance-to-lower/upper %,
  nearestEdgePct; "close" when within thresholdPct, default 5, of
  either edge; "out" when price ≤ down or ≥ up); per-position
  manual price overrides in clp_position_prices
  (get/savePositionPrices, in Settings backup keys). Positions
  page: on hydrate fetches USD prices for all active-position
  base+quote symbols, currentPriceById = manual override else
  fetched base/quote ratio (null when unresolved), healthById via
  calcRangeHealth; new "Range Health" summary card (Out/Close/
  In-Range/Price-Needed counts + a needs-attention list sorted by
  nearestEdgePct, Refresh button + last-updated), a "Range Health"
  column in the Active Positions table showing a colored badge +
  "X% to edge" (or a current-price input when unresolved).
  Reuses Sprint 8.5 infra; ships CURRENT-price warnings, not
  historical. Verified live on localhost:3001 with seeded active
  positions and real CoinGecko prices: ZEC/USDC (range 400–500,
  live ~542) → Out of Range "above range"; SOL/USDC (50–100, ~75)
  → In Range 33.2% to edge; ETH/USDC (1800–1940, ~1844) → Getting
  Close 2.4% to edge; FOOBAR/USDC (unresolved) → price input, and
  typing 15 (range 10–20) flipped it to In Range 33.3% and updated
  the summary counts; zero console errors; seeds removed.
  tsc/lint/build clean.
- Sprint 10: Withdrawals + Available Balance on Transfers page
  (2026-07-18). Phase A: no Withdrawals sheet exists — Osho
  clarified their real model lives IN the Transfers sheet: per
  token, NET TOTAL (SUM incl. the pink period-subtotal row) =
  lifetime earned (never decreases), TOTAL (SUM of fresh rows
  only) = what's available now, and the pink subtotal rows =
  money "used"/taken out; difference = withdrawn. Confirmed model
  with Osho then gate-approved: Lifetime Earned − Withdrawn =
  Available Balance, fields date/amount/method/notes, placed on
  the Transfers page (not a separate page). Shipped: Withdrawal
  type (lib/types.ts) + clp_withdrawals storage (get/save,
  included in Settings JSON backup keys); Transfers page — three
  balance cards (Lifetime Earned = Σ transfers / Withdrawn = Σ
  withdrawals / Available = difference), "Record Withdrawal"
  button + WithdrawalFormModal (date/amount/method/notes), a
  Withdrawals table with Total Withdrawn footer and edit/delete
  (separate pendingWithdrawalDelete confirm state). Withdrawals
  never reduce Lifetime Earned — only Available (Money Flow
  invariant #2). Verified on localhost:3001: transfers
  100/50/200 → Lifetime Earned 350; a 120 withdrawal → Withdrawn
  120, Available 230; recording a further 30 via the modal →
  Withdrawn 150, Available 200, Lifetime Earned stayed 350;
  zero console errors; seeds removed. tsc/lint/build clean.
- Sprint 9: Extended Transfers Page (2026-07-18). Phase A read
  the Transfers sheet directly: per-token blocks (BTC/ETH-BTC/
  SOL/SUI…) with columns Fees(amount)/DATE/Platform(source)/
  TRANSFER(destination, e.g. RAKA TEZ, AAVE BASE), each block's
  NET TOTAL = SUM(period-subtotal-row : end) = full sum of that
  token's money moved out, plus a separate "LP Spare Money"
  section (maps to transferType "undeployed"). The app's Transfer
  model tracked platform (source) but NOT destination, and the
  page only grouped by type with a flat total. Gate approved by
  Osho: full scope (add destination + group by token with net
  totals + per-destination breakdown + overall Transfers Net
  Total card), existing transfers left blank/editable. Shipped:
  added destination:string to Transfer type (lib/types.ts);
  getTransfers backfills destination:"" for legacy records
  (lib/storage.ts); transfers page — byToken and byDestination
  useMemos (Σ amount + count, sorted desc; missing destination →
  "Unspecified"), two GroupTable cards (By Token / By
  Destination each with a Net Total footer), summary card renamed
  to "Transfers Net Total" (= Σ all amounts, the Money Flow
  invariant), Destination column in the All Transfers table
  ("—" when blank), and Platform(from)/Destination(to) fields in
  the add/edit form (destination optional). Settings CSV transfer
  export gained a Destination column. Verified on localhost:3001
  with seeded transfers incl. one legacy record lacking the
  destination field: Net Total 675, By Token SUI 300/SOL 200/
  ETH 175, By Destination RAKA 350/AAVE BASE 300/Unspecified 25,
  legacy row shows "—" and groups under Unspecified; form shows
  both fields; zero console errors; seeds removed. tsc/lint/build
  clean.
- Sprint 8.5: Auto-Fetch Token Prices (2026-07-18). First time
  CLP Tracker reaches the network. Gate approved by Osho: curated
  symbol→ID map + manual fallback, fetch on page load + manual
  Refresh button, CoinGecko primary / DeFiLlama backup. Shipped:
  lib/tokenIds.ts curated UPPERCASE-symbol → CoinGecko-ID map
  (BTC/ETH/WETH/WBTC/CBBTC/SOL/SUI/HYPE/ZEC/ARB/OP/AERO/ORCA +
  USDC/USDT/DAI) — anything unlisted stays on manual entry, never
  guessed; app/api/prices/route.ts Route Handler (uses
  request.nextUrl.searchParams — SYNCHRONOUS in Next 16 route
  handlers; the async searchParams form is Page-props only, and
  the posttooluse-validate hook's "add await" note is a false
  positive here, verified against node_modules/next docs
  route.md) proxies CoinGecko simple/price then DeFiLlama
  coins.llama.fi for any IDs CoinGecko misses, returns
  {prices,unresolved,updatedAt,sources,error?}; PriceCache in
  lib/storage.ts (clp_price_cache) shows last-known prices
  instantly on load. Business P&L page: on hydrate loads cache +
  fires refreshPrices(claims); effectivePrices merges
  settings.prices (manual overrides) OVER fetchedPrices so a
  manual value always wins; setPrice drops an override that
  equals the fetched price (and clearing reverts to auto), so
  overrides never freeze against future refreshes; AUTO/MANUAL
  tags per row, "Updated Xm ago" + Refresh button, amber error
  banner when the price service is unreachable (falls back to
  cached/manual). NOTE: this ships CURRENT prices only — Invariant
  #2 (claim-time HISTORICAL pricing) and #3 (persistent cache)
  are only partially advanced; historical per-claim valuation
  remains future work. Verified live on localhost:3001: /api/
  prices returned real CoinGecko values (ETH 1844.30, SOL 74.97,
  ZEC 542.24, USDC ~1, FOOBAR unresolved); page auto-filled all
  three tokens with AUTO tags, All Total 571.05 and Unconverted
  Holdings fully valued (ZEC +1.12, totals 571.05/570/+1.05,
  matched hand math against live prices); manual override →
  MANUAL tag + recompute, clearing → revert to AUTO; zero console
  errors; seeds removed. tsc/lint/build clean.
- Exit-before-entry date warning (2026-07-18): DateOrderWarning
  component in app/positions/page.tsx shows a non-blocking amber
  plausibility warning (Invariant #8) when exit datetime is
  earlier than entry datetime. Renders in two places: the Close
  modal (live as the user picks the exit date) and the Edit form
  for closed positions (PositionFormModal now receives the
  position's exitDatetime, so moving entry past exit warns too).
  Warning-only — nothing blocks save, no stored values change.
  Verified on localhost:3001 with seeded positions (warning
  appears on bad dates in both modals, disappears when dates are
  fixed); seeds removed after. tsc/build clean.

- Deposited ↔ token counts two-way link (2026-07-19) [19be937]:
  Deposited (USD) became an editable input on the position form.
  Typing it solves for the token counts via
  splitDepositedIntoTokens in lib/calculations.ts, so Invariant #9
  still holds — Deposited stays (base × entry) + quote, just
  derived from the other end. Editing a token count directly
  recomputes Deposited (the original one-way flow) and hands
  control back to the user; a later auto-split says so in an amber
  note rather than replacing hand-typed amounts silently. Note the
  50/50 token split sits at the GEOMETRIC mean √(Pa·Pb), not the
  arithmetic midpoint. Verified: $8,666.89 at entry 1639.4 in
  1559.37–1982.32 → 4.15359613 / 1857.48450667, exact round-trip.
- Entry price ↔ Deposited link along the LP value curve
  (2026-07-19) [9a3ba49]: moving either one moves the other,
  holding the position's liquidity fixed — the same curve the
  out-of-range projections use. lib/calculations.ts gained a
  single perLiquidity core with liquidityFromDeposited,
  tokensFromLiquidity, depositedFromLiquidity and
  entryPriceFromDeposited built on it (splitDepositedIntoTokens
  now composes the first two; behaviour unchanged). Value is flat
  above the top of the range, so deposits above that ceiling clamp
  with a note; below the bottom the position is all base token and
  value is linear in price, so there is no lower bound. Live on
  Add only — on a saved position Deposited must not move when an
  entry-price typo is corrected. Verified: $10,000 @ 1700 in
  1559.37–1982.32 pins L=2087.2655; entry → 1900 gave $10,467.20;
  $12,000 clamped to $10,508.12; $8,000 solved entry 1338.52 below
  the range.
- Token-amount-driven entry price (2026-07-20) [b7da583]: Added
  token-amount-driven entry price mode to Add Position form. Users
  can type exact base/quote token amounts (from on-chain tx data)
  and the app solves for the exact entry price using the range
  bounds, instead of requiring a typed/estimated entry price. Edit
  mode unaffected. entryPriceFromTokens in lib/calculations.ts
  solves (a0·√pU)x² + (a1 − a0·√pU·√pL)x − a1·√pU = 0 for x = √P,
  positive root only; single-sided input bypasses the quadratic
  (a0 = 0 would divide by zero) and returns the range bound it
  sits on, tagged via the returned `shape`. MATH NOTE: the ratio
  a0/a1 falls monotonically from ∞ at range down to 0 at range up,
  so any two positive amounts map to exactly one price strictly
  inside the range — a two-sided pair cannot be out of range, and
  the in-range check is a defensive guard (Invariant #8) rather
  than a reachable case. UI is a two-tab selector on Add only
  ("Price & deposit" = existing behaviour untouched / "Token
  amounts" = new); Edit renders no tabs. No storage schema change.
  Verified on localhost:3001: ZEC/USDC range 420–503.35, ZEC
  4.2725565, USDC 2188.56 → entry 461.991043 (vs 462.9 originally
  recorded, a 0.196% correction), Deposited $4,162.44, OOR upside
  $4,248.90 — the same figure 79a2d1f recorded, confirming
  consistency with the existing IL math (Invariant #6);
  price/deposit modes byte-identical to before; Edit held
  Deposited when entry price changed; base-only → 420, quote-only
  → 503.35. tsc/lint/build clean; zero console errors; seeds
  removed.

- Recalculate from token amounts (2026-07-20) [22b966d]: Added
  "Recalculate from token amounts" correction tool to Edit mode.
  Explicit, confirmed action that lets a user correct a
  mis-recorded Entry Price using known-true token amounts (reuses
  entryPriceFromTokens from the Add Position token-amount
  feature). This is the ONE path where Edit mode is allowed to
  update Deposited — normal quick-edit behavior (re-split tokens
  only, never touch Deposited) is unchanged and remains the
  default. Deliberately a button + separate panel, not a field, so
  the tool cannot be reached by editing Entry Price. The panel
  works on a local draft: nothing reaches the form until Apply,
  nothing reaches storage until Save, and it shows an old → new
  comparison for both Entry Price and Deposited (old struck
  through) before applying. No storage schema change. Verified on
  localhost:3001 against the reported record (range 1559.37–
  1982.32, saved entry 1639.4, deposited $8,666.89, ETH
  5.286624982, USDC 0): solved entry 1559.37 — the range floor,
  the only price at which a position is 100% base, confirming the
  saved 1639.4 was inconsistent with the token amounts — Deposited
  → $8,243.80, OOR up $9,294.80 / down $8,243.80; quick-edit path
  unchanged (1639.4 → 1700 → 1639.4 held Deposited at 8666.89);
  cancel left the stored record untouched. tsc/lint/build clean;
  zero console errors; seeds removed.

- Current Balance gap fix (2026-07-20) [63aa5c8]: Fixed Current
  Balance gap in "Recalculate from token amounts" (follow-up to
  22b966d). When Current Balance had never been independently
  updated (still equal to old Deposited), it now moves together
  with the correction, preventing fake profit/loss from appearing.
  If Current Balance reflected real tracked data, it's left
  untouched and the row now warns the user to review it manually.
  CRITICAL SUBTLETY: the case test compares the position's STORED
  deposited against its STORED currentBalance — NOT
  getEffectiveDeposited. For the reported record the derived value
  is 8666.892995 against a stored 8666.89, a 0.003 gap that would
  misclassify an untouched balance as real tracked data and skip
  the fix entirely. The 1e-8 epsilon only absorbs float
  representation; choosing the right operand is what makes the
  test correct. Current Balance moves via a currentBalanceOverride
  field on the form state that only the confirmed recalculation
  sets, so every other path through buildRecords carries the
  stored balance through untouched. No schema change. Verified on
  localhost:3001: Case 1 (balance 8666.89 = deposited) → both
  Deposited and Current Balance $8,243.80, Price Diff $0.00,
  Profit $0.00 (phantom $423.09 gone); Case 2 (balance 9100) →
  Current Balance untouched, Profit $433.11 → $856.20 exactly as
  the warning predicted; Update flow unchanged; a plain
  entry-price edit afterwards still held Deposited and preserved
  currentBalance, so the override does not leak. tsc/lint/build
  clean; zero console errors; seeds removed.

- Positions list rebuilt as cards (2026-07-20) [b9f10df]: the
  15-column table pushed Edit/Update/Claim/Close past the right
  edge, reachable only by dragging sideways. Replaced with a card
  grid: header (pair, chain · protocol, status badge), a visual
  range bar drawing where price sits between the bounds (dot
  coloured by status, tick for entry price), six headline metrics,
  a Details toggle for New Fees / Claimed / Price Diff / Entry
  Price / Range bounds / Range %, and actions always visible at
  the bottom. Every value the table showed is still shown, plus
  Entry Price and range bounds which it had no room for. Closed
  cards dimmed, never filtered (Invariant #4). Dropped
  RangeHealthCell and the old table markup. Verified no horizontal
  scroll at 1299px and 430px.
- Active-only scope for current-standing totals (2026-07-21)
  [7ae0e50]: Dashboard and Total P&L top-level cards (Total
  Deposited, Current Value, LP P&L, Net P&L) now scope to active
  (non-closed) positions only, matching Active Positions count.
  Added new "Lifetime Total Deposited" card on both pages showing
  all positions ever (active + closed) for overall profit/loss
  context. Sidebar Net P&L updated to match Total P&L's new
  active-only scope (Invariant #6 updated accordingly). Existing
  Active/Closed breakdown on Total P&L page is unchanged — closed
  positions remain fully visible there. JUDGMENT CALL made during
  Phase B: Net P&L on Total P&L is the sum of the cards beside it,
  and totalFees is one of its addends, so making Net P&L
  active-only necessarily made Fees Earned and Total Short P&L
  active-only too — the whole computeTotals object shares one
  loop. Osho chose the fully-coherent row at the gate. That left
  Total P&L's fees card showing $1,163.82 under the same label as
  the Dashboard's $1,428.22, so it was renamed "Fees Earned
  (Active)" to avoid two numbers under one name. Verified on
  localhost:3001 with the reported data: Total Deposited (Active)
  $28,003.03, Lifetime $34,956.13, Current Value $29,581.53, LP
  P&L $1,722.05 → $1,578.50, Net P&L $3,150.27 → $2,742.32,
  Sidebar $2,742.32 (agrees exactly); Dashboard Total Fees
  $1,428.22 / Total Profit $3,006.72 / Avg APR 35.82% unchanged;
  Closed breakdown still shows 2 positions, $6,953.10 invested,
  $264.40 fees. tsc/lint/build clean.

- Initial Capital + Overall Business P&L (2026-07-21) [e7b274a]:
  Added Initial Capital (manual input) and Overall P&L card on
  Dashboard + Total P&L page. Overall P&L = active positions'
  current value + all-time converted/claimed fees − Expense-tagged
  transfers − Initial Capital. Added moneyStatus (Redeployed/
  Expense) classification to Transfers; legacy transfers default
  to Redeployed (no P&L impact) with a review prompt. Token
  holdings (unconverted fees, Business P&L page) intentionally
  excluded — kept as a separate view per user preference.
  IMPLEMENTATION NOTES: (1) Overall P&L is the SECOND
  conversion-gated metric in the app — it sums stableAmount only
  where convertedToStable === true, unlike getEffectiveClaimed /
  getEffectiveTotalFees which count it regardless (Invariant #10).
  Expect Dashboard "Total Fees Earned" to exceed Overall P&L's fee
  component whenever unconverted claims exist; in verification
  $1,728.22 vs $1,428.22. This is correct, not a bug. (2)
  moneyStatus is OPTIONAL on the Transfer type and is NOT
  backfilled by getTransfers. undefined means "never reviewed",
  behaves exactly as redeployed in every calculation (so legacy
  data can never manufacture a loss), and stays countable — that
  is what powers countUnclassifiedTransfers, the review banner and
  its filter. Do not "tidy" this by backfilling; it would make
  legacy records indistinguishable from actively-classified ones
  and silently break the review flow. (3) initialCapital lives on
  the existing clp_settings key (merges with DEFAULT_SETTINGS, so
  old saved settings load fine); AppSettings has two literal
  definitions — lib/storage.ts and app/settings/page.tsx — both
  must be updated together. (4) Both cards are one shared
  component, components/CapitalCards.tsx, used by Dashboard and
  Total P&L so they cannot drift (Invariant #6). Verified on
  localhost:3001: capital $20,000 persisted and matched on both
  pages; $500 Expense moved Overall $11,009.75 → $10,509.75;
  $500 Redeployed changed nothing; 3 legacy transfers flagged
  "Needs review"; hand calc 29,581.53 + 1,428.22 = $31,009.75
  matched exactly; Total Invested (Active), Lifetime, Net P&L, LP
  P&L and Business P&L holdings all unaffected. tsc/lint/build
  clean.

- Closed-position Edit fields + Close Transaction Link
  (2026-07-21) [1b8bea1]: Closed position Edit modal now shows and
  allows editing Exit Date, final withdrawn amount, and Scalp, plus
  a read-only Profit/Loss summary. Added optional Close Transaction
  Link field, mirroring the existing LP Transaction Link.
  FIELD MAP (investigated, not assumed): Exit Date = exitDatetime;
  final withdrawn amount = currentBalance, which does DOUBLE DUTY —
  live value on open positions, value-at-close on closed ones;
  Scalp = scalp; Profit/Loss = derived via calcClosedProfit(scalp,
  totalFees), never stored, hence read-only. Only closeTxLink was
  missing and is the sole additive field (optional, absent on
  positions closed earlier). buildRecords gained an isClosed branch
  so exitDatetime / currentBalance / closeTxLink are writable ONLY
  when editing a closed position — open positions keep the
  currentBalanceOverride fall-through from 63aa5c8 untouched. The
  exit-before-entry warning is reused and now reads the editable
  field, so it fires while typing. Verified: Profit/Loss $220.53 =
  81.32 + 139.21 matched the card; scalp→200 + withdrawn→4300 gave
  $339.21 on the card; date warning fired and cleared; closing SUI
  stored closeTxLink and reopened editable; open-position Edit
  unchanged. tsc/lint/build clean.

## Known Issues

- **Pool P&L summary cards ignore both the status filter and the
  active-only scope rule** [Phase A completed 2026-07-21, fix NOT
  yet approved]. app/pool-pnl/page.tsx:145-166 `totals` loops the
  raw `positions` array, not the filtered `rows` (line 132-143), so
  the five cards always span every position regardless of the
  All/Active/Closed toggle. Two consequences: (1) same
  closed-position double-count that 7ae0e50 fixed on Dashboard and
  Total P&L, and (2) selecting "Active" changes the table but not
  the cards, which is actively misleading. Evidence with 4 active +
  2 closed: cards read Total Invested $34,956.13 / Current Value
  $36,678.18 / LP P&L $1,722.05 / Net P&L $1,722.05 in BOTH the All
  and Active views, while the Active table showed only the 4
  positions totalling $28,003.03 → $29,581.53 → $1,578.50. Pool
  P&L's "Net P&L" card ($1,722.05) also disagreed with the Sidebar's
  Net P&L ($1,578.50) on the same screen — a direct Invariant #6
  breach. NOT a bug: the By Token section (calcTokenPnL) explicitly
  splits Realized vs Unrealized and labels counts, which is the
  Sprint 6 design and should not change. Recommended fix: make
  `totals` derive from the same filtered set as `rows`, so the cards
  follow the toggle; no Lifetime-card pattern needed here since the
  toggle already exposes closed positions on demand.

- None currently tracked. (Current Balance gap in the Edit-mode
  recalculation closed 2026-07-20 by 63aa5c8 — see above.)

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