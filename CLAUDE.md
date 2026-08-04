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

2. [PARTIALLY ACTIVE] **Historical Pricing (Rule 1a)** — USD
   valuation of a past event must use the price AT that moment,
   never current spot.

   CASCADE (corrected 2026-07-21 by measurement — the earlier
   [ASPIRATIONAL] version listed CoinGecko before DeFiLlama, which
   testing showed is backwards):

     1. Stablecoin anchor ($1, STABLE_SYMBOLS via isStableSymbol) —
        never fetched.
     2. DeFiLlama /prices/historical/{unixtime} — PRIMARY. Genuinely
        time-granular (asking 19:13 returns the 19:13 price),
        batches every symbol into one ~0.5s call, reaches years
        back, 0 failures in a 12-call burst.
     3. CoinGecko /coins/{id}/history — LAST RESORT ONLY. DATE-only
        (one snapshot per day), capped at 365 days on the free tier,
        and rate-limits hard: 5 of 10 sequential calls returned 429.
        One call per token, no batching. Results must be flagged
        `coarse` so the UI never implies minute accuracy.
     4. Manual entry fallback.

   Never current spot as a fallback for a past event.

   ACTIVE for: Close Position token-amount mode (b74595d), via
   app/api/prices/historical/route.ts.
   STILL ASPIRATIONAL for: per-claim fee valuation, which remains
   on manual/current-price entry.

   SCOPE NOTE: this cascade governs HISTORICAL lookups only.
   CoinGecko stays primary for LIVE prices in
   app/api/prices/route.ts, where it is fast (~72ms) and
   unthrottled — do not "unify" the two routes onto one provider.

   TIMEZONE: callers pass an absolute unix timestamp. The client
   builds it with new Date(localDatetimeString).getTime()/1000 —
   the datetime-local input holds local wall-clock time and Date
   parses it in the device zone, so this is already correct. Do
   not add manual offset arithmetic; that is how this gets broken.

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
   SCOPE RULE (2026-07-21, PROFIT HALF REVISED 2026-07-23 — see the
   scope-swap entry in Recent Shipped Sprints):

   CAPITAL figures scope to ACTIVE positions only, on BOTH pages —
   Dashboard Total Deposited (Active) and Current Value; Total P&L's
   Total Invested (Active) and Total Current Value. Capital in a
   closed position has been withdrawn and redeployed, so counting it
   again double-counts. This half is unchanged since 7ae0e50.

   PROFIT figures split by PAGE, matching what each page's name
   promises:
     - Dashboard = current standing → ACTIVE only: Fees Earned
       (Active), Total Profit (Active), Average Fee APR (Active).
     - Total P&L = the whole business ever → ALL positions, closed
       included: Total Fees Earned, LP P&L, Total Short P&L, Net
       P&L. Sidebar Net P&L must always equal Total P&L's Net P&L,
       so it is all-positions too.

   Because the two scopes coexist, a label may not be reused across
   scopes. The qualifiers therefore live on the DASHBOARD now
   ("Fees Earned (Active)" etc.) and Total P&L carries the plain
   "Total Fees Earned" — the exact opposite of the 7ae0e50
   arrangement, which is the point of the swap.

   Closed positions are never hidden: they keep their own column in
   Total P&L's Active/Closed breakdown, and Lifetime Total Deposited
   on both pages spans every position ever opened.

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

- Token-amount close mode + exact-time historical pricing
  (2026-07-21) [b74595d]: Close Position flow now offers an
  optional token-amount entry mode alongside manual entry. User
  enters base/quote token amounts received at close; app fetches
  the exact historical price at that timestamp via DeFiLlama
  (corrected cascade — see Invariant #2 update) and auto-calculates
  Final Current Balance and Scalp. Fetched price is
  user-overridable. Falls back gracefully to manual entry on fetch
  failure. New route app/api/prices/historical/route.ts; manual
  mode and all live-price paths unchanged; no schema change (Mode 2
  writes the same scalp/currentBalance). isStableSymbol exported
  from lib/calculations so the route anchors the same stable set as
  every other calculation. Verified 2026-07-04 19:13 AEST: ETH
  1759.85149134 matched an independent DeFiLlama call to 8dp; unix
  1783156380 = 09:13 UTC and stored as 2026-07-04T09:13:00.000Z;
  price override 2000 → $6,500.00 / -$3,500.00 instantly;
  USDC/USDT close fetched nothing and anchored both to $1.00;
  FOOBAR produced a graceful "type it in or switch to manual"
  fallback; exit-before-entry warning fired in token mode.
  tsc/lint/build clean.

- Scalp auto-calculation + old-record repair (2026-07-22)
  [c372b30]: Fixed Scalp silently defaulting to 0 instead of being
  calculated in the manual Close flow. Scalp now auto-fills as
  Final Withdrawn Amount − Deposited (still editable/overridable)
  the moment Final Withdrawn Amount is known, in both the Close
  modal and closed-position Edit modal. Added an explicit
  "Recalculate Scalp" action in Edit mode to fix old records
  without silently rewriting saved data.
  DEFINITION (confirmed with Osho 2026-07-22): Scalp is ALWAYS the
  price difference, nothing more — fees are tracked separately.
  There is no legitimate case where it differs from
  (currentBalance − getEffectiveDeposited), so the old "Leave blank
  if no scalp event" hint was wrong and is removed. Helper:
  calcScalpFromWithdrawn in lib/calculations.ts.
  SCOPE ANSWER: the affected-position count could NOT be produced
  externally — user data lives in the user's own browser
  localStorage, which the automation profile does not share. Built
  findSuspectScalpPositions + a banner on the Positions page
  instead, which lists every closed position with Scalp 0 whose
  withdrawn differs from deposited by >$0.01, names the correct
  value, and links to Edit. This answers the scope question in-app,
  for every user, permanently. It REPORTS and never repairs: a
  genuine round-trip legitimately has Scalp 0 and is
  indistinguishable from the bug by value alone, so only the user
  can decide. Nothing persists until Save.
  TRAP FIXED: formatAmountInput returned "0" for any value <= 0,
  which would have silently zeroed exactly the loss case this fix
  targets. It now takes allowNegative, set only for Scalp — do not
  remove that flag. Verified: WETH/USDC $3,482.27 → $3,004.27 with
  fees $484.61 flagged correctly, recalculated to −$478.00, Profit
  $484.61 → $6.61; genuine break-even and already-correct positions
  not flagged; manual close auto-filled −400 and +250 and stayed
  overridable; Mode 2 and open-position Edit unaffected.
  tsc/lint/build clean.

- Hypothetical labelling on closed positions (2026-07-22)
  [c7fce4f]: Out-of-Range Upside/Downside and Net Coverage boxes
  now show a "Hypothetical — not what actually happened" label and
  are visually de-emphasized on CLOSED positions, to avoid
  confusion with the position's real Scalp/Profit result. No change
  on open positions, no calculation changes.
  WHY: these boxes answer "what would this be worth IF price hit
  the exact edge of the range?" — useful while open, but on a
  closed position the real outcome is already recorded and the
  projection almost never matches, because a close rarely lands
  exactly on a range boundary. Confirmed case: WETH/USDC closed
  with Scalp $29.07 / Profit $283.13 beside a hypothetical upside
  of $234.58, no label distinguishing them.
  ALL THREE RENDER LOCATIONS (audited — if a fourth is ever added,
  it needs the same treatment): (1) app/positions/page.tsx Add/Edit
  modal — two OutOfRangeBox + two NetCoverageBox; (2)
  app/pool-pnl/page.tsx By Position table — OOR Upside / OOR
  Downside cells; (3) app/pool-pnl/page.tsx expanded row — "Out of
  Range Scenarios" ScenarioBox + CoverageBox. The Positions page
  position CARD does not render these at all. Settings CSV export
  writes the raw fields and was deliberately left alone — a
  spreadsheet column is not a side-by-side comparison with the real
  result.
  Shared via components/Hypothetical.tsx (HYPOTHETICAL_DIM,
  HypotheticalNotice, HypotheticalTag) so the surfaces cannot drift
  — do not inline copies per page. FOLLOW-UP [9d3eb55]: the Pool
  P&L table cells first shipped with a hover-only title, invisible
  on mobile; they now render the visible HypotheticalTag instead,
  so all three surfaces show the warning without hovering. Verified: closed Edit showed the
  notice with both grids at opacity-60; open Edit unchanged with
  identical class strings; closed table row had exactly 2 dimmed
  titled cells vs 0 on the open row; lib/calculations.ts not in the
  diff. tsc/lint/build clean.

- Pool P&L summary-card toggle fix (2026-07-22) [741ac8a]: Fixed
  Pool P&L summary cards (Total Invested, Current Value, LP P&L,
  Net P&L, Short P&L) to respect the existing Active/Closed toggle
  — previously always computed from all positions regardless of
  toggle, while the table beneath correctly filtered, causing a
  mismatch with the Sidebar's Net P&L (Invariant #6). No change to
  the By Token section. The table and cards now share one
  filteredPositions memo so they cannot describe different scopes;
  every card follows the toggle (none is intentionally
  all-positions the way Dashboard's earned-money cards are — that
  exception does not apply here). Verified with the 4-active /
  2-closed Phase A set: Active $28,003.03 / $29,581.53 / $1,578.50;
  All $34,956.13 / $36,678.18 / $1,722.05; Closed $6,953.10 /
  $7,096.65 / $143.55; By Position row count tracks the cards
  (6/4/2); Sidebar Net P&L matched Pool P&L's $1,578.50 in Active;
  By Token identical across all three toggle states. tsc/lint/build
  clean. Closes the Phase A Known Issue logged in 636b9d0.

- Claims "needs USD value" filter + AppSettings consolidation
  (2026-07-22) [78ff8a8]: Added a filter to quickly find claims
  missing a converted USD value (previously silently counted as $0
  toward Overall P&L). Consolidated the duplicate AppSettings type
  declaration into a single source (lib/types.ts). Detail: the
  AppSettings interface was already single-source in lib/types; the
  real duplicate was the DEFAULT_SETTINGS literal in lib/storage
  AND app/settings/page — the pair that drifted when initialCapital
  was added (noted in the Initial Capital entry above). Now exported
  once from lib/storage. The Claims banner predicate is
  isUnvaluedConvertedClaim in lib/calculations, shared with
  calcOverallPnL's unvaluedConvertedClaims count so the two can
  never disagree — do not inline a second copy of the
  converted-but-null test. tsc/lint/build clean.

- Fee Claims summary-card filter fix (2026-07-22) [4ac704f]:
  Fixed Fee Claims summary cards (Total Claims, Total Fees Earned,
  Total Converted to Stable, Average Position APR) to respect the
  Position/Platform/Chain filters — previously always computed from
  all claims regardless of filter, same pattern as the earlier
  Dashboard and Pool P&L fixes. totals now loops filteredSorted;
  Average Position APR scopes to positions in the filtered claims
  but computes each one's APR from the FULL claim list (a
  position's APR is a property of the position, not a claim subset
  — Invariant #10). BROADER SWEEP (asked for): three pages have
  filters — Pool P&L (fixed 741ac8a), Fee Claims (this), and
  Transfers. Transfers has the SAME code shape (totals/byToken/
  byDestination loop raw transfers while the table uses
  sortedFiltered) but is NOT the same bug: its cards are Money Flow
  accounting invariants ("Lifetime Earned never decreases",
  "Transfers Net Total = Σ all money moved out"), lifetime by
  definition — the deliberate-exception case like Dashboard's Total
  Fees/Profit/APR. Filtering them would breach Money Flow invariant
  #2. Left as-is on purpose; do not "fix" it to follow the type
  filter. PATTERN NOTE for future filtered pages: summary cards
  must read the same filtered list as the table UNLESS the card is
  an explicitly lifetime/accounting figure — decide per card, and
  when in doubt the earned-money/accounting ones stay whole while
  the current-scope ones follow the filter.

- Growth Target (2026-07-22) [60fcb74]: Added "Growth Target" — user
  sets a Target Monthly % (of Initial Capital); app shows Combined
  Earnings (all positions' price P&L + all fees at current value,
  reusing Business P&L's All Total) since the user's very first
  position, compared against a cumulative target. Deliberately
  broader in scope than Overall P&L (includes closed positions and
  held token fees) — labeled clearly to avoid confusion between the
  two.
  DETAIL: calcGrowthTarget in lib/calculations.ts takes
  businessAllTotal as a PARAMETER rather than recomputing fees — the
  caller passes calcBusinessPnL(claims, prices).allTotal, so the
  Growth card and the Business P&L page can never disagree
  (Invariant #6). Start date is derived live as the earliest
  entryDatetime across ALL positions (active + closed), never
  stored, so it stays correct if older positions are added later.
  Months elapsed = days / 30.44 as a decimal (DAYS_PER_MONTH),
  matching the app's existing decimal Days Active style.
  SHARED PRICE HOOK: valuing fees at current prices needs the same
  fetched+manual price merge the Business P&L page already had, so
  that logic moved into lib/useTokenPrices.ts (collectClaimSymbols,
  mergePrices, useTokenPrices) and the Business P&L page was
  refactored onto it — one copy, not two. The hook keys its fetch on
  the token-set string rather than running mount-only, because the
  Growth card receives claims as props AFTER its parent hydrates.
  EDGE CASES: unset Initial Capital, unset target, and no positions
  each render a prompt instead of a divide-by-zero (Invariant #8);
  a brand-new position still computes (large rate shown as-is).
  Shared component components/GrowthTarget.tsx used by both
  Dashboard and Total P&L, same pattern as CapitalCards.
  Verified on localhost:3001 with seeded data (3 positions incl. 1
  closed, 3 claims): start date 25 Feb 2026 → moved to 5 Jan 2026
  when the CLOSED position's entry was backdated, proving closed
  positions count; Combined Earnings $1,969.96 = $550 position P&L +
  $1,419.95 All Total (matched the Business P&L page, including a
  manual ETH price override of $2,000, proving the shared prices);
  4% → target $3,873.86, rate 2.03%, "$1,903.90 behind" (amber);
  1% → target $968.47, "$1,001.49 ahead" (green), and Total
  Deposited (Active) $12,400 / Lifetime $16,400 / Overall P&L
  −$6,980 / Net P&L $1,520 all unmoved; value persisted across
  reload and matched on both pages; zero console errors; seeds
  removed. tsc/lint/build clean.

- Profit-scope swap between Dashboard and Total P&L (2026-07-23)
  [7121f8d]: Swapped profit-figure scope between Dashboard and Total
  P&L. Dashboard's Total Profit/Fees Earned/Average Fee APR are now
  active-only (current standing). Total P&L's Fees Earned/LP P&L/Net
  P&L/Short P&L are now all-positions including closed (whole
  business, ever). Capital figures (Total Deposited, Current Value,
  Lifetime Total Deposited) are unchanged on both pages — still
  active-only, per the earlier double-counting fix. Sidebar Net P&L
  and Invariant #6 updated to match Total P&L's new all-positions
  scope.
  LABELS FLIPPED WITH THE SCOPES (Invariant #6 forbids one label
  covering two scopes): Dashboard now reads "Fees Earned (Active)" /
  "Total Profit (Active)" / "Average Fee APR (Active)"; Total P&L's
  card is now plainly "Total Fees Earned". Leaving the old labels
  would have pointed each qualifier at the wrong page.
  SEPARATE CAPITAL PASS: computeTotals on Total P&L now runs TWICE —
  `totals` over all positions for the profit cards, `activeCapital`
  over open positions only for Total Invested (Active) and Total
  Current Value. Do not "simplify" these back into one call; the
  page deliberately mixes two scopes and the capital half must not
  follow the profit half.
  SHORT P&L INVESTIGATION (asked for before assuming): a short has
  NO independent open/closed state. It is a set of fields ON the
  Position record (shortDateStart/shortDateEnd/shortGain/shortLoss/
  shortFundingFees/shortTotal), not a separate entity;
  shortDateEnd is a descriptive date only — nothing in the codebase
  branches on it, and shortTotal = gain − loss + funding is a
  realised figure the user types. So a short's P&L can only follow
  its position's scope, which is why Total Short P&L now spans all
  positions.
  DASHBOARD PROFIT SIMPLIFICATION: Total Profit (Active) still flows
  through calcPositionProfit, whose closed-position "scalp + fees"
  branch is simply unreachable now that only active positions are
  passed. The helper was deliberately NOT changed — Total P&L's
  Active/Closed breakdown still needs that branch for its closed
  column.
  Verified on localhost:3001 with seeded data (2 active + 1 closed,
  2 claims, shorts on one active +$150 and one closed −$80), before
  numbers captured by stashing the diff and re-reading the live
  pages: Dashboard Fees $420 → $300, Total Profit $970 → $500, Avg
  APR 7.40% → 5.95% (matching the OLD Total P&L active figures
  exactly); Total P&L Fees $300 → $420 (matching the OLD Dashboard),
  LP P&L $200 → $550, Short $150 → $70, Net $650 → $1,040; Sidebar
  $650 → $1,040, equal to Net P&L; Total Deposited $12,400 /
  Lifetime $16,400 / Current Value $12,600 / Initial Capital
  $20,000 / Overall P&L −$6,980 / Growth Target all byte-identical
  before and after; Active/Closed breakdown unchanged (2/$12,400/
  $300/5.95% and 1/$4,000/$120/$470). Zero console errors; seeds
  removed. tsc/lint/build clean.

- Live number breakdowns + toggles (2026-07-24) [e56ec29]: Added
  live, real-number breakdowns (with collapse/expand toggles) to
  Growth Target's Combined Earnings and Total P&L's LP P&L / Net
  P&L / Overall P&L cards, so users can see exactly how each figure
  was calculated without asking. Added a converted-vs-held split
  note to Total Fees Earned. Growth Target now shows precise
  months-elapsed instead of a rounded figure.
  SHARED PRIMITIVE: components/Breakdown.tsx — one collapsible
  line-item list (collapsed by default so a card keeps its
  neighbours' height until expanded), reused by every "how this
  number was made" card so they behave identically. Rows carry a
  pre-formatted value string; the final row is isTotal (top rule +
  bold). Do not inline copies per card.
  EACH BREAKDOWN RECONCILES BY CONSTRUCTION (verification hand-
  checked all): LP P&L = active(current−deposited) + closed(final−
  deposited, i.e. Scalp), both drawn from the SAME arithmetic as
  totals.lpPnL via lpSplit, so they always sum to it; a closed
  position's (final−deposited) is its scalp by the c372b30
  definition. Net P&L = LP P&L + Total Fees + Short P&L (the exact
  addends of netPnL). Overall P&L = activeCurrentValue + Converted
  Fees − Expenses − Initial Capital, read straight off calcOverallPnL.
  PART 4/E — THE FEE FIGURE: Overall P&L's breakdown uses
  overall.convertedFees (Σ stableAmount where convertedToStable ===
  true — realized, cashed-out fees only), which is DELIBERATELY a
  different number from Growth Target's fee half (business.allTotal,
  every fee at current market value including still-held tokens). In
  the seed verification convertedFees = $420 vs allTotal = $1,419.90.
  They are not the same and must not be swapped. Confirmed against
  the code path, not assumed.
  PART 5 — CONVERTED VS HELD: the Total Fees Earned card now shows
  "$X converted · $Y still held at today's value". X = convertedFees
  (same figure Overall P&L uses); Y = calcUnconvertedHoldings(...).
  totalCurrentValue — the exact number Business P&L's Unconverted
  Holdings "Current Value" card shows (same helper, same merged
  fetched+manual prices via useTokenPrices/mergePrices). Verified $420
  / $1,000.00 matched Business P&L to the cent. FeesEarnedCard does
  its own price fetch through the shared hook rather than recomputing
  the merge. Note these two are different valuation bases (realized
  claim-time vs current market) and are not claimed to sum to the
  card total — it is a "how much converted vs still held" note, not a
  decomposition.
  PART 1 — PRECISE MONTHS: the Cumulative Target formula prints
  months to 6 decimals (was 2, which was off by dollars) and the
  header shows the exact start date+time plus months to 2dp.
  6dp is what makes capital × target% × months reproduce the
  displayed total to the cent for realistic capital; because months
  advances with wall-clock time, penny-exactness is momentary by
  nature (any rounded intermediate can land on a half-cent boundary),
  but 6dp keeps the gap sub-cent. Verified: $20,000 × 4.00% ×
  4.890738 months = $3,912.59, reproduced exactly.
  OverallPnLCard (shared with Dashboard) gained an OPTIONAL breakdown
  prop — only Total P&L passes it, so the Dashboard's Overall P&L
  card is unchanged (confirmed: Dashboard shows exactly one toggle,
  Growth Target's). Entirely additive: no calculated total anywhere
  changed. tsc/lint/build clean; zero console errors; seeds removed.

- Transfers automation: Fee-claim + upside-close + safe backfill
  (2026-07-24) [666ec71]: Automated Transfers for Fee claims
  (converted AND unconverted, going forward) and Out-of-Range-Upside
  closes (gated by a new close-time range selector, since exit-side
  data was previously computed but discarded). Added safe, reviewable
  in-app backfill for historical claims/closes — never silent, always
  user-confirmed, deduped by position+day+type. Added optional
  sourceClaimId/sourceCloseId to Transfer for future idempotency.
  Undeployed Tokens and Expenses remain fully manual, unchanged.
  ARCHITECTURE: all automation lives in lib/transferAutomation.ts
  (pure builders + one async reconcile + backfill-eligibility
  helpers). Part 1 hooks into persistNewClaim AND persistUpdatedClaim
  in components/ClaimFormModal.tsx (the shared claim-persistence path,
  Invariant #10) so BOTH the /claims form and the close-with-fees flow
  auto-create transfers with no duplicated logic.
  KEY BEHAVIOURS:
  • moneyStatus is OMITTED on auto rows (undefined = "needs review",
    per Invariant/e7b274a) — never guessed as redeployed. platform and
    destination are blank; notes carry an AUTO stamp used as the
    "untouched" tell-tale.
  • Single reward leg → one transfer, amount = stableAmount, token =
    non-stable symbol (else stableSymbol). TWO non-stable legs (e.g.
    ETH+WBTC) → two transfers split by REAL historical value on the
    claim date via the existing /api/prices/historical route (DeFiLlama
    cascade, Invariant #2 — no second price path), second leg = usd −
    first so they sum to stableAmount exactly.
  • Close: a range selector (Above/Below/Still in range) on both modes.
    Token mode pre-fills from the base≈0/quote>0 heuristic
    (overridable); manual mode requires an explicit pick. Upside
    transfer (amount = scalp, sourceCloseId) is created ONLY when
    "Above range" AND scalp > 0.
  • Backfill: a reviewable banner on /transfers. Eligible = claims/
    closes with NO matching transfer (by sourceClaimId/sourceCloseId OR
    the position+day+type heuristic). Fee claims: bulk "Create N" +
    per-row exclude. Closes: per-row "Yes, above range" confirm (never
    pre-guessed from scalp sign — Phase A established that is
    unreliable).
  EDIT-AFTER-CREATION (Part 1 edge, the flagged decision):
  reconcileClaimTransfers keys off sourceClaimId. If the claim's auto
  transfer is UNTOUCHED (platform/destination blank, moneyStatus unset,
  auto note intact) it is deleted + rebuilt to match the edited claim;
  if the user has edited it, it is left exactly as-is and reported
  skipped-touched (no silent divergence). A claim with NO auto transfer
  but a colliding manual same-day fees transfer returns skipped-existing
  so editing a legacy claim can never manufacture a duplicate — this
  guard was ADDED mid-build after live testing showed the sourceClaimId-
  only check would have duplicated a hand-logged transfer on legacy-claim
  edit.
  REAL-DATA COUNTS (verification G): the user's positions/claims/
  transfers live in their browser localStorage, which the automation
  profile does not share (same limit as c372b30). The backfill screen
  produces the real counts in-app on the user's machine; verified here
  against a representative seed (1 eligible claim / 1 eligible close,
  with 1 claim + 1 close correctly EXCLUDED as already-covered).
  Verified live on localhost:3001: single converted ($300→ETH),
  single unconverted ($500→ETH), and dual ETH+WBTC ($1000 → $359.9991 +
  $640.0009, summing to exactly $1000 via real DeFiLlama prices) all
  auto-created with blank platform + unset moneyStatus; Mode-2 close
  base0/quote6000 pre-filled "Above range" → $1000 upside transfer;
  Below-range and scalp≤0 closes created none; backfill created the two
  eligible records and hid the two already-covered ones; claim-edit
  updated an untouched transfer, preserved a user-edited one, and did
  not duplicate a legacy manual transfer. Seeds removed. tsc/lint/build
  clean; zero console errors.

- Transfers-automation bug fixes: upside-transfer date + same-day
  backfill (2026-07-24) [06146fa]: Two real bugs found and fixed in
  the Phase B Transfers automation (label/wording tweaks shipped in
  the same commit are not invariants).
  BUG 1 — upside transfer date off by a day (timezone). buildUpside
  Transfer set the transfer date via dayOf(exitDatetime) = a UTC
  SLICE of the stored ISO string, while the Positions page shows the
  close date in LOCAL time (formatDateTime24). For any close whose
  local and UTC calendar days differ (e.g. a 09:00 close in
  Australia/Brisbane UTC+10 stores 2026-06-01T23:00Z → position shows
  02/06/2026, transfer sliced to 2026-06-01), the auto transfer
  landed a day earlier than the position. Exactly the class the
  Invariant #2 timezone note warns about. Fix: new localDayOf() in
  lib/transferAutomation.ts derives the LOCAL YYYY-MM-DD (bare dates
  pass through unchanged), used for the upside transfer date. Claim
  transfers were unaffected — claim.date is already a bare local date
  from the date input, never a UTC datetime. Verified: same close now
  writes transfer date 2026-06-02, matching the card.
  BUG 2 — backfill dropped legitimate same-day claims (91 claims → 90
  transfers). The position+day+type dedup heuristic counted AUTO
  transfers too, so when two fee claims sat on the SAME position on
  the SAME calendar day, the first claim's freshly-created auto
  transfer falsely matched the second (different sourceClaimId), and
  reconcile returned skipped-existing — the second claim silently got
  no transfer. Fix: the day+position heuristic in BOTH claimHasFee
  Transfer and reconcileClaimTransfers' skipped-existing guard now
  only counts MANUAL transfers (sourceClaimId === undefined). Auto
  transfers are already deduped precisely by sourceClaimId, so an auto
  row for a different claim no longer blocks. The legacy-duplicate
  guard is preserved: a hand-logged (manual) same-day fees transfer
  still blocks. Verified: two same-day claims ($100 + $150) now both
  backfill (2 transfers); a third same-day claim with a MANUAL
  transfer stays excluded; re-run creates no duplicates.
  No calculation changed (only a date string and the eligibility
  predicate); diff is app/transfers/page.tsx + lib/transferAutomation
  .ts only. tsc/lint/build clean; zero console errors.

- Token symbol ↔ pair mismatch detector (2026-07-25): Phase A
  investigation of a reported "SUI/USDC position shows SOL" bug.
  ROOT CAUSE (traced, not guessed): NOT a code bug. token1Symbol/
  token2Symbol are plain user-entered free-text fields on the
  Position record (app/positions/page.tsx Base/Quote Token Symbol
  inputs), and EVERY surface — Add Claim form (ClaimFormModal.tsx:317
  /373 copy p.token1Symbol), Close modal display + historical price
  fetch (app/positions/page.tsx:3392/3411), live range-bar price
  (:871/916) — is a faithful passthrough of the stored symbol. Both
  price routes (app/api/prices + /historical) map the given symbol
  correctly via resolveCoingeckoId; lib/tokenIds.ts is clean (all 16
  IDs verified, no chain/token mismap, no substring/default-fallback
  logic). The stored record simply held token1Symbol="SOL" for a
  SUI/USDC position (typo entered via the manual Base Token Symbol
  field). Because "SOL" is a real mapped token, price lookups
  dutifully returned Solana's price — looking like a price bug.
  DOLLAR RISK: only a token-amount-mode close (Close Mode 2) fetches
  a price FROM the symbol and writes it to stored currentBalance/
  scalp, so ONLY a Mode-2 close on a mis-symboled position corrupts
  real dollars (unless the fetched price was manually overridden).
  Claim USD values (stableAmount) are always typed, never fetched
  from the symbol → labels wrong but dollars safe. Range bar is
  display-only, never persisted.
  SHIPPED (gate: "detector first, then fix data"):
  findSymbolPairMismatches in lib/calculations.ts — flags any
  position whose Base/Quote symbol is not a SUBSTRING of its own Pair
  string (substring, not equality, so ETH on WETH/USDC is NOT flagged
  while SOL on SUI/USDC is; strips a trailing " (fee%)" suffix). Red
  SymbolMismatchBanner on the Positions page (mirrors
  SuspectScalpBanner) lists each mismatch with the likely-correct
  symbol from the pair and an Edit link; closed positions sorted
  first and tagged "closed · check $" with an explicit note to use
  "Recalculate from token amounts" after fixing the symbol. Reports,
  never auto-repairs (only the user knows if the Pair or the symbol
  is the typo). Real-data scope runs in the user's own browser (their
  localStorage is not accessible to the automation profile — same
  limit as c372b30/666ec71). Predicate verified against 6 edge cases
  (SOL/SUI flagged, WETH/ETH not, fee-tier stripped, dual mismatch,
  empty symbol skipped). tsc/lint/build clean.

- Business P&L per-chain reward totals (2026-07-25): each chain
  ledger block's TOTAL row (app/business-pnl/page.tsx) now shows Total
  Token Rewards and Total Quote Rewards alongside the existing USD
  Value total (USD total logic byte-unchanged). Summed PER SYMBOL, not
  as a raw column sum — a chain can hold several reward tokens (ETH +
  AERO on Base), and adding those quantities is meaningless; one symbol
  renders "12.5 ETH", a mixed chain renders each token on its own line.
  ledgerBlocks memo gained token1Totals/token2Totals maps (skip empty/
  ≤0 amounts); formatRewardTotals renders them. Verified arithmetic
  against hand calc (ETH block 1.95 ETH / 180 USDC / $4,950; one-sided
  rows excluded from the quote sum; mixed ETH+AERO split correctly).
  tsc/lint/build clean.

- Claim-level symbol-mismatch detector + bulk fix (2026-07-25):
  Phase A confirmed fee claims freeze their OWN token1Symbol/
  token2Symbol as a STATIC snapshot at creation (ClaimFormModal
  buildClaim:139; close-flow positions/page.tsx:1069 copies
  target.token1Symbol), and calcBusinessPnL:434 sums claim.token1Symbol
  directly — never reading the position live. So a position mislabeled
  "SOL" (the SUI/USDC case) minted claims ALSO storing "SOL", and
  fixing the POSITION symbol (a1b7176) does NOT retroactively fix those
  claims — the SOL total stays inflated until the claims are corrected.
  The a1b7176 detector checks POSITION pair vs POSITION symbols and
  cannot see claims, but each claim carries its own pair string, so the
  same substring test catches it. Gate: "detector + bulk fix".
  SHIPPED: findClaimSymbolMismatches (claim.token1Symbol/token2Symbol
  must be a substring of claim.pair; fee-tier suffix stripped),
  summarizeClaimContamination (per-token "X SOL is actually SUI"
  subtotal that the Business P&L total is inflated by), and
  correctClaimSymbols (returns a copy with mismatched sides rewritten
  to the pair-derived symbol; never blanks a side whose pair token is
  unknown) — all in lib/calculations.ts. Red ClaimSymbolMismatchBanner
  on /claims lists each flagged claim (date · pair, wrong→right) with a
  per-row Edit link, the contamination subtotal block, and a two-step
  confirmed "Fix all" that routes every correction through
  persistUpdatedClaim (Invariant #10 — transfers stay reconciled).
  Reports/corrects only on explicit user action, never silent. Verified
  against a seed reproducing the reported ~155: 3 mislabeled SUI/USDC
  claims → "155 SOL is actually SUI (3 claims)", genuine SOL/USDC and
  WETH/ETH-alias claims correctly NOT flagged, fee-tier suffix stripped,
  correction rewrites token1Symbol SOL→SUI. Real SOL-vs-SUI split runs
  in the user's own browser (localStorage not accessible to the
  automation profile). tsc/lint/build clean.

- d9d4441: Consolidated the Position/Claim typo detectors into one
  shared Data Health system, extended to Transfers, and added an
  unusual-amount outlier flag (claims/transfers wildly bigger/smaller
  than a position's typical range). One summary card surfaces the total
  issue count across the whole app; detailed per-page banners remain.
  Detection only — every fix is still an explicit, user-confirmed
  action.
  ARCHITECTURE: lib/dataHealth.ts is the single home for every "this
  record looks wrong" check. findSymbolPairMismatches (positions) and
  findClaimSymbolMismatches + summarizeClaimContamination +
  correctClaimSymbols (claims) moved there verbatim; lib/calculations.ts
  RE-EXPORTS them so existing import sites are unchanged and results
  identical (Verification A confirmed no regression). Shared pairCore/
  symbolMatchesPair/pairTokens primitives — do not re-inline the
  substring test per page.
  PART 2 (transfers): a Transfer stores positionId + a single token, so
  findTransferSymbolMismatches checks token against the LINKED position's
  pair (skips transfers with no resolvable position). Correction target
  mirrors how automation assigns the token — outOfRangeUpside → quote
  (buildUpsideTransfer), fees/undeployed → base (buildClaimTransfer);
  correctTransferSymbol never rewrites when the target is unknown.
  PART 3 (outliers): OUTLIER_MULTIPLIER=10 compared against the MAX
  (high) / MIN (low) of the OTHER records on the same position,
  OUTLIER_MIN_SIBLINGS=2. Rationale: an extra/missing zero is a 10×
  shift; comparing to the max (not mean/median) means even the position's
  largest legitimate record must be dwarfed tenfold, so normal 2–3×
  variation never trips it; ≥2 siblings stops one data point defining
  "typical". Claims use stableAmount, transfers use amount; records with
  empty positionId or non-positive amount are excluded. Flag only — never
  corrected (a big claim can be real); Review opens the Edit modal.
  PART 4: components/DataHealthCard.tsx on the Dashboard shows the total
  count and per-category deep links (/positions#position-symbol-issues,
  /claims#claim-symbol-issues, /transfers#transfer-symbol-issues,
  /claims#claim-outliers, /transfers#transfer-outliers — anchor ids added
  to each banner); green "no issues" state when total is 0. Shared
  components/OutlierBanner.tsx used by Claims and Transfers.
  DATA SAFETY: no path mutates without a click — symbol "Fix all" is a
  two-step confirm, outliers are Edit-only, the card is links-only.
  Verified against the compiled module: A (P1/C1,C2 flagged, WETH/ETH &
  genuine SOL/USDC not, 155 SOL→SUI), B (TR1 SOL→SUI, in-pair transfers
  ignored), C (20× flagged, 2× not, 2-record not, missing-zero low), D
  (total 5 = 1+2+1+1+0). tsc/lint/build clean.

- b25281e: Six-part batch (2026-07-25):
  1. Outlier "Mark confirmed" — persisted dismissal (clp_outlier_dismissals,
     OutlierDismissal {kind,id,amount}) hides a reviewed outlier flag even
     though the same math would still flag it. Keyed by id + EXACT amount
     (±0.005), so a later amount edit no longer matches and the flag
     re-triggers. Applied in findClaim/TransferAmountOutliers (optional
     dismissals param) + computeDataHealth; "Mark confirmed" button on
     OutlierBanner; dismissals in Settings backup keys.
  2. Average Fee APR timeframe toggle on Dashboard — Daily(/365)/Weekly(/52)/
     Monthly(/12)/Yearly(default, unchanged). Pure display conversion of the
     one computed APR; no calc change (AverageFeeAprCard in app/page.tsx).
  3. Delete position with cascade — Delete on active + closed cards AND list
     rows. linkedRecords(positionId) unions transfers by positionId,
     sourceCloseId, and sourceClaimId∈position's claims (all three link
     types → no orphans), plus claims/ranges/poolPnL/positionPrices.
     DeletePositionModal shows exact counts ("1 position, N claims, M
     transfers") and requires typing the pair to enable a no-undo delete.
  4. Positions Cards/List view toggle (ViewToggle). List = table-less,
     inline-expandable PositionListRow (collapsed: Pair/Status/Profit;
     expanded: Deposited/Current/Total Fees/Fee APR/Days + all actions).
     Flex + truncate + overflow-hidden → zero horizontal scroll (the
     b9f10df problem is not reintroduced).
  5. Transfers grouped by chain — byChain memo over sortedFiltered (chain =
     linked position's chain; expenses/unlinked → "UNLINKED"), rendered as
     per-chain sections via extracted TransferTable, each respecting the
     existing type filter + review-only (grouping is downstream of
     sortedFiltered, so filters compose for free).
  6. Log an Expense (position-less pool) — DECISION: a dedicated transferType
     "expense" (not shoehorned into fees/undeployed/upside), positionId ""
     (sentinel, not a type change — automation always sets a real id and
     calcOverallPnL keys expenses off moneyStatus only, so "" is safe),
     moneyStatus forced "expense". Separate ExpenseFormModal (Date/Amount/
     Notes only) + "Log an Expense" button; edits route to editExpense, not
     the position-required TransferFormModal. Subtracts from Overall P&L
     exactly as before. Position-linked automation unchanged.
  DATA SAFETY: only Part 3 is destructive and is fully gated (count preview
  + typed confirmation + no-undo copy); everything else additive. Verified
  against compiled modules: dismiss hides then re-triggers on edit; cascade
  deletes all 3 transfer link types with 0 orphans; expense drops Overall
  P&L by exactly its amount; APR conversions exact. tsc/lint/build clean.

- b7755cb: Five-part batch (2026-07-26):
  1. Positions chain filter ("All chains" dropdown, from p.chain) + most-
     recent-first sort (active by entryDatetime desc, closed by exitDatetime
     desc). Applied to the shared active/closed arrays, so both Cards and
     List views get it. Display-only.
  2. Fee Claims Position filter → searchable PositionCombobox: live text
     filter over pair/chain/platform, options grouped by chain, "All
     positions" clears, closed suffix preserved. Replaces a ~129-option
     <select>. Display-only.
  3. Fee Claims APR relabeled "Average Position APR (Claimed)" + hint.
     INVESTIGATION: both this card and the Dashboard's "Average Fee APR
     (Active)" call the SAME calcPortfolioSummary().averageAPR (deposit-
     weighted) — weighting is identical. The gap (100.58 vs 61.52) is pure
     SCOPE: Fee Claims spans every position WITH A CLAIM (active AND closed;
     excludes zero-claim active positions), Dashboard is active-only
     (includes zero-APR unclaimed actives). Both differences push Fee Claims
     higher. Not a bug — label/hint fix only, no math change (same low-risk
     pattern as the 7ae0e50/7121f8d scope-label fixes).
  4. Transfers bulk-mark: per-row checkbox + "select all visible" + "Mark as
     Redeployed"/"Mark as Expense" behind an inline confirm. applyBulkMark
     intersects selected∩visibleIds and sets moneyStatus ONLY (transferType
     untouched; Overall P&L counts expenses by moneyStatus). The one new way
     data changes here — always confirmed.
  5. Transfers wide table → compact tap-to-expand TransferListRow (no
     horizontal scroll; collapsed = checkbox/Date/Pair/Amount/Type/Status,
     expanded = Platform/Destination/Token/Notes + Edit/Delete). Added a
     free-text search bar (searchedFiltered over pair/notes/type/token/
     destination/platform) layered on the type filter + review-only; chain
     grouping preserved (byChain now groups searchedFiltered). Removed the
     old TransferTable and now-unused formatToken.
  Verified: sort orders, chain filter, combobox grouping, search matches
  (pair/type/destination/notes), bulk mark touches only visible+selected and
  changes only moneyStatus. No calc changed. tsc/lint/build clean.

- 5ffb65b: Five-part batch (2026-07-27):
  1. Entry Date added to the position card Details grid.
  2. Closed cards show both Opened and Closed dates in the header (was
     close-date + days-held only).
  3. List-view rows (Part 4 of b25281e) now expand to the SAME Details set
     as cards — New Fees, Claimed, Price Diff, Entry Price, Entry Date,
     Range, Range %, plus Scalp on closed. Cards/List parity: identical
     info, different density.
  4a. Data Health chain-vs-pair detector (findChainMismatches in
      dataHealth.ts): a base token that is chain-native on exactly one chain
      (NATIVE_CHAIN_FOR_BASE = {SUI, SOL}; ETH/BTC/USDC deliberately omitted
      as multi-chain) whose stored chain (normalized) contradicts it is
      flagged — the reported "SUI/USDC on chain SOL" typo. New count in
      DataHealthReport/counts + Data Health card category (Position chain
      typos → /positions#position-chain-issues) + red ChainMismatchBanner on
      Positions. Detection only, user fixes via Edit.
      INVESTIGATION NOTE: the user's stored data lives in their browser
      localStorage (not accessible here). The combobox groups strictly by
      raw chain, so a SUI/USDC position appearing under a "SOL" header means
      its stored chain field IS "SOL"; the HYPEEVM/SOL/SOLANA triple headers
      were raw spelling variants (Part 5 merges SOL/SOLANA). The detector
      surfaces the exact records on the user's machine.
  4b. .scrollbar-dark utility in globals.css (thin dark track/thumb) applied
      to the position combobox dropdown; reusable for any scrollable panel.
  4c. Fee Claims SummaryStat hint moved behind an "i" toggle, absolutely
      positioned so revealing it never changes card height — all 4 cards in
      the row stay aligned.
  5. lib/nameNormalization.ts: normalizeChain/normalizeToken/normalizePlatform
     = baseNormalize (trim+UPPERCASE, folds case like Base/BASE, Cetus/CETUS)
     + one-line-extensible alias maps (CHAIN: SOLANA→SOL, ETHEREUM→ETH,
     ARBITRUM→ARB, OPTIMISM→OP; TOKEN: WETH→ETH, WBTC/CBBTC→BTC; PLATFORM:
     AERODROME→AERO, UNISWAPV3→UNISWAP). Applied at every grouping/filter
     surface: Positions chain filter (options + match), Fee Claims chain +
     platform filters (options + match) and combobox chain groups, Transfers
     by-chain sections + By Token, Business P&L chain ledger blocks.
     DISPLAY/GROUPING ONLY — stored chain/token/platform never rewritten, and
     only sum-preserving groupings are normalized. JUDGMENT CALL: Business
     P&L's per-token PRICED totals (calcBusinessPnL/calcTokenPnL/
     calcUnconvertedHoldings) are deliberately NOT token-normalized — merging
     WETH into ETH there would re-price a leg and change allTotal/Net (a
     financial figure), out of scope for this display-only batch and would
     need its own gate.
  Verified: normalization merges (SOL/Solana/solana→SOL, WETH→ETH,
  Aerodrome→AERO, Base/BASE fold) and chain detector flags SUI-on-SOL /
  SUI-on-Solana / SOL-on-ETH while NOT flagging ETH/USDC-on-Base. No calc
  function touched. tsc/lint/build clean.

- 2ef8ca5: Canonical names + ETH/WETH Business P&L merge + Fee Claims
  open/closed filter (2026-07-28):
  A. Fixed canonical display names (SOLANA not SOL, ETH not WETH) across the
     existing name normalization. In nameNormalization.ts the CHAIN alias
     flipped SOLANA→SOL to SOL→SOLANA (token ETH was already canonical). The
     chain detector's NATIVE_CHAIN_FOR_BASE expected value updated SOL→SOLANA
     in lockstep, so legit SOL/USDC-on-Solana positions do NOT false-flag.
     Applies everywhere normalization already runs (Transfers by-chain, Fee
     Claims combobox groups + chain filter, Business P&L chain blocks,
     Positions chain filter). Label-only in those sum-preserving contexts.
  B. DELIBERATE FINANCIAL CHANGE, user-authorized: merged ETH and WETH in
     Business P&L's priced totals (previously separate buckets priced by
     separate feeds — ethereum vs weth can differ by cents). calcBusinessPnL
     and calcUnconvertedHoldings now key by normalizeToken; the combined
     amount is valued at the CANONICAL token's price (WETH at ETH's price).
     collectClaimSymbols (useTokenPrices) also normalizes so the ETH price is
     fetched for a WETH-only holding. SIMPLIFICATION FLAGGED: this uses the
     shared alias table, so it ALSO folds WBTC/CBBTC into BTC at BTC's price
     (same 1:1-wrapped treatment) — one line to split if ETH/WETH-only is
     ever wanted. FLOW-THROUGH (reported, expected): Growth Target's Combined
     Earnings reads calcBusinessPnL.allTotal and Total P&L's "still held at
     today's value" note reads calcUnconvertedHoldings, so both reflect the
     merge naturally. Overall P&L is UNAFFECTED (calcOverallPnL reads
     converted stableAmount + position currentBalance, never these token
     prices). Pool P&L's calcTokenPnL is deliberately NOT merged (outside
     Business P&L). Verified impact on representative data: 2.0 ETH @ $2000 +
     1.0 WETH @ $1998 was two rows totalling $5,998; now one ETH row 3.0 @
     $2000 = $6,000 (All Total and Unconverted Holdings) — +$2.00, and
     tokenRows shows a single merged ETH row (in the calc, not just display).
  C. Fee Claims gained an All / Open-only / Closed-only segmented filter on
     the linked position's status (statusById lookup in filteredSorted;
     claims with no resolvable position count as open). Independent of the
     Position search combobox. Chain grouping (the combobox, which groups
     over positions) is unchanged across all three states.
  tsc/lint/build clean.

- 69bfc13: Retired "Needs Review" moneyStatus + "Mark as deployed" linking
  (2026-07-28):
  PART 1 — Fee and Out-of-Range-Upside automation now write moneyStatus
  "redeployed" at creation (transferAutomation autoClaimTransfer +
  buildUpsideTransfer) instead of leaving it unset. migrateTransferMoneyStatus()
  in storage.ts persists unset→"redeployed" for the ~137-record backlog on the
  Transfers hydrate (idempotent); getTransfers also backfills unset→redeployed
  on read so all pages are instantly consistent. NO financial change — unset
  was ALWAYS treated as redeployed (calcOverallPnL counts only moneyStatus
  ==="expense"; Available Balance never read moneyStatus): verified Overall P&L
  (−10,200) and Available Balance ($1,000) byte-identical before/after. Removed
  the "N transfers need review" banner, the reviewOnly filter/state, and
  countUnclassifiedTransfers usage; MoneyStatusPill's "Needs review" branch
  gone — every row shows Redeployed or Expense. COUPLING FIXED: isUntouchedAuto
  now treats moneyStatus undefined OR "redeployed" as the auto state AND
  requires deployedToPositionId unset, so reconcile keeps updating untouched
  auto rows but never overwrites a user's deploy-link. The outlier "Mark
  confirmed" dismissal (clp_outlier_dismissals) is a SEPARATE system, untouched.
  PART 2 — added optional deployedToPositionId/deployedAt to Transfer
  (additive, no migration). A Redeployed transfer gets a "Mark as deployed"
  action (DeployLinkModal, positions active-first, all allowed since a top-up
  into any position is valid) that tags it; the row then shows a green "Used →
  PAIR" badge and offers "Remove deploy link" to undo. Balance:
  Available = Lifetime Earned − Withdrawn − Deployed (new Deployed card; the
  balance memo sums transfers with deployedToPositionId set). Linked money
  leaves Available because it now lives inside the position's Deposited (entered
  separately) — the position record is NEVER modified by mark/unmark
  (handlers call saveTransfers only). Verified: deploy $500 drops Available
  $800→$300, undo restores $800, expense/withdrawn relationship unchanged.
  tsc/lint/build clean.

- d20f3e3: Transfers — merge Expense/Withdrawal, searchable Add-Transfer
  picker, idle Undeployed, deploy+lock (2026-07-28):
  PART 1 — INVESTIGATION: "Record Withdrawal" and "Log an Expense" were
  genuinely different. Withdrawal (separate clp_withdrawals store) reduces
  Available Balance only, no P&L. Expense (a Transfer, moneyStatus "expense")
  reduces Overall P&L AND — because lifetimeEarned = Σ all transfers — inflates
  Available. User says they are the same concept → consolidated into ONE "Log
  an Expense" action that records a WITHDRAWAL (the survivor, chosen because it
  feeds Available correctly and keeps the formula literally unchanged:
  Available = Lifetime Earned − Withdrawn − Deployed). Removed the
  expense-transfer ADD flow and the second button; relabelled the "Withdrawn"
  card → "Expenses / Withdrawn", the table → "Expenses & Withdrawals", the form
  → "Log an Expense". JUDGMENT/TRADEOFF FLAGGED: (a) new expenses no longer
  reduce Overall P&L (they behave like withdrawals — reduce Available); (b)
  legacy expense-transfers are untouched — still in the transfers list, still
  reduce Overall P&L, still editable via editExpense (the "Expenses" type-filter
  tab remains for them); (c) new expenses appear in the Expenses & Withdrawals
  table, not the main transfer list. No calculated total changed for existing
  data (verified Available 2000−500=1500, formula unchanged).
  PART 2 — extracted the Fee Claims combobox into shared
  components/PositionCombobox.tsx (searchable, chain-grouped, scrollbar-dark),
  now used on Add Transfer too (replacing a bare <select>). positionOptionLabel
  enriched: pair · protocol · opened DATE · closed DATE (if closed) · dep $X ·
  now $current. Combobox sorts most-recent-first (entryDatetime desc) within
  each chain group. `allValue` prop toggles the clearable "All positions" entry
  (Fee Claims uses it; Add Transfer omits it → a position is required).
  PART 3 — Undeployed Tokens no longer prompt for Money Status; buildTransfer
  stores moneyStatus UNSET for transferType "undeployed" ("idle, not yet
  decided"). getTransfers backfill and migrateTransferMoneyStatus now SKIP
  undeployed (everything else unset still →redeployed), so idle survives.
  MoneyStatusPill renders unset as a sky "Idle" badge. Idle undeployed counts
  toward Available (in lifetimeEarned, not withdrawn/deployed) — verified 1000.
  PART 4 — "Mark as deployed" now also applies to idle Undeployed (condition is
  transferType !== "expense" && moneyStatus ∈ {redeployed, undefined}). A
  deployed transfer of any type is visually locked (opacity-60) with the green
  "Used → PAIR" badge; editing still requires the explicit Edit button (the row
  has no casually-editable inline fields). Deploy subtracts from Available;
  undo restores — verified 1000→0→1000.
  tsc/lint/build clean.

- 3b727b2: DELIBERATE FORMULA CHANGE, user-confirmed: removed Expenses from
  Overall P&L. New formula = Current Value (active) + Converted Fees − Initial
  Capital. Overall P&L now measures pure LP business performance; personal
  spending/withdrawals are tracked separately via Available Balance on the
  Transfers page. Logging an expense now only affects Available Balance, not
  Overall P&L — this is intended, not a regression. calcOverallPnL still
  computes the `expenses` field (for reference) but no longer subtracts it;
  the shared OverallPnLCard hint (Dashboard + Total P&L) and Total P&L's
  breakdown ("− Expenses" line removed) were updated to match. Growth Target
  (positionEarnings + businessAllTotal, no expense term), Available Balance
  (lifetime − withdrawn − deployed), and Net/LP P&L (computeTotals) are all
  unaffected. Verified: 30000 + 1500 − 25000 = 6500, and a 500 expense leaves
  Overall P&L at 6500 (was 6000 with the old subtraction).

- 9633297: DELIBERATE FINANCIAL FIX, user-approved: Overall P&L's
  Converted Fees now counts a claim's stablecoin portion even when the claim
  overall is marked "not converted" (since a stable leg was never volatile and
  never needed converting). Previously the whole claim was excluded,
  understating Overall P&L. Volatile portions of a claim still only count when
  marked converted. Clamped to the claim's typed total when known, to guard
  against a mistyped value over-counting.
  RULE (one source, lib/calculations.ts): claimStableFace(claim) sums
  tokenAmount across stable-symbol legs (isStableSymbol — same stable set as
  everywhere else); claimStableRealized(claim) is the "not converted" half —
  0 when converted (that branch counts the full stableAmount as before),
  otherwise min(stableFace, stableAmount ?? stableFace), floored at 0.
  calcOverallPnL AND the diagnostic both call claimStableRealized, so the
  reported recovery can never disagree with the figure actually added
  (Invariant #6). A "No" claim with NO stable leg still contributes $0 —
  unchanged. A "No" claim with stableAmount null still contributes its stable
  leg's face value (approved decision #1); the clamp is approved decision #2.
  SCOPE: calcOverallPnL only. getEffectiveClaimed/getEffectiveTotalFees
  (which count stableAmount regardless of conversion, Invariant #10),
  calcUnconvertedHoldings, calcBusinessPnL, Growth Target and Net/LP P&L are
  all untouched — verified live, Total Fees Earned $1,230 and Net P&L
  $10,430 identical while Overall P&L moved $15 → $362.
  OverallPnL gained mixedStableClaims/mixedStableRecovered, so both
  EMPTY_OVERALL literals (app/page.tsx, app/total-pnl/page.tsx) needed the
  new fields — they are still two literals, keep them in step.
  IN-APP DIAGNOSTIC (real-data reporting): the affected count/dollars cannot
  be computed outside the user's browser (localStorage — same limit as
  c372b30/666ec71), so components/MixedStableRecoveryCard.tsx reports it live
  on the Dashboard: mixed-claim count, dollars recovered, Overall P&L before
  → after (before = overall − mixedStableRecovered, exact by construction),
  and an expandable per-claim list flagging clamped and null-total rows.
  One-time: "Got it, hide this" persists clp_mixed_stable_notice, deliberately
  NOT in the Settings backup keys (it gates no calculation). Read-only — it
  never rewrites a claim.
  Verified against the compiled module and live on localhost:3001 with a seed
  covering every case: mixed "No" 5 USDC + 1 SUI (typed 15) → +$5; converted
  claim → $15 unchanged; converted-but-unvalued → $0 + unvalued count 1;
  pure-volatile "No" (ETH/BTC) → $0; clamp (500 USDC leg, typed 300) → +$300;
  null-total mixed (42 USDC) → +$42; stable-only "No" (USDC+USDT, no typed
  total) → +$15. Card showed 3 claims / +$347.00 / $15.00 → $362.00, matching
  the Overall P&L card exactly; dismissal persisted across reload. Zero
  console errors; seeds removed. tsc/lint/build clean.

- 59d71a2: Business P&L manual price override — real bug fixed + explicit
  "Reset to Auto" (2026-07-28). Part 2 (Fee Claims status filter moved into the
  filter row) is UI-only.
  ROOT CAUSE (reproduced live, not guessed): the Current Price input is
  UNCONTROLLED (defaultValue + a key derived from row.price) and committed
  ONLY on blur (onBlur → setPrice). Enter — the natural commit gesture — did
  nothing. So a user who cleared the field and pressed Enter saw an EMPTY price
  box while settings.prices still held the override: the row stayed tagged
  MANUAL and the USD column kept using the stale manual price (reproduced: box
  blank, tag MANUAL, stored ETH 3000, USDC Amount $6,000.00). Refresh could not
  rescue them because manual deliberately wins over fetched (Sprint 8.5), so
  the override was effectively permanent — the reported "stuck on MANUAL
  indefinitely". Clearing the field DOES work when the input actually blurs;
  the bug was the gesture, not the delete logic in setPrice.
  FIX: (1) onKeyDown on the price input — Enter commits (blur), Escape reverts
  the field to the displayed price and blurs, so the visible value and the
  stored override can no longer diverge. (2) An explicit "Reset to Auto" link
  beside every MANUAL tag calling resetToAuto(token) (deletes the key, nothing
  else) — reads "Clear" instead when that token has no fetched price, so the
  label never promises an auto price that does not exist. (3) Hint text now
  states plainly that a manual price survives Refresh on purpose and that
  "Reset to Auto" is how you abandon one.
  REFRESH RELATIONSHIP (confirmed, unchanged): Refresh still never overwrites a
  manual override — verified live, SOL (AUTO) moved 73.4 → 73.39 while ETH
  (MANUAL 4321) held. That behaviour is correct; it just needed a visible
  escape hatch, which is what "Reset to Auto" is.
  SECOND REAL BUG FOUND while investigating: manual prices are keyed by the
  table's token symbol, which has been NORMALIZED (WETH→ETH) since 2ef8ca5.
  Overrides saved before that merge are keyed by the raw symbol, so they have
  no row to edit and NO way to be cleared — invisible and permanent. The page's
  hydrate now folds settings.prices keys through normalizeToken once and
  re-saves (canonical key wins if both exist). Verified: a stored
  {WETH:9999} surfaced as an editable, resettable ETH row.
  PART 2 (UI only): the standalone "All / Open only / Closed only" pill row on
  Fee Claims is gone; the same filter is now a FilterSelect labelled "Status"
  in the same grid as Position/Platform/Chain (now sm:grid-cols-2
  lg:grid-cols-4), relabelled "All positions" / "Open positions" / "Closed
  positions". Same filters state, same predicate — verified all three states
  return identical rows to the old toggle (all 3 claims / open 2 / closed 1,
  and back).
  tsc/lint/build clean; zero console errors; seeds removed.

- Transfers: inert Expense status, settled-row lock, position-scoped bulk mark
  (2026-07-30). Four related fixes from user testing. Both Part 1 and Part 2
  root causes were MEASURED live against a seeded 5-transfer set, not assumed.
  PART 1 — "Mark as deployed missing on Out-of-Range-Upside / Fees": NOT a
  transferType gate. Measured: with moneyStatus "redeployed"/idle, Fees, Out of
  Range Upside AND Undeployed Tokens all offered the action (["Edit","Mark as
  deployed","Delete"] on each). The only row that lacked it was the one whose
  moneyStatus was "expense" — which is correct behaviour (expensed money has
  left the business, there is nothing to deploy). What made it look like a
  per-type bug is the interaction with Part 2: the user marked an upside
  transfer as Expense, saw no balance change (Part 2), and the deploy action
  silently disappeared. So the real defect was Part 2 plus a silent
  disappearance. Fix: the gate is now a named `canDeploy` documenting that it is
  type-agnostic, and an Expense-marked non-expense transfer now SAYS why the
  action is gone ("Switch Money Status back to Redeployed in Edit"). No
  behavioural change to which rows can deploy — verified an upside transfer
  regains "Mark as deployed" the moment its status returns to Redeployed.
  PART 2 — REAL BUG, and NOT upside-specific (a Fees transfer reproduced it
  identically): nothing on the page read moneyStatus for money. The balance memo
  computed lifetimeEarned − withdrawn − deployed only, and since 3b727b2
  removed expenses from Overall P&L, a transfer marked "expense" affected
  NOTHING anywhere — a pill and nothing else. Reproduced: a $50 Expense-marked
  fees transfer left Available at $1,025.00 (= 1050 − 25 − 0) and never appeared
  in Expenses & Withdrawals. Fix: `expensed` = Σ amount where moneyStatus ===
  "expense" is now subtracted from Available and added into the Expenses /
  Withdrawn card, and the Expenses & Withdrawals table lists expense-marked
  transfers alongside logged withdrawals (footer renamed "Total Out of
  Business"). Transfer-backed ledger rows are Edit-only (tagged FROM TRANSFER) —
  the transfer list above stays the single source of truth for the record.
  DOUBLE-COUNT GUARD: `deployed` now skips rows whose moneyStatus is "expense",
  so the two subtractions are mutually exclusive by construction — verified,
  bulk-expensing a deployed row moved Deployed 500 → 400 rather than deducting
  it twice. NOTE the legacy transferType "expense" records (positionId "", from
  the retired Log-Expense-as-transfer flow) now net to zero in Available instead
  of inflating it; that is the correction, not a regression. Overall P&L is
  untouched — 3b727b2's formula stands.
  PART 3 — visual lock extended from Deployed to Expense: `isSettled =
  isDeployed || isExpensed` drives the opacity-60 dim, since both mean "settled,
  not idle". Changing either still needs an explicit Edit click.
  PART 4 — the bulk-select mechanism from b7755cb SURVIVED the Needs-Review
  retirement (69bfc13 removed only the review filter), so it was extended, not
  rebuilt. Added a PositionCombobox position filter to the Transfers list (same
  shared component as Fee Claims / Add Transfer, `allValue=""`), folded into
  sortedFiltered so it composes with the type filter, search and chain grouping
  for free. When it narrows to one position, a selection-free "Mark all N shown
  as Redeployed / as Expense" appears behind a confirm. pendingBulk became
  {status, scope} where scope is "selected" | "visible"; applyBulkMark still
  intersects with visibleIds, so a bulk mark can only ever touch rows on screen,
  and it still writes moneyStatus alone (transferType and deploy-links
  untouched).
  Verified live on localhost:3001 with a seeded 2-position / 5-transfer /
  1-withdrawal set: expense $50 → Available $1,025 → $975 and the row joined the
  ledger; deploying the Out-of-Range-Upside $400 → Deployed $400, Available
  $575, "Used → SUI/USDC", row dimmed; deploying the Fees $100 → Deployed $500,
  Available $475; only the Expense row dimmed among non-deployed rows (0.6 vs
  1); position filter → 3 rows and "Mark all 3 shown"; bulk Redeployed flipped
  the idle row with balances unmoved; bulk Expense → Expenses $675, Deployed
  $400, Available −$25 (= 1050 − 675 − 400, exact); individually editing one
  back to Redeployed → Expenses $475, Available $175; Remove deploy link →
  Deployed $0, Available $575. Zero console errors; seeds removed.
  tsc/lint/build clean.

- a6df1f0: DELIBERATE BALANCE CHANGE, user-confirmed: added a
  "Transferred to Platforms" state — a Redeployed transfer with a Platform
  assigned is now excluded from Available Balance (previously stayed included).
  Added individual and bulk "Send to Platform" actions across Fees/
  Out-of-Range-Upside/Undeployed Tokens transfers. Transferred/Deployed money
  can later convert to Expense without double-subtracting Available Balance.
  Same visual lock as Deployed/Expense applied to Transferred rows.
  DERIVED, NOT STORED (the design call): "Transferred" is computed from the
  existing platform field rather than a new flag — the Platform column already
  means "this money is sitting at X", the Edit form has always written it, and
  a derived state needs no schema change and no migration. The consequence is
  the balance change itself: every existing transfer that already carries a
  platform became Transferred the moment this shipped.
  FOUR STATES, MUTUALLY EXCLUSIVE BY CONSTRUCTION (app/transfers/page.tsx, top
  of file): isExpensedTransfer → isDeployedTransfer → isTransferredToPlatform →
  isIdleTransfer, each re-testing the states above it in that precedence order.
  That is what makes double-subtraction impossible: Available = Lifetime Earned
  − Expenses/Withdrawn − Deployed − Transferred, and a row that is both
  deployed AND platformed counts once (as Deployed), while one later marked
  Expense counts once (as an Expense) and leaves its old bucket. Do not
  "simplify" these predicates into independent tests — the re-tests ARE the
  no-double-count guarantee.
  The state keys off platform/deploy-link, NOT off moneyStatus "redeployed"
  specifically, so an idle Undeployed Tokens transfer (moneyStatus unset since
  d20f3e3) can reach Transferred too; its row then shows a "Sent → PLATFORM"
  badge that supersedes the otherwise-misleading "Idle" pill.
  ACTIONS: per-row "Send to Platform" / "Change platform" / "Remove platform"
  (SendToPlatformModal, free text + datalist of platforms already in use,
  stored uppercase) gated by canSendToPlatform = canDeploy — type-agnostic, so
  Fees, Out of Range Upside and Undeployed Tokens all get it; hidden only once
  the money is an Expense. Bulk: an inline platform input beside the existing
  position-scoped bulk toolbar sends every STILL-IDLE visible row at once
  (bulkPlatformTargets = searchedFiltered.filter(isIdleTransfer)) behind a
  confirm — already-platformed rows are deliberately excluded from the bulk
  count and must be re-routed one at a time.
  SIDE FIX (real pre-existing bug, found via Part 6): handleEdit rebuilt the
  record from buildTransfer alone, which knows only the form's fields — so
  editing a transfer silently DROPPED sourceClaimId, sourceCloseId and the
  deploy-link. Marking a deployed transfer as an Expense through Edit therefore
  lost its deploy-link and its idempotency id (letting a backfill re-create the
  same transfer). handleEdit now carries those three across explicitly.
  KNOWN PRE-EXISTING QUIRK (not changed here): Platform is a `required` input
  on the Edit Transfer form, so an auto-created transfer (platform blank by
  design, 666ec71) cannot be saved from Edit without typing one. Use the bulk
  actions or Send to Platform instead.
  Verified live on localhost:3001 with a seeded 2-position / 5-transfer /
  1-withdrawal set (lifetime $1,050), before-numbers captured by stashing the
  diff: BEFORE Available $975 (= 1050 − 25 withdrawn − 50 deployed, with a
  $300 AAVE-platformed transfer still counted as idle) → AFTER Transferred
  $300, Available $675 — the real impact of the change. (A) Send to Platform on
  an idle $100 Fees row → KRAKEN, Transferred $400, Available $575, exactly
  −$100. (B/C) position-filtered bulk showed "Send all 2 idle shown" (correctly
  skipping the already-platformed row) and sent the $400 Out-of-Range-Upside
  and $200 Undeployed rows to AAVE BASE → Transferred $1,000, Available −$25
  (= 1050 − 25 − 50 − 1000). (D) editing the Transferred $100 row to Expense:
  Expenses $25 → $125, Transferred $1,000 → $900, Available UNCHANGED at −$25,
  row joined Expenses & Withdrawals as FROM TRANSFER. (F) bulk-expensing a
  Transferred $300 AND a Deployed $50 at once: Expenses → $475, Deployed → $0,
  Transferred → $600, Available still −$25; buckets partition exactly
  (475 + 0 + 600 = 1050 + 25). (E) all settled rows dimmed at opacity-60,
  including Transferred. (G) Overall P&L $1,000.00 (= 21,000 active + 0
  converted − 20,000 capital) never moved while Expenses went $25 → $475 —
  transfers do not feed it (3b727b2). Edit round-trip confirmed sourceClaimId /
  deployedToPositionId / deployedAt survive. Zero console errors; seeds
  removed. tsc/lint/build clean.

- 037abcc: Made Platform optional on Edit Transfer. Added soft-delete +
  Recently Deleted/Restore for Transfers — deleting no longer permanently erases
  data; deleted transfers are recoverable indefinitely unless explicitly
  permanently deleted via a separate, confirmed action.
  PART 1: the Platform input was `required`, so ANY unrelated edit (a notes
  typo, a money-status change) could not be saved on the auto-created transfers
  that deliberately carry a blank platform (666ec71) — the quirk logged in
  a6df1f0. The attribute is gone and the hint now says "optional. Filling this
  in marks the money as Transferred to that platform." Nothing else changed:
  the Transferred state is driven by the field's VALUE, never by the form
  validating it, so Send to Platform / Change platform / Remove platform behave
  exactly as before (re-verified live).
  PART 2 — WHERE THE FILTER LIVES (the design call): Transfer gained an
  optional `deletedAt`, and lib/storage.ts now splits into getAllTransfers()
  (everything, for the bin and the plumbing) and getTransfers() (live only,
  = the old behaviour minus deleted rows). Filtering ONCE at the storage layer
  is what makes a soft-deleted transfer behave exactly like a fully deleted one
  in every reader without touching any of them — Available Balance, Lifetime
  Earned, Deployed, Transferred, Expenses, By Token/Destination, chain
  grouping, Data Health, the Sidebar count, the Settings CSV export and the
  automation/backfill dedup all excluded it with zero changes.
  THE TRAP, AND THE GUARD: almost every mutation in the app is shaped
  saveTransfers(getTransfers().map(...)), and getTransfers() no longer returns
  deleted rows — so a plain overwrite would have silently emptied the bin on
  the next edit ANYWHERE in the app (including the position-delete cascade in
  app/positions/page.tsx). saveTransfers therefore re-attaches any soft-deleted
  record missing from the incoming list. Do not "simplify" it back to a raw
  write. Because of that merge, purging needs its own raw-write path:
  purgeTransfer(id). Helpers are softDeleteTransfer / restoreTransfer /
  purgeTransfer; restore drops ONLY deletedAt, so platform, destination,
  deployedToPositionId/deployedAt, sourceClaimId/sourceCloseId and notes all
  come back untouched (verified byte-for-byte).
  UI: RecentlyDeletedSection on the Transfers page, above the balance cards,
  collapsed by default and styled like Show/Hide Closed Positions. Hidden
  entirely at zero rows. Each entry shows amount, date, type, money status,
  deletion date, platform, destination, token, deploy-link and notes, with
  Restore and a separately-labelled "Permanently delete" behind its own
  two-step confirm ("Yes, delete forever") and explicit no-undo copy. No expiry
  sweep — deleted transfers are kept indefinitely because this is financial
  history. The row's delete confirm now reads "You can restore it from Recently
  Deleted."
  JUDGMENT CALLS: (1) Platform is optional on ADD too — the form is shared, and
  a blank platform is already a valid state (that is what "idle" money is).
  (2) The position-delete cascade still HARD-deletes its live linked transfers
  (unchanged, per scope), but no longer disturbs soft-deleted ones; a deleted
  transfer whose position was later removed stays restorable and shows "—" for
  its pair. (3) A soft-deleted auto transfer is invisible to the backfill dedup,
  so a backfill can legitimately re-create it — deleted means gone.
  Verified live on localhost:3001 with a seeded 2-position / 5-transfer /
  1-withdrawal set (lifetime $1,050, expenses $75, deployed $300, transferred
  $400, available $275): (A) a blank-platform auto transfer (sourceClaimId C1)
  saved a notes-only edit — previously impossible — with platform still "" and
  the claim id intact. (B) deleting the rich $300 transfer (deploy-link,
  platform KRAKEN, destination RAKA, notes, sourceCloseId): Lifetime $1,050 →
  $750, Deployed $300 → $0, Total Transfers 5 → 4, By Token ETH 2/$350 →
  1/$50, the RAKA destination row gone; Available correctly held at $275 since
  that money was already in the Deployed bucket. (C) it appeared under "Show
  Recently Deleted (1)" with every field shown. (D) Restore returned every
  total to the exact pre-delete figure and the stored record matched
  field-for-field with deletedAt cleanly absent. Mutating an unrelated transfer
  while one sat deleted did NOT wipe the bin (the merge guard). (E) deleting
  the $200 Undeployed row moved Lifetime $1,050 → $850 and Available $275 →
  $75, then "Permanently delete" required its own confirm and left 4 records in
  storage with that id genuinely gone and the section hidden. (F) deleting
  position ETH/USDC removed the position and its LIVE transfer exactly as
  before (modal counted "1 transfer", not the deleted one) while the
  soft-deleted record survived in the bin; diff touches only
  app/transfers/page.tsx, lib/storage.ts and lib/types.ts — no positions or
  claims delete code. Zero console errors; seeds removed. tsc/lint/build clean.

- 16b9f6a: Added Delete inside Edit Expense/Edit Transfer modals (same
  soft-delete behavior as row-level Delete). Verified Available Balance
  correctly updates when an Expense is deleted. Added "Revert to auto-created"
  for automation-created transfers — recomputes fresh from the linked
  claim/close's current data using the same logic the automation itself uses,
  discarding manual edits after explicit confirmation.
  PART 1: FormActions (the shared modal footer) gained an optional onDelete,
  rendered as a left-aligned Delete with its own inline confirm. Both edit
  modals pass handleDeleteFromModal, which calls the SAME softDeleteTransfer as
  the row action — there is deliberately no second delete path, so a record
  deleted from a modal lands in Recently Deleted and restores identically.
  Add mode passes no onDelete, so the button only exists when editing.
  PART 2 — MEASURED, AND THE ANSWER IS NOT WHAT IT LOOKS LIKE. Deleting an
  Expense-STATUS transfer leaves Available Balance UNCHANGED, and that is
  correct: the transfer's amount sits in Lifetime Earned as well as in the
  Expenses bucket, so removing the record drops it from both sides at once
  (measured: Lifetime $2,100 → $1,950, Expenses $210 → $60, Available $1,890
  both before and after — 2100−210 = 1950−60). This is the same "nets to zero"
  property recorded in the 2026-07-30 entry. The case where Available DOES rise
  by exactly the amount is a LOGGED expense/withdrawal (the Log an Expense
  button, stored in clp_withdrawals), which is not part of Lifetime Earned —
  measured: deleting a $60 withdrawal moved Available $1,890 → $1,950. Do not
  "fix" the first case to behave like the second; that would double-count.
  PART 3 — RECOMPUTATION, NOT A SNAPSHOT: planRevertToAuto /
  applyRevertToAuto / isAutoCreated in lib/transferAutomation.ts. The plan runs
  the SAME buildClaimTransfers / buildUpsideTransfer the automation uses
  (including the dual-token historical-price split via /api/prices/historical),
  so there is no second copy of the logic and it works retroactively on every
  auto transfer ever created — no migration, no stored original.
  WHOLE-GROUP REVERT (the design call): a dual-token claim owns TWO transfers
  whose amounts are computed against each other, so reverting one leg alone
  could not reproduce the split. The plan therefore targets the whole source
  group (all rows sharing that sourceClaimId/sourceCloseId), previews every
  leg, and rebuilds them together. Existing record ids are carried over in
  order (alignIds), so a revert edits rows in place rather than minting new
  ones and orphaning outlier dismissals.
  Reverting discards EVERY manual edit on those rows — amount, token, platform,
  destination, money status, notes AND any deploy-link — because that is the
  state the automation produces (the same fields isUntouchedAuto tests). The
  modal says so before you confirm. Preview is computed on open (async for the
  dual case), rendered as struck-through "Now" → "After revert" per leg, and
  only written on Continue; a missing claim/position or a no-longer-positive
  scalp renders an amber explanation with Continue disabled.
  The action appears ONLY on rows where isAutoCreated is true — manual
  Undeployed Tokens, hand-logged fees and expenses never show it.
  Verified live on localhost:3001 with 3 positions / 2 claims / 6 transfers:
  (A) Delete inside Edit Expense soft-deleted the $75 legacy expense and inside
  Edit Transfer soft-deleted the $150 expense-status fees row — both landed in
  Recently Deleted, both modals closed. (B) numbers above. (C) an auto transfer
  hand-edited to $999/KRAKEN, with its claim's stableAmount then changed
  500 → 550, reverted to SUI · $550.00 · platform "" · redeployed · auto note,
  same id — proving it recomputes from the claim as it stands now. (D) the
  confirm showed "SUI · $999.00 · platform KRAKEN · redeployed" struck through
  above "SUI · $550.00 · platform (none) · redeployed, dated 10/07/2026".
  (E) side by side in one view, the auto row offered Revert while the manual
  Undeployed row (and the Expense row) did not. (F) dual ETH+WBTC claim
  ($1,000; legs mangled to $111/$889 with a platform): both legs previewed and
  rebuilt to $582.91 + $417.09 via real historical prices, summing to exactly
  $1,000.00, ids preserved. A close-sourced upside transfer mangled to
  "WRONG · $1.00 · AAVE" reverted to USDC · $275.00 after its position's Scalp
  was changed 250 → 275. The two soft-deleted rows survived every one of these
  writes (the saveTransfers merge guard). Zero console errors; seeds removed.
  tsc/lint/build clean.

- 9dd89d3: Added an "Unknown position" option to Mark as Deployed —
  money you know was deployed but can't place still counts as Deployed (out of
  Available Balance) without inventing a link, and can be named later. The
  position list is now ordered by how close each position's opening date is to
  the transfer. Also: checking a row's checkbox expands it in the same click
  (UI only).
  SENTINEL, NOT A NEW FIELD: deployedToPositionId carries
  UNKNOWN_POSITION_ID = "__unknown_position__" (app/transfers/page.tsx, beside
  the money-state predicates). Reusing the same field is what makes this a
  ~10-line feature: every PRESENCE-based reader — the Deployed bucket in the
  balance memo, isDeployedTransfer, isUntouchedAuto in transferAutomation —
  treats it exactly like a real link with no change at all, so the four-state
  precedence (Expense > Deployed > Transferred > Idle) and its
  no-double-counting guarantee carry over untouched. Only the label needs to
  know: deployedLabelOf() is now the single place that names a deploy-link
  (used by both the row badge and the Recently Deleted entry) and returns
  "Unknown position" for the sentinel rather than implying a pair. The
  double-underscore form cannot collide with a stored position id
  (crypto.randomUUID). No schema change, no migration.
  EDITABLE LATER (this is what makes picking "unknown" safe): a deployed row
  previously offered only "Remove deploy link", so there was no way to CHANGE a
  link. It now offers "Change position" alongside it, opening the same modal
  with the current value preselected.
  DATE-PROXIMITY ORDER: money usually goes into a position opened just AFTER it
  arrives, so proximityRank sorts by |opened − transfer date| with a 1.5x
  penalty on positions opened BEFORE, putting the nearest-after first while
  still surfacing near-misses on the other side. Existing conventions are
  preserved: active-before-closed stays the PRIMARY key (proximity only
  reorders within each group), closed rows keep their "(closed)" tag, and pair
  name remains the final tiebreak. Each option now shows its opening date, and
  the field hint says plainly it is a memory aid, not a guess. This is the
  DeployLinkModal's own <select>; the shared PositionCombobox (Fee Claims, Add
  Transfer, the Transfers position filter) is untouched, so its chain grouping
  and most-recent-first order are unaffected.
  CHECKBOX EXPANDS (Part 1): checking a row calls setOpen(true) before
  onToggleSelect — if you are singling a row out for a bulk action you want to
  see what it is. UNCHECKING DELIBERATELY LEAVES IT OPEN: collapsing would pull
  details out from under someone still reading, and would also silently undo an
  expansion they had opened by hand before selecting. Closing stays the row's
  own toggle. Independent of, and composes with, the filtered-to-one-position
  auto-expand from 170b669.
  DRIVE-BY FIX: the modal read "Link this $500.00transfer" — the literal space
  after {formatUsd(...)} was being trimmed at build time. Now an explicit {" "}.
  Verified live on localhost:3001 (5 positions, 3 transfers, $1,000 lifetime):
  (A) one checkbox click both selected and expanded a row, on the All-positions
  view and again on a position-filtered view where rows were already expanded.
  (B) "Not sure which position" on a $500 transfer → Deployed $0 → $500,
  Available $1,000 → $500, badge "USED → UNKNOWN POSITION", moneyStatus
  untouched. (C) reopening showed "Not sure which position" preselected;
  switching to BBB/USDC gave "USED → BBB/USDC" with Deployed/Available unmoved.
  (D) for a transfer dated 10/07/2026 the list came back Unknown, BBB (opened
  12/07, +2d), DDD (08/07, −2d), CCC (25/07, +15d), AAA (05/01, −186d), then
  EEE (closed, 13/07) — nearest-after first, before-dates just behind, closed
  last. (E) marking that unknown-deployed row as an Expense moved it Deployed
  $500 → $0 / Expenses $0 → $500 with Available unchanged at $500 — subtracted
  exactly once, same precedence as a named link. Zero console errors; seeds
  removed. tsc/lint/build clean.

- 36e3595: Four Transfers UI fixes, no calculation touched. (1) REVERTED
  the filtered-to-one-position auto-expand from 170b669 — in real use it was too
  much at once. Rows now start collapsed in EVERY view; expansion comes only
  from the row's own checkbox (check opens, uncheck closes, so selecting and
  de-selecting leaves the list as it found it) or its header toggle. Deliberately
  NOT wired to "select all visible" — that would re-create the bulk expansion
  just removed. (2) Out-of-Range-Upside rows show the linked position's
  "Opened DD/MM/YYYY · Closed DD/MM/YYYY" instead of one bare date: that transfer
  is the profit from ONE close, and a single date can't say which close on a pair
  opened and closed more than once. Other types keep the plain transfer date;
  falls back to it if the position is missing or still open. (3) The Mark as
  Deployed picker tags positions that already hold deployed money — "· already
  has $X deployed" — counted through isDeployedTransfer, the same predicate as
  the Deployed balance card, so picker and card can never disagree.
  Informational only; picking the same position again (a top-up) is still
  allowed. (4) Position combobox dropdown "blur/overlap glitch" FIXED — and the
  cause was NOT what it looked like. MEASURED: elementFromPoint put the panel on
  top across its whole rect and its background computed to an opaque
  rgb(17,19,25), so nothing was painting over it. What it lacked was separation:
  `shadow-xl` resolved to "rgba(0,0,0,0) 0px 0px 0px 0px" — Tailwind's shadow
  colour variable does not resolve here, so the class rendered NO shadow at all.
  A #111319 panel on a #0a0b0f page with only a 1px border, with the list's rows
  and rules continuing either side of it, reads as content bleeding through and
  shifts as you scroll. Fixed with an explicit
  shadow-[0_18px_45px_-8px_rgba(0,0,0,0.85)] (no dependency on the shadow colour
  variable) plus ring-1 ring-black/40, and z-30 → z-40 (still below the z-50
  modal layer). NOTE for future work: `shadow-*` utilities appear to be inert in
  this project — use explicit arbitrary shadows.
  Verified live on localhost:3001 (7 positions, 6 transfers, $1,600 lifetime):
  (A) on All positions, on a type filter (Out of Range Upside) and on a
  position filter (BBB/USDC), rows arrived 0-expanded; checking one box gave
  exactly 1 expanded row and unchecking returned it to 0 — identical in all
  three. (B) the upside row read "Opened 13/05/2026 · Closed 28/05/2026",
  matching its position's stored entry/exit exactly, while every other row kept
  its single date. (C) the picker showed "already has $100.00 deployed" on
  BBB/USDC and "$550.00" on CCC/USDC (= the $650 Deployed card, 100 + 400 + 150)
  with the five untouched positions unmarked, date-proximity order and
  closed-last intact. (D) the panel rendered cleanly at three scroll positions
  with a real measured shadow. (E) balances held at $1,600 / $0 / $650 / $0 /
  $950 throughout. Zero console errors; seeds removed. tsc/lint/build clean.

- 91950ab: Position dropdown "bleed-through" — REAL root cause found,
  distinct from the 36e3595 shadow fix. Plus a red "fully expensed" indicator on
  positions in both pickers. No calculation touched.
  PART 1 — IT WAS NEVER A STACKING BUG, and 36e3595 treated a symptom. Evidence:
  elementFromPoint over a 13x13 grid inside the open panel, at six scroll
  positions including the exact one from the bug report, returned the panel or
  its own children at ALL 169 points every time — 0 foreign hits. The suspected
  culprit, the bulk toolbar's "Platform (e.g. AAVE)" input, computes to
  position:static / z-index:auto and therefore cannot paint above a z-40
  absolutely-positioned element; the screenshot that looks like its placeholder
  showing through is actually correct occlusion (the "P" is hidden behind the
  panel edge, "latform…" continues beyond it).
  THE ACTUAL CAUSE, measured: the panel painted in --surface rgb(17,19,25) while
  the card it floats over is ALSO --surface rgb(17,19,25) — byte-identical
  backgrounds separated by a single 1px border — and the panel is ~549px wide
  inside a ~1152px card, so row amounts and toolbar controls sit at the same
  vertical positions immediately either side of it and read as continuing
  through it. Correct occlusion with zero visual separation, and it changes as
  you scroll past different content, which is exactly what the user described.
  36e3595's missing shadow was a contributing factor, not the cause.
  FIX: a new --surface-raised (#1e2431) token in globals.css, deliberately
  lighter than both the card (#111319) and the page (#0a0b0f), for any panel
  that overlays a card. The dropdown and its sticky search header use it, with
  the explicit shadow kept and ring-1 ring-white/10 for an edge. Interior tints
  had to move off --surface-2 (now DARKER than the panel) to white/10 hover and
  white/[0.06] chain headers. Verified: panel bg now rgb(30,36,49) vs card
  rgb(17,19,25), 0/169 foreign hits at six scroll positions, visually a clearly
  raised layer at every one. STILL TRUE from 36e3595: Tailwind's shadow-*
  utilities render nothing in this project — use explicit arbitrary shadows.
  The orange circle in the user's screenshot is the macOS dictation button, not
  app UI — confirmed unrelated.
  PART 2 — fullyExpensedPositions: a position is flagged only when it has ≥1
  transfer AND every transfer carrying its positionId is Expense-status. One
  non-expense transfer disqualifies it (partial expensing is not "fully"), and a
  position with no transfers is excluded by construction since the tally only
  records ids it has seen. positionNote() is the single source for BOTH picker
  hints, shared by DeployLinkModal and the Transfers position filter so they can
  never word it differently; fully-expensed takes the slot when both could
  apply, though they are mutually exclusive in practice (deployed money is by
  definition not expensed).
  PositionCombobox gained an OPTIONAL noteFor prop — callers that pass nothing
  (Fee Claims, Add Transfer) render exactly as before, verified 0 notes there.
  In the combobox the note renders in real rose-400. In DeployLinkModal it is a
  native <option>, which macOS draws itself and will not reliably colour, so the
  danger case also carries a "⚠" text marker — the words, not the red, are what
  has to survive.
  Verified live (7 positions, 7 transfers): AAA/USDC with both its transfers
  Expense → red "· fully expensed" (computed lab(64.41 63.03 19.21) = rose-400)
  in the combobox and "· ⚠ fully expensed" with class text-rose-400 in the
  modal; BBB/USDC with 1 of 3 Expense → NO indicator; CCC/USDC → the muted
  "already has $550.00 deployed" and no red; DDD/EEE/FFF/GGG with zero transfers
  → nothing. No option ever showed both. Balances held at $1,560 / $310 / $550 /
  $0 / $700 throughout. Zero console errors; seeds removed. tsc/lint/build clean.

- ef1d96a: Mark as Deployed's native <select> replaced with the shared
  PositionCombobox, so the red "fully expensed" warning renders as real colour
  instead of leaning on a ⚠ glyph (macOS draws select popups itself and ignores
  option colour). Search, chain grouping and the Open/Closed split come with it,
  matching every other picker. UI only — no calculation changed.
  THE "UNKNOWN POSITION" ENTRY rides in on the combobox's existing allValue slot
  (allValue={UNKNOWN_POSITION_ID}, allLabel="Not sure which position (deployed,
  unknown)"), so it stays pinned above the chain groups and selectable without
  the component needing a second concept. That required two small fixes to
  PositionCombobox, because it had only ever been used with allValue="":
  selectedLabel now returns the PLACEHOLDER for an empty value instead of
  falling through to allLabel (otherwise an untouched picker would have claimed
  "Not sure which position" was already chosen), and isPlaceholder treats "" as
  a placeholder in all cases. Both are no-ops for allValue="" callers, verified
  live.
  DATE-PROXIMITY SURVIVED THE MOVE: the combobox owns the grouping, but the
  order WITHIN a chain's Open/Closed section is now an optional
  sortWithinSection prop, defaulting to the existing most-recent-first. Mark as
  Deployed passes the 9dd89d3 proximity comparator, so its nudge is intact
  rather than silently dropped — verified BASE listing DDD (08 Jul, −2d) before
  CCC (25 Jul, +15d), and SUI listing BBB (12 Jul, +2d) before AAA (02 Jul,
  −8d), which most-recent-first would have reversed.
  Verified live (5 positions, 7 transfers): AAA/USDC (all its transfers Expense)
  showed "· fully expensed" in lab(64.4125 63.0291 19.2068) = rose-400 and
  visibly red in a zoomed screenshot, no ⚠ fallback; CCC/USDC kept the muted
  "already has $550.00 deployed"; BBB (1 of 3 Expense) and the transfer-less
  positions showed nothing. Zero <select> elements remain in the modal. Search
  by pair ("aaa" → AAA/USDC), by chain ("solana" → EEE/USDC), the "No positions
  match" empty state and clearing back to all 6 entries all work. Selecting
  "Not sure which position" → Confirm stored __unknown_position__, Deployed
  $550 → $1,050, Available $700 → $200, badge "USED → UNKNOWN POSITION";
  reopening preselected it, switching to DDD/USDC stored PD and flipped the
  badge with balances unmoved. The other three call sites are untouched:
  Transfers filter still reads "All positions", Add Transfer still reads
  "— Select position —" in muted. Zero console errors; seeds removed.
  tsc/lint/build clean.

- 6a2f0d1: REAL layout overlap in the position dropdown — a different
  bug from 91950ab's contrast fix, and this one was a genuine paint-order
  failure. The sticky search header carried NO explicit z-index, so options
  scrolling under it could paint OVER it. One-line fix: `z-10` on the header.
  EVIDENCE (measured, and reproduced only with a list long enough to scroll
  INSIDE the panel — 40 positions, 2652px of content in a 318px viewport):
  hit-testing 5 points inside the stuck header returned an option BUTTON instead
  of the header at scrollTop=1600 ("XXHHX"), and a zoomed screenshot showed an
  option's text — "Jul 2026 · dep $2.50 · now $10,500.00" — drawn straight
  across the search input. Controlled experiment, same DOM, one property
  changed: setting the header's z-index to 1 from the console made all points
  pass at every offset; removing it brought the failure back. That is why the
  earlier passes missed it — every previous probe used a SHORT list that never
  scrolled internally, so nothing ever scrolled under the header.
  WHY IT IS INTERMITTENT: a `position: sticky` element with `z-index: auto`
  does not reliably win against later-in-DOM in-flow siblings whose boxes
  overlap it, so whether an option paints over the header depends on which
  option happens to straddle it — i.e. on the exact scroll offset. The opaque
  background is NOT sufficient on its own; it only hides what paints below it.
  Chain/section headers (chain name, Open/Closed Positions) were checked as part
  of this and are `position: static` — they scroll normally and cannot overlap
  anything.
  Verified after the fix: header z-index computes to 10, and 0 failures across
  25 scroll offsets x 36 hit-test points (900 probes) on the same 2652px list
  that failed before, plus a clean screenshot at the previously-failing
  scrollTop=1600. tsc/lint/build clean.
  TESTING NOTE for anything sticky inside a scroll container: probe with a list
  long enough to scroll WITHIN the container, at many offsets. A short list
  proves nothing.

- 61b2e1a: "Fully expensed" is now judged PER TRANSFER TYPE, not across
  a position as a whole (user decision after the 6a2f0d1 investigation). Display
  only — no calculation changed.
  WHY: the combined rule hid the answer people actually want. The reported
  SUI/USDC (0.175%) BLUEFIN position had 11 Fees transfers ALL expensed plus one
  Out-of-Range-Upside still Redeployed, so the single check said "not fully
  expensed" and showed nothing — technically true, useless in practice. Fees and
  close-profit are separate pots; read together, both became invisible.
  RULE, per category: at least one transfer of that type AND every one of them
  Expense-status. A type with no transfers is never reported, which falls out of
  the tally only recording types it has seen. Categories are independent — Fees
  can qualify while Upside does not, and vice versa.
  UNDEPLOYED TOKENS IS INCLUDED, and is the rare one: those rows are hand-logged
  idle capital carrying an UNSET money status by design (d20f3e3), so they only
  reach Expense if the user deliberately edits them. Left out it would have been
  a silent gap in a rule asked for "per type"; included it costs one line, and an
  idle row correctly blocks its own category.
  FORMATTING: qualifying categories are combined into ONE note rather than one
  note each — "Fees fully expensed", "Fees & Upside fully expensed", "Fees,
  Upside & Undeployed fully expensed". They share a predicate and a warning, so
  repeating "fully expensed" per type would trade a compact row for noise.
  BOTH NOTES CAN NOW SHOW AT ONCE. noteFor returns an ARRAY (PositionCombobox
  renders each), because the two hints describe unrelated things: fully-expensed
  reads the transfers BELONGING to a position, while "already has $X deployed"
  reads transfers POINTING AT it as a deploy target — usually from other
  positions entirely. The old single-slot version let the red one hide the
  deployed one.
  Verified live in BOTH pickers (main Position filter and Mark as Deployed),
  5 positions / 20 transfers: (A) 11 fees expensed + 1 upside redeployed →
  "· Fees fully expensed" in rose-400, the exact case that showed nothing
  before; (B) all three types expensed → "· Fees, Upside & Undeployed fully
  expensed"; (C) nothing expensed → no indicator; (D) identical output in both
  pickers, screenshot-confirmed red; (E) a deploy-target-only position still
  shows just "· already has $500.00 deployed", and a position that is BOTH
  fees-expensed and a deploy target shows both notes side by side.
  tsc/lint/build clean.

- b112301: Two Transfers changes. (1) Row expansion is GONE — a
  transfer's actions moved into the toolbar, shown when exactly one row is
  selected. (2) Settled-state indicators now describe mixed states, not just
  uniform ones. Display only; no calculation changed.
  PART 1 — TransferListRow is now a plain <label>: checkbox, Pair, Amount,
  Date(s), Type pill, Money Status pill, settled badge. No caret, no open state,
  no detail grid, no per-row buttons (verified: 0 buttons and 0 <dl> grids
  inside rows). Platform / Destination / Token / Notes are no longer in this
  view at all — they live in Edit, the user's explicit call. The whole
  check-expands-the-row mechanism from 36e3595/91950ab is removed.
  SingleTransferActions renders in the toolbar when exactly ONE visible row is
  selected: Edit, Mark as deployed (or Change position + Remove deploy link),
  Send to Platform (or Change platform + Remove platform), Revert to
  auto-created (only when isAutoCreated), Delete. EVERY gate is carried over
  unchanged from the row, including the conditional variants and the note
  explaining why an expensed transfer offers neither deploy nor platform —
  dropping those would have lost real functionality, so they moved rather than
  being simplified. At 0 or 2+ selected the toolbar shows only the bulk actions:
  per-record operations have no sensible multi-target meaning.
  singleSelected is derived from the VISIBLE selection (searchedFiltered ∩
  selectedIds), so a stale id left behind a filter change can never put another
  transfer's actions on screen. Delete from the toolbar clears the selection
  after confirming, since the row it belonged to is gone.
  PART 2 — settledByPosition replaces the expense-only tally: per position, per
  transfer type, every transfer lands in exactly one bucket using the SAME
  precedence as the balance cards (expense > deployed > transferred > idle), so
  an indicator can never disagree with the money it describes. Per category:
  any idle money → say nothing (unchanged); all settled in ONE state → the
  specific label ("Fees fully expensed" / "fully transferred" / "fully
  deployed"); a MIX → a dollar breakdown listing only non-zero states,
  prefixed with the category ("Fees: $100.00 expensed, $60.00 transferred").
  The prefix is the judgment call — the user's example had none, but without it
  a position with two mixed categories cannot say which is which.
  Uniform categories sharing a state still merge into one sentence ("Fees &
  Upside fully expensed"); categories in DIFFERENT states get their own note,
  because one sentence would be wrong for at least one of them. Tone: red only
  when real money was spent (any expense component), muted when it is merely
  parked — the colour keeps meaning "gone", not "settled".
  Verified live, 5 positions / 9 transfers, in BOTH pickers: (A) selecting one
  auto-created transfer showed Edit / Mark as deployed / Change platform /
  Remove platform / Revert to auto-created / Delete beside Undo Expense and
  Mark as Expense, with rows containing 0 buttons; (B) a manually-created
  transfer showed the same minus Revert to auto-created; (C) two selected →
  only Undo Expense / Mark as Expense / Clear; (D) the CBBTC/USDC mixed case
  ($100 expensed + $60 on a platform, nothing idle) → "Fees: $100.00 expensed,
  $60.00 transferred" in red; (E) uniform categories → "Upside fully expensed"
  (red) and "Fees fully transferred" / "Fees fully deployed" (muted), no
  redundant one-item breakdown; (F) a category with one idle fee left → nothing,
  as before; "already has $500.00 deployed" still shows alongside. Zero console
  errors; seeds removed. tsc/lint/build clean.

- a367bdf: CORRECTION to b112301. Mark as deployed, Send to Platform,
  Revert to auto-created and Delete now work on the WHOLE selection (1..N), not
  only on a single selected row. Edit stays single-only — it opens one record's
  form and cannot meaningfully point at several. Display/action plumbing only;
  no calculation changed.
  ONE SELECTION MODEL. The position-scoped "Send all N idle shown to platform"
  control (its own targets, its own confirm state, its own apply function) is
  GONE, along with bulkPlatform/pendingBulkPlatform/bulkPlatformTargets/
  applyBulkSendToPlatform. Everything now reads selectedTransfers =
  searchedFiltered ∩ selectedIds, reached either by individual checkboxes or
  Select all visible. "All shown" is now just Select all visible. The
  position-scoped Undo Expense / Mark as Expense shortcuts are untouched.
  Deriving from the VISIBLE selection matters: a stale id left selected behind a
  filter change can never end up in a batch the user cannot see.
  MODALS TAKE LISTS. The deploy / platform / revert modal kinds carry
  transfers: Transfer[]; a single row is a one-element list, so there is no
  separate single-record path to drift. Each modal previews REAL counts and
  dollars before committing, and the SAME predicate decides both the preview and
  the write, so what was promised and what happens cannot diverge:
  canPlaceTransfer (module-level now, shared with the toolbar) for deploy and
  platform, isAutoCreated for revert. Delete has no eligibility filter and
  confirms inline with count + total.
  Revert plans ONE PER SOURCE GROUP, not per selected row — a dual-token claim
  owns two transfers, and selecting both must not rebuild that claim twice.
  Groups that cannot be recomputed (e.g. the linked claim is gone) are reported
  individually and skipped rather than blocking the rest.
  Remove deploy link / Remove platform stay single-only: they are undo
  operations on one specific placement, nothing asked for them in bulk, and the
  batch equivalents (re-deploy, re-platform) already exist.
  Verified live, 18 transfers / 2 positions: (A) 5 selected (3 idle + 2
  expensed) → "3 of 5 selected will be linked. 2 are marked as an Expense …
  will be left untouched", applied to exactly those 3 (Deployed $0 → $33.00,
  Available $2,185 → $2,152). (B) filtered to one position, Select all visible
  (16): Send to Platform previewed "13 of 16 … 3 are marked as an Expense",
  applied → Transferred $0 → $265.00 (the other $33 stayed in Deployed, since
  precedence keeps the buckets exclusive), Available $2,152 → $1,887; Revert
  previewed "13 of 16 selected can be reverted. 3 were created by hand …" with
  10 comparison blocks and 3 individually-reported blocked groups, applied →
  all 10 rebuilt from their claims ($10-$19 → $200-$209), platforms and
  deploy-links cleared, manual rows untouched, Lifetime $2,488 → $4,388;
  Delete confirmed "Delete 3 transfers ($153.00)?" → 16 rows → 13, Recently
  Deleted (3), Lifetime $4,388 → $4,235. (C) Edit absent at 2 selected, present
  again at 1. (D) single selection unchanged — all five actions, Edit opens the
  correct record, and Remove platform reappears once that row has a platform.
  (E) every balance above reconciles exactly. tsc/lint/build clean.
  Same JSX whitespace trap as the earlier "$500.00transfer" bug bit again in new
  copy ("aremarked as an Expense") — a literal space after {expr} is trimmed at
  build time. Use {" "}.

- 3630381: REAL BUG FIXED — the Breakdown by Type card's Expense tile
  was permanently 0. Plus a colour rule for the settled-state indicators. Both
  display/counting only; no P&L or balance calculation touched.
  PART 2 ROOT CAUSE (read in the code, then reproduced on the pre-fix build):
  the totals memo did `breakdown[t.transferType] += 1`, so the Expense bucket
  only ever incremented for transferType === "expense" — the position-less
  legacy record from the Log-an-Expense-as-a-transfer flow RETIRED in d20f3e3.
  Expense is not a type; it is a money STATUS that a Fees / Undeployed /
  Out-of-Range-Upside transfer carries. Every modern expensed transfer keeps its
  real type, lands in one of the other three buckets, and never in Expense.
  Measured before the fix with 10 seeded transfers, 4 of them Expense-status:
  card read FEES 9 · UNDEPLOYED 1 · OOR UPSIDE 0 · EXPENSE 0, while
  transferType === "expense" matched 0 records — exactly as predicted.
  FIX, scoped to that one tile: the three real types still count by
  transferType; Expense counts isExpensedTransfer. NOTE the four numbers now
  deliberately DO NOT sum to the total — a fees transfer marked as an Expense is
  counted in both Fees and Expense, because it genuinely is both. The tile
  answers "how many of each", not "how the total splits". Do not "fix" that
  overlap by subtracting.
  PART 1 COLOUR RULE (user): red is reserved for money that is simply GONE —
  a category whose settled money is 100% Expense. Everything else fully settled
  is green: fully transferred, fully deployed, or any MIX, since a mix always
  contains at least one non-expense state (a single state would be the uniform
  case) and that money is still working somewhere. That covers the
  expense+deployed-with-zero-transferred case by construction. The unrelated
  "already has $X deployed" hint stays muted. NoteTone gained "success" and is
  now exported from PositionCombobox, so both pickers share one vocabulary.
  Verified live in BOTH pickers with one position per case: pure expense → red
  lab(64.41 63.03 19.21) = rose-400; fully transferred, fully deployed,
  expense+transferred mix and expense+deployed mix → all green
  lab(75.08 -60.73 19.41) = emerald-400; deploy-target hint → muted grey.
  A category still holding idle money still shows nothing. After the count fix:
  FEES 9 · UNDEPLOYED 1 · OOR UPSIDE 0 · EXPENSE 4, matching the data exactly,
  with the other three unchanged. Balances untouched throughout (Lifetime $640,
  Expenses $290, Deployed $160, Transferred $160, Available $30 — all
  reconciling). tsc/lint/build clean.

- PLACEHOLDER_HASH: Four Transfers display refinements; no calculation touched.
  (1) A MIXED settled breakdown is now coloured PER SEGMENT on one line —
  "$423.85 expensed" red beside "$41.02 transferred" green — because one colour
  across the whole line has to lie about half of it. PositionNote became an
  ARRAY of {text, tone} segments (exported from PositionCombobox); a
  single-state label is just a one-segment note, so "fully expensed" (red) and
  "fully transferred"/"fully deployed" (green) are unchanged. Separators and
  spacing live INSIDE the segment strings, which keeps the renderer dumb and
  dodges the JSX literal-space trimming that has bitten this file's copy twice.
  (2) "Expenses / Withdrawn" card → "Expenses" (hint trimmed to match); the
  figure and everything feeding it are untouched.
  (3) "Transferred to Platforms" gained a per-type split under the figure —
  Fees / Upside / Undeployed. Built inside the SAME reduce that computes the
  total, using the same predicate, so the parts add up to it by construction
  (verified $291.02 + $60.00 + $25.00 = $376.02). SummaryStat gained an optional
  `parts` prop; zero-value parts are dropped, and an all-zero split renders
  nothing.
  (4) The REDEPLOYED pill is now hidden on rows that already carry a "Sent →
  PLATFORM" or "Used → PAIR" badge. Transferred and Deployed are SUB-STATES of
  Redeployed, so their badges already say it and the second pill was noise.
  Expense and idle rows keep the pill — it is the only thing that states them.
  NOTE this also drops the pill from Deployed rows, following the rule as
  written ("only when genuinely idle … not deployed"); the "Used → PAIR" badge
  itself is unaffected.
  Verified live: mixed line split red/green in BOTH pickers (screenshot);
  "EXPENSES (USD) $523.85" with the old label gone; transferred split summing
  exactly to the card total; a Sent→ row showing no REDEPLOYED, an idle row
  still showing it, a Deployed row showing only "Used → TGT/USDC", and Expense
  rows unchanged. Balances identical throughout. tsc/lint/build clean.

## Known Issues

- None currently tracked.

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