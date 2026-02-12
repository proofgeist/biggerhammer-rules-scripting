# CurtainTime Rules Engine — Workflow Documentation

## Table of Contents

- [Data Model](#data-model)
- [Architecture Overview](#architecture-overview)
- [Phase 1: UI Script — "Apply Contract Rules"](#phase-1-ui-script--apply-contract-rules)
- [Phase 2: Contract Rules Script (Scripting File)](#phase-2-contract-rules-script-scripting-file)
  - [Per-TCD Setup & Validation](#per-tcd-setup--validation)
  - [Rule Processing Loop (per mode)](#rule-processing-loop-per-mode)
  - [Write to Disk & Cleanup](#write-to-disk--cleanup)
- [Rule Sub-Scripts](#rule-sub-scripts)
- [Known Bug: Multiple Breaks](#known-bug-multiple-breaks)

---

## Data Model

### Core Tables

| Table | Abbreviation | Purpose |
|---|---|---|
| Contact | CON | Workers who are assigned to events |
| Event | EVE | Events that require staffing |
| Time Card | TCD | Joins a Contact to an Event on a given date |
| Time Card Line | TCL | Individual time segments on a Time Card |
| Contract | CTR | Defines billing/pay rules for a client |
| Contract Rule | CRU | Individual rule records associated to a Contract |
| Rating | RAT | Employee rating tiers affecting rule eligibility |
| Call | CLL | Parent record grouping event staffing |

### Time Card Line Types

Each TCL has a type that determines its role in the system:

| Type | Description |
|---|---|
| **Clock** | Raw worked time segments consolidated from punch records. These are the source data. |
| **Billable** | Derived from Clock lines. Represents what is billed to the client/vendor. |
| **Payable** | Derived from Clock lines. Represents what is paid to the contact/worker. |
| **Unworked** | Breaks, meals, and other non-worked time between Clock segments. |

### Punch-to-Clock Consolidation

Punch records are raw clock-in/out events. They are paired sequentially to form Clock TCLs:

```
Punch Records:          Clock TCLs:
  3:00 AM (IN)    →     3:00 AM – 8:00 AM  (5:00 worked)
  8:00 AM (OUT)
  9:00 AM (IN)    →     9:00 AM – 9:30 AM  (0:30 worked)
  9:30 AM (OUT)
  8:45 PM (IN)    →     8:45 PM – 11:45 PM (3:00 worked)
  11:45 PM (OUT)
                         Total: 8.5 hours worked
```

The gaps between Clock segments (8:00–9:00 AM, 9:30 AM–8:45 PM) represent breaks/meals and are tracked as Unworked time.

---

## Architecture Overview

The system is split across three FileMaker files:

| File | Role |
|---|---|
| **UI file** | User-facing layouts, UI scripts, navigation |
| **Scripting file** | Business logic scripts (rule engine lives here) |
| **Data file** | Table definitions and data storage |

### In-Memory Processing Pattern

The rules engine does **not** operate directly on TCL records. Instead:

1. **"Create Rule Variables"** loads Clock TCLs into repeating global variables (`$$bill[1..n]`, `$$pay[1..n]`)
2. Each rule sub-script reads and mutates these global arrays (splitting, extending, applying multipliers)
3. **"Write to Disk"** persists the final state of the arrays back as Billable and Payable TCL records

This pattern avoids repeated database writes during rule processing and allows rules to insert/split/merge line items freely in memory.

---

## Phase 1: UI Script — "Apply Contract Rules"

**File:** UI file
**Trigger:** "Apply Rules" button on the Time Card layout

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `timeCard_id` | text (¶-list) | Current TCD | Return-delimited list of Time Card IDs to process |
| `mode` | enum | `"bill¶pay"` | Which rule types to apply: `"bill"`, `"pay"`, or both |
| `clear_selection` | bool | (from global) | Whether to clear TCD selections after processing |

### Workflow

1. **Resolve Time Card IDs** — From parameter, or falls back to the active/current TCD based on layout context (`CLL__Call`, `TCD__TimeCard`, or `VIL__VirtualList`)

2. **Resolve mode** — Defaults to `"bill¶pay"` (both). If the event is an estimate and the global `apply_rules_on_Estimate_is_Limited_g` is set, defaults to `"bill"` only. The special mode `"staff"` maps to `"pay"` with a staff suffix on the client name.

3. **Commit unsaved changes** — Ensures no open records block processing

4. **Navigate to "Call - Apply Rules" layout** — A dedicated layout optimized for rule operations. Disables BrowserNav to prevent user interference. Preserves original layout/slider state for restoration later.

5. **Show progress thermometer** — Displays a cancelable progress dialog for multi-TCD batches

6. **Batch and loop through TCDs** — Processes Time Cards in batches (up to 5 per iteration):
   - Calls **"Client Router"** in the scripting file with the batch of TCD IDs plus all relevant global settings (mode, client name, omit unpaid meals flag, ratings flag, billable scope settings, flat rate hours flag)
   - Accumulates `$success_ids` and `$message_list` across batches
   - User can cancel via the thermometer dialog

7. **Restore UI state** — Returns to original layout and slider panel

8. **Clear selections** — Optionally removes successfully-processed TCDs from the selected list

9. **Log and report** — Creates a log entry with run time, parameters, and results. Displays error dialog if any errors occurred. Toggles `zRefresh_g` to update calculated fields on success.

---

## Phase 2: Contract Rules Script (Scripting File)

**File:** Scripting file
**Called by:** "Client Router" (which is called from Phase 1)

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `timecard_id` | text (¶-list) | Yes | Time Card IDs to process |
| `mode` | enum (¶-list) | Yes | `"Bill"`, `"Pay"`, or both |
| `omit_unpd` | bool | No (default: False) | Omit unpaid meals from bill/pay record sets |
| `ratings` | bool | No (default: True) | Whether employee ratings affect rule eligibility |
| `bill_scope_actual` | enum | Yes | Billable scope for actual events: Client, Event, or Employer |
| `bill_scope_estimate` | enum | Yes | Billable scope for estimate events |

### Returns

| Key | Type | Description |
|---|---|---|
| `error` | number | Non-zero indicates failure |
| `message` | text | Human-readable error/status message |
| `success_ids` | text (¶-list) | TCD IDs that were successfully processed |

---

### Per-TCD Setup & Validation

For each Time Card ID in the input list, the script performs the following setup inside a nested single-iteration loop (allowing early exit on error while continuing to the next TCD):

1. **Establish context via global relationship**
   - Sets `$$timecard_id` and `GLO__Global::_id_g` to form a relationship to the current TCD
   - Validates the TCD exists via `GLO_TCD__TimeCard::__id`

2. **Determine time boundaries**
   - SQL query finds the earliest IN timestamp and latest OUT timestamp across all Clock TCLs for this TCD
   - Stored in `$$start_ts` and `$$end_ts` — needed for history lookups (weekly OT, consecutive days, etc.)

3. **Store context globals**
   - `$$bill_scope` — determined by whether the event is an estimate
   - `$$company_id`, `$$contact_id`, `$$event_id`, `$$vendor_id` — from the TCD and related TCLs

4. **Validate job titles** (if contract requires CJT)
   - SQL counts Clock TCLs missing a `_contractJobTitle_id`
   - Exits with error if any are blank

5. **Validate time continuity** (if contract requires it)
   - Calls **"Validate Time Card"** sub-script to check for overlapping time segments across all of the contact's TCDs for that date
   - Error code `-1` means "no clock records to process" — treated as a non-error early exit

6. **Load contract rules**
   - SQL query pulls all `CRU__ContractRule` records for the TCD's contract, ordered by sequence
   - Stored in `$$contract_rules` (delimited text) and `$$contract_rules_JSON` (JSON via Data API or custom function)
   - Rule names extracted into `$contract_rule_names` for conditional execution checks

7. **Collect cross-event data** (for Payable Calculation Scope rule)
   - If running pay mode and the contract includes a "Payable Calculation Scope" rule, collects all non-estimate event IDs where this contact worked on the same date
   - Stored in `$$event_ids` for use by weekly/consecutive day rules

8. **Check rating eligibility**
   - Ratings determine whether a TCD gets full rule processing, simple clock-copy, or is skipped entirely
   - Four rating ID lists are pre-built: `$bill_apply_rule_ids`, `$bill_copy_clock_ids`, `$pay_apply_rule_ids`, `$pay_copy_clock_ids`

---

### Rule Processing Loop (per mode)

The script loops through each mode value (`"bill"`, then `"pay"`). Each mode iteration runs inside its own single-iteration inner loop for early exit capability.

#### Step 1: Create Rule Variables

Calls **"Create Rule Variables"** which:
- Loads Clock TCLs into repeating global variables (`$$bill[1..n]` or `$$pay[1..n]`)
- Returns a count stored in `$$bill_count` or `$$pay_count`
- Also creates `$$unwork[1..n]` for break/meal segments

#### Step 2: Apply Rules in Sequence

Each rule sub-script is called conditionally based on contract rule names or contract field values. They all operate on the in-memory global arrays.

| Order | Rule | Condition | Description |
|---|---|---|---|
| 1 | **Midnight Split** | Always | Splits any TCL spanning midnight into two segments |
| 2 | **Meal Penalty** | Contract rule or contract fields | Applies penalty for late/missing meals. Three variants: definitive (v2), limited, multiplicative |
| 3 | **Minimum Calls** | Contract rule or `hrs_minimum_call > 0` | Enforces minimum call hours per shift |
| 4 | **Before/After Unpaid Meal** | Contract fields `hrs_before_unpaid_meal` or `hrs_after_unpaid_meal` | Adjusts worked hours around unpaid meal breaks |
| 5 | **Midnight Split (2nd pass)** | Always | Re-splits in case Minimum Call created segments spanning midnight |
| 6 | **Night Rate** | Contract fields: `mult_night`, `time_night_start`, `time_night_end` | Applies night differential multiplier to hours in the night window |
| 7 | **Daily Overtime** | Contract fields: L1 and/or L2 hours + multipliers | Splits hours exceeding daily OT thresholds and applies multipliers |
| 8 | **Weekly Overtime** | Contract fields: weekly hours, multiplier, start of week | Applies weekly OT multiplier to cumulative hours exceeding threshold |
| 9 | **Consecutive Days** | Contract rule name | Premium for working consecutive days |
| 10 | **Day of Week** | Contract rule name | Premium for specific days of the week (weekends, holidays, etc.) |

**Disabled/commented-out rules:** 6th & 7th Day Overtime, Housekeeping (ICCLOS)

---

### Write to Disk & Cleanup

After both mode loops complete:

1. **"Write to Disk - BH"** — Persists the final `$$bill[n]`, `$$pay[n]`, and `$$unwork[n]` arrays as actual Billable, Payable, and Unworked TCL records. Receives the mode parameter to know which bill/pay arrays to write. Recycles existing TCL record IDs where possible rather than deleting and recreating. Uses an `IsEmpty`-based exit condition (not count-based), so it writes all contiguous entries regardless of `$$<mode>_count`. See the [full Write to Disk documentation](#write-to-disk---bh) for details.

2. **Error path:**
   - SQL finds all bill/pay TCLs that are children of Clock lines on this TCD
   - Deletes them via **"Delete Record PSOS"**
   - Stamps `rulesError` on the TCD with the error message

3. **Success path:**
   - Calls **"Clear OutOfWhack flags"** to reset any stale flags
   - Timestamps `rulesRun_ts` on the TCD
   - Clears `rulesError`
   - Adds the TCD ID to `$success_ids`

4. **Global cleanup:**
   - Clears all repeating `$$bill`, `$$pay`, `$$unwork` variables and their counts
   - At script end, clears all context globals (`$$timecard_id`, `$$event_id`, `$$contract_rules`, etc.)

---

## Rule Sub-Scripts

### Validate Time Card

**Purpose:** Ensures the current contact has no overlapping Clock TCL entries on the given date. Called before rule processing begins.

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `contact_id` | text | Yes | The contact whose times are being validated |
| `date` | date | Yes | The date to check |
| `start_ts` | timestamp | Yes | Earliest IN timestamp across the TCD's Clock lines |
| `end_ts` | timestamp | Yes | Latest OUT timestamp across the TCD's Clock lines |

#### Returns

| Key | Type | Description |
|---|---|---|
| `error` | number | `0` = valid, `-1` = no clock records found, `>0` = overlap detected |
| `message` | text | Human-readable description of the overlap |

#### Logic

1. **Determine validation scope** from contract settings (`validate_continuity_actual` or `validate_continuity_estimate`):
   - **"Timecard"** scope: Only checks Clock lines on the current TCD
   - **"Contact"** scope (default): Checks all Clock lines for this contact on this date, across all TCDs/Events/Vendors

2. **SQL query** assembles a chronologically-ordered list of `(time_in, time_out)` pairs for all qualifying Clock TCLs (excluding Bill, Pay, Minimum Call, and Unpaid Meal lines)

3. **Early exits:**
   - Empty result → error `-1` (no records to process, treated as non-error by caller)
   - Single record → no overlap possible, exit clean

4. **Sequential comparison loop:** Iterates through the sorted list comparing each record's `time_in` against the previous record's `time_out`. If `this_in < last_out`, an overlap is detected and the script exits with an error message naming the contact.

#### Key Detail

The validation only looks at Clock-type TCLs. Bill, Pay, Minimum Call, and Unpaid Meal records are excluded from the overlap check since they are derived/synthetic records.

---

### Create Rule Variables

**Purpose:** Loads all Clock TCL records for the current Time Card into repeating global variables (`$bill[n]` or `$pay[n]`) so that rule sub-scripts can operate on in-memory data instead of database records.

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `omit_unpd` | bool | No (default: False) | If True, excludes Unpaid Meal records from the loaded set |

#### Returns

| Key | Type | Description |
|---|---|---|
| `error` | number | Non-zero indicates failure |
| `message` | text | Error description |
| `count` | number | Number of records loaded (= number of global variable repetitions) |

#### Global Variable Structure

Each repetition of `$bill[n]` or `$pay[n]` contains a return-delimited list of name-value pairs representing one TCL record:

```
TCL__TimeCardLine::fieldName1=value1
TCL__TimeCardLine::fieldName2=value2
TCL__TimeCardLine::_timecardline_id=<original Clock TCL ID>
TCL__TimeCardLine::isBill=True       (or False)
TCL__TimeCardLine::isPay=False       (or True)
TCL__TimeCardLine::isOutOfWhack=False
...
```

The variable used depends on `$this_mode`:
- Mode = "bill" → data goes into `$bill[1]`, `$bill[2]`, ... `$bill[n]`
- Mode = "pay" → data goes into `$pay[1]`, `$pay[2]`, ... `$pay[n]`

#### Logic

1. **Collect field metadata** — SQL query against `FileMaker_Fields` gets all field names and types for the TCL table

2. **Collect record data** — SQL query pulls all Clock TCL fields for the current `$timecard_id`, ordered by `time_in_ts_c`:
   - Filters: `_timecard_id = $timecard_id AND isBill = 0 AND isPay = 0` (Clock records only)
   - If `$omit_unpd` is True, also excludes records where meal type indicates unpaid meal
   - Fields are delimited by `∞` within each record, records delimited by `¶`

3. **Clear previous mode variables** — Clears any existing `$bill[n]` or `$pay[n]` from a prior run using `CF_ClearRepeatingVariable`

4. **Record loop** — For each record (`$i = 1` to `$record_count`):
   - **Field loop** — For each field (`$j = 1` to `$field_count`):
     - Skips fields on the `$omit_fields` list (calculations, summaries, globals, etc.)
     - Converts raw SQL values to proper FileMaker types based on field type (date, timestamp, time, or text)
     - Appends as `fieldName=value` to the appropriate global variable repetition
   - **Touch-up** — After all fields are processed, adds/overwrites:
     - `_timecardline_id` = the original Clock TCL's `__id` (establishes parent-child link)
     - `isBill` = True if mode is "bill", else False
     - `isPay` = True if mode is "pay", else False
     - `isOutOfWhack` = False (reset for fresh rule processing)

5. **Returns count** — `$record_count` is returned so the caller can set `$bill_count` or `$pay_count`

#### Important Notes for Bug Investigation

- **The `$i` index is 1-based and matches the global variable repetition number.** Record 1 goes to `$bill[1]`, record 2 to `$bill[2]`, etc.
- **Records are ordered by `time_in_ts_c`** — so the global arrays are in chronological order.
- **The `_timecardline_id` field is set to the original Clock TCL's `__id`** — this is how Write to Disk knows which Clock line each bill/pay line derives from. All bill/pay lines created from the same Clock line share the same `_timecardline_id`.
- **The count returned here becomes `$bill_count` or `$pay_count`** — rule sub-scripts that insert new array elements (splits, minimums) must increment this count. If they don't, Write to Disk will miss the extra records.
- **Each Clock TCL becomes exactly one initial bill/pay entry.** With the example data (3 Clock lines), the initial state would be `$bill[1]` (3:00–8:00), `$bill[2]` (9:00–9:30), `$bill[3]` (8:45–11:45), with `$bill_count = 3`.
- **Unworked time is NOT loaded here** — there is no explicit loading of break/gap records into `$unwork[n]` in this script. The unworked segments must be created elsewhere (likely by a rule sub-script or are implicit from the gaps between Clock lines).

---

### Midnight Split

**Purpose:** Splits any TCL that spans midnight into two separate entries — one ending at midnight, one starting at midnight the next day. This simplifies downstream rules that operate on a per-day basis. Called twice: once early in the pipeline, and again after Minimum Calls (in case minimums created new midnight-spanning segments).

#### Parameters

None. Operates on the current `$this_mode` global arrays.

#### Returns

| Key | Type | Description |
|---|---|---|
| `error` | number | Non-zero indicates failure |
| `message` | text | Error description |

#### Logic

1. **Reads `$<mode>_count`** to get the current number of entries in the array

2. **Loops through each entry** (`$i = 1` to `$record_count`):
   - Extracts `date`, `time_in`, and `time_out` from the entry's name-value pairs
   - **Detection:** A midnight span is identified when `time_in > time_out` AND `time_out ≠ 00:00:00` (i.e., the out time "wraps around" to a smaller clock value than the in time)

3. **When a midnight span is found:**

   a. **Calls "Duplicate Rule Variable"** — inserts a copy of the current entry immediately after it in the array (shifts all subsequent entries up by one, increments `$<mode>_count`)

   b. **Modifies the original entry (index `$i`):**
   - `time_out` → `00:00:00` (midnight)
   - `time_out_ts_c` → Timestamp of midnight on `date + 1`
   - `isAfterMidnight` → False

   c. **Modifies the new entry (index `$i + 1`):**
   - `time_in` → `00:00:00` (midnight)
   - `time_in_ts_c` → Timestamp of midnight on `date + 1`
   - `time_out_ts_c` → Timestamp of `date + 1` + original `time_out`
   - `isAfterMidnight` → True
   - Clears `noteGracePeriod`

   d. **Exits the loop immediately** — the script assumes at most one midnight-spanning record exists per run

#### Helper Script: "Duplicate Rule Variable"

Called by Midnight Split (and likely other rules). Inserts a copy of a source entry at `source + 1`, shifting all subsequent array elements up by one and incrementing `$<mode>_count`.

#### Important Notes for Bug Investigation

- **The script exits after finding the FIRST midnight span.** The comment says "There should never be more than 1 record changed." This is safe because Clock lines shouldn't span midnight more than once, but if a prior rule (like Minimum Call) created multiple midnight-spanning entries, only the first would be caught. The second pass of Midnight Split (after Minimum Calls) would catch a second one, but only if it runs again.
- **"Duplicate Rule Variable" is the mechanism for inserting into the array.** This script is critical — it must correctly shift all elements and update the count. If it has an off-by-one error, it could corrupt the array for scenarios with many entries (i.e., multiple breaks producing more Clock lines).
- **The `$i` counter advances past the new record** (`$i = $i + 1` after the duplicate), so the new record's fields are set but the loop doesn't re-examine it. This is intentional.

### Meal Penalty Scripts

Three variants exist, selected by the Contract Rules script based on contract configuration. All three share a common pattern but differ in how penalties are applied.

#### Shared Pattern: History Lookup

All three meal penalty variants begin by looking backward in time to account for hours worked *before* the current Time Card:

1. **Call "Create History Variables"** — loads `$history[1..n]` with TCL data from prior time cards for the same contact, going back to `date - 1`, ordered DESC (most recent first)
2. **Scan history backward** looking for a qualifying meal break (paid meal, unpaid meal, or a gap ≥ `hrs_meal_break_min`). Once found, stop — everything before that break is irrelevant.
3. **Sum forward** through the remaining history records to calculate `$worked_hours` carried into the current Time Card.

This ensures that if a worker has been working across multiple time cards without a meal break, the penalty triggers correctly based on cumulative hours.

#### Shared Pattern: Gap Detection

All three variants detect **implicit meal breaks** by comparing `$last_out_ts` (previous record's out time) with the current record's `time_in_ts_c`. If the gap ≥ `hrs_meal_break_min`, it's treated as an unpaid meal and resets the worked hours counter.

**This is critical for the multiple-breaks bug:** The gap detection logic is how the system "sees" breaks between Clock lines (e.g., the gap from 9:30 AM to 8:45 PM in the example data). If this logic mishandles multiple gaps, penalties could be miscalculated.

---

#### Meal Penalty — Limited V2 (Definitive)

**Script name:** "Meal Penalty - limited, v2"
**Triggered when:** Contract rule name = "Meal Penalty (definitive)"

**Rule:** If crew work more than `hour1` hours without a meal break, they receive a premium equal to `hour2` hours of pay.

**Approach: Additive (post-loop accumulation)**

This variant does NOT split or modify existing TCL entries. Instead it:

1. Loops through all `$<mode>[n]` entries, tracking `$worked_hours` and `$premium_minutes`
2. At each meal/break boundary (unpaid meal, paid meal, or gap ≥ min break), calculates: `$premium_minutes += Max(0, $worked_hours - $hrs_before_meal_penalty1)` then resets `$worked_hours`
3. **After the loop ends**, does one final accumulation for the last work segment
4. If any `$premium_minutes` accumulated, calls **"Create Unworked Entry"** once to create a single penalty entry

**Key behaviors:**
- Marks all regular TCLs as `isMP1 = False`, `isMP2 = False` (penalties are separate unworked entries, not flags on worked lines)
- `ignoreMealPenalty` lines are skipped (not counted toward worked hours)
- Uses rule values from `$contract_rules` (the CRU record), not directly from contract fields
- Scope-aware: exits early if the rule's scope doesn't match `$this_mode`

**Notable for bug investigation:** This variant handles multiple breaks cleanly in theory — each gap resets the counter and accumulates any penalty. But the penalty is created from `$<mode>[1]` (the first entry) as the source template, regardless of which segment triggered the penalty.

---

#### Meal Penalty — Limited (Original)

**Script name:** "Meal Penalty - limited"
**Triggered when:** `hrs_meal_penalty1 > 0` on the contract (and no "Meal Penalty (definitive)" rule)

**Rule:** After `hrs_before_meal_penalty1` hours without a break → premium of `hrs_meal_penalty1` hours. Optional L2: after `hrs_before_meal_penalty2` hours → additional premium of `hrs_meal_penalty2` hours.

**Approach: Additive (in-loop creation)**

Similar to V2 but with two tiers and creates penalty entries inline during the loop:

1. Loops through `$<mode>[n]` entries tracking `$worked_hours`
2. At each meal/break boundary, resets `$worked_hours` and clears `$mp1_applied` / `$mp2_applied` flags
3. When `$worked_hours` exceeds threshold and penalty not yet applied:
   - Calls **"Create Unworked Entry"** for MP1 (using the current record as source template)
   - If L2 configured and threshold exceeded, calls **"Create Unworked Entry"** for MP2
4. Sets `$mp1_applied` / `$mp2_applied` flags to prevent duplicate penalties per meal window

**Key difference from V2:** Penalties are created per-segment as thresholds are crossed, not accumulated at the end. The source template for each penalty is the *current* record being examined, not the first record.

**Notable for bug investigation:** The gap detection resets both `$worked_hours` and the `$mp_applied` flags. With multiple breaks, each work segment between breaks gets its own independent penalty evaluation — this seems correct.

---

#### Meal Penalty — Multiplicative

**Script name:** "Meal Penalty - multiplicative"
**Triggered when:** `mult_meal_penalty1 > 1` on the contract (and no definitive rule, and `hrs_meal_penalty1` not > 0)

**Rule:** After `hrs_before_meal_penalty1` hours → rate multiplied by `mult_meal_penalty1`. After `hrs_before_meal_penalty2` hours → rate multiplied by `mult_meal_penalty2`.

**Approach: Multiplicative (flag + split existing lines)**

Unlike the additive variants, this one **modifies and splits existing TCL entries** in the global arrays:

1. Loops through `$<mode>[n]` entries tracking `$worked_hours`
2. At each meal/break boundary, resets `$worked_hours`
3. For each entry, determines which "zone" it falls in:
   - **Below threshold:** `isMP1 = False`, `isMP2 = False`
   - **Entirely in zone 1** (between MP1 and MP2 thresholds): `isMP1 = True`
   - **Entirely in zone 2** (above MP2 threshold): `isMP2 = True`
   - **Spans a threshold boundary:** **Splits the entry** using "Duplicate Rule Variable"

4. **Split logic** (can split up to twice if a single entry spans from below MP1 through MP2):
   - Calculates `$split_time` based on where the threshold falls within the entry
   - Calls "Duplicate Rule Variable" to insert a copy after the current entry
   - Modifies the original to end at `$split_time`, sets appropriate MP flags
   - Modifies the new entry to start at `$split_time`, sets appropriate MP flags
   - If the original entry spanned *both* thresholds, performs a second split

**Key behaviors:**
- This is the only meal penalty variant that **changes the array count** (via splits)
- After a split, `$i` advances to the new record, which continues processing in the next loop iteration
- The `$record_count` is NOT re-read after splits — but "Duplicate Rule Variable" increments `$<mode>_count`, and the loop re-evaluates `$record_count` isn't used (wait — actually `$record_count` IS set once before the loop. Let me re-check...)

**⚠️ POTENTIAL BUG: `$record_count` stale after splits.** The multiplicative variant sets `$record_count` once before the main loop. When "Duplicate Rule Variable" inserts new entries, it increments `$<mode>_count` but `$record_count` (the local variable used in the loop exit condition) may NOT be updated. If it isn't, the loop would exit too early, missing the last entries in the array.

*However*, looking more carefully at the loop: `Exit Loop If [ Let ( $i = $i + 1; $i > $record_count ) ]` — if `$record_count` is stale, entries added by splits would be skipped. This needs verification by checking whether "Duplicate Rule Variable" also updates the local `$record_count` or just the global `$<mode>_count`. **This could be the source of the multiple-breaks bug if splits cause the count to go stale.**

**UPDATE:** On closer inspection, after each split the script increments `$i` to point at the new record and continues processing it. The loop's next iteration will increment `$i` again. So the flow is: split at `$i`, process new record at `$i+1` (via manual increment), then loop increments to `$i+2`. If there were 3 original records and one split occurs, the array now has 4 entries but `$record_count` is still 3. The loop would exit at `$i = 4` (since `4 > 3`), missing the 4th entry. **This is a real concern with multiple Clock lines.**

---

#### Helper Scripts (Referenced by Meal Penalty)

| Script | Purpose | Status |
|---|---|---|
| **Create History Variables** | Loads `$history[n]` with TCL data from prior time cards for cross-TCD meal tracking | Not yet documented |
| **Create Unworked Entry** | Creates a `$unwork[n]` entry for penalty/premium hours | Not yet documented |
| **Duplicate Rule Variable** | Inserts a copy of an array element, shifting subsequent elements | Not yet documented |

---

### Write to Disk - BH

**Purpose:** Persists the final state of the in-memory `$$bill[n]`, `$$pay[n]`, and `$$unwork[n]` global variable arrays back to actual Billable, Payable, and Unworked Time Card Line records in the database.

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mode` | enum (¶-list) | Yes | `"Bill"`, `"Pay"`, or both. Determines which global arrays to write. |

#### Returns

| Key | Type | Description |
|---|---|---|
| `error` | number | Non-zero indicates failure |
| `message` | text | Human-readable error/status |
| `tcl_ids` | text (¶-list) | List of all TCL record IDs created or updated |

#### Logic

1. **Preheat variables** — Resolves the target table name, primary key field name, timecard key field name, and builds a list of the hours column fields (`hrsColumn0` through `hrsColumn5`).

2. **Column multiplier setup** — If the Time Card has `tcl_columns` defined (a JSON array on the TCD record), extracts the multiplier values into `$tclx_array` as a JSON array (e.g., `[1, 1.5, 2, ...]`). This is set on each TCL record before field assignment so that auto-enter calculations that depend on `column_multipliers` resolve correctly. Exits on error if the array is empty or malformed.

3. **Gather existing Bill/Pay IDs** — A single SQL query collects all existing Billable and Payable TCL IDs for this Time Card into `$bill_pay_ids`. These become `$reusable_ids` — the script **recycles existing records** rather than always deleting and recreating, which is more efficient and preserves record-level metadata.

4. **Outer mode loop** — Iterates through each mode value (`"bill"`, then `"pay"`):
   - Extracts `$reusable_ids` for the current mode from `$bill_pay_ids` using `CF_GetArrayColumn`

5. **Bill/Pay record loop** — For each repetition `$$<mode>[j]` (starting at `j = 1`):

   a. **Exit condition:** `Exit Loop If [ IsEmpty ( $this_record ) ]` — loops until it hits an empty variable slot, **NOT** based on `$$<mode>_count`

   b. **Record identity:** Sets `GLO__Global::_new_id_g` to either a recycled ID (via `Pop("$reusable_ids")`) or empty. If empty, the global relationship auto-creates a new TCL record when the first field is set.

   c. **Timecard ID:** Sets `_timecard_id` on the record (only if changed), which triggers auto-enter calculations for related fields (`_contact_id`, `_vendor_id`, `date`, etc.)

   d. **Column multipliers:** Sets `column_multipliers` on the record (only if changed)

   e. **Field loop:** Iterates through each name-value pair in the variable:
      - **Skipped fields:** `_contact_id`, `_timecard_id`, `_vendor_id`, `date` (handled by auto-enter when timecard ID is set)
      - **Skipped suffixes:** `_c` (calculation fields), `_s` (summary fields)
      - Values are extracted via `CF_stripPSlashes(CF_getProperty(...))` and only written if the current field value differs (optimization to reduce commits)

   f. **Collect TCL ID:** Appends the record's primary key to `$tcl_ids`

   g. **Hours column assignment:** Based on the record's boolean flags, routes the `timeDuration_c` value (converted to hours) into exactly one of 6 columns, clearing all others:

   | Column | Condition (Bill/Pay loop) |
   |---|---|
   | *(none — skipped)* | `isUnpaidMeal` = True |
   | `hrsColumn5` | `isDriveTime` |
   | `hrsColumn2` | `isOTDailyL2`, OR (`isHoliday` AND any of: `isOTDailyL1`, `isOTWeekly`, `isConsecutiveDay6th/7th/8th`), OR (`isOTDailyL1` AND `isConsecutiveDay7th`) |
   | `hrsColumn1` | (`isOTDailyL1` OR `isOTWeekly` OR `isConsecutiveDay6th/7th/8th`) AND NOT `ignoreOvertime`, OR (`isHoliday` AND NOT `ignoreHoliday`), OR `isDayOfWeek` |
   | `hrsColumn3` | `isNightRate` AND NOT `ignoreNightRate` |
   | `hrsColumn4` | (`isMP1` OR `isMP2`) AND NOT `ignoreMealPenatly` |
   | `hrsColumn0` | Default / base rate (none of the above) |

   h. **Modified flag:** Computes a concatenation of all column values to populate `isModified_calc`, used downstream to detect whether the record differs from a default state

6. **Collect unused IDs** — After the mode loop, any remaining `$reusable_ids` (old records that weren't needed) are added to `$unused_ids`

7. **Unworked record loop** — If `$$unwork_count > 0`, processes `$$unwork[1..n]` using the same pattern as the bill/pay loop:
   - Uses `$unused_ids` (leftover from bill/pay recycling) for record reuse
   - Same field-setting and column assignment logic
   - Same `IsEmpty` exit condition
   - **Column routing differs slightly:** The unworked loop uses `Sum()` for multi-flag detection (e.g., `Sum(isOTDailyL1; isOTWeekly; isHoliday; ...) > 1` for column 2) rather than the explicit `and`/`or` combinations in the bill/pay loop. This is functionally similar but not identical — edge cases with unusual flag combinations could route to different columns between the two loops.

8. **Commit** — If any records are open, commits them. Reverts on error.

9. **Delete extras** — If any `$unused_ids` remain after both the bill/pay and unworked loops, deletes them via "Delete Record PSOS". This handles the case where a re-run produces fewer TCL records than the previous run.

10. **Performance logging** — Creates a log entry with per-field and per-record timing data for performance monitoring.

#### Important Notes for Bug Investigation

- **Exit condition is `IsEmpty`, not count-based.** The record loop does NOT use `$$bill_count` / `$$pay_count` to determine how many entries to write. It evaluates each `$$<mode>[j]` variable and exits when it finds an empty slot. This means Write to Disk will persist **all contiguous entries** in the array regardless of what the count globals say. This is a resilient design choice that avoids the stale-count problem that affects upstream rule scripts.

- **Write to Disk is NOT contributing to the missing-entries bug.** Because it loops until empty rather than using a count, any entries that exist in the array WILL be written to disk. The root cause remains upstream: "Before/After Unpaid Meal" exits its loop early (due to stale `$record_count`), so the last Clock line(s) don't get their meal-related adjustments applied. Those entries still exist in the array and still get written — they just have incorrect/unadjusted values.

- **Record recycling via `Pop("$reusable_ids")`.** The script reuses existing TCL record IDs rather than deleting all and recreating. `Pop()` destructively removes the last value from the list, so IDs are consumed one at a time. If the rule engine produces MORE entries than existed previously (e.g., due to splits), the extra entries are created as new records (empty `_new_id_g`). If it produces FEWER, the leftover old records are deleted at the end.

- **The `$$unwork` loop gates on `$$unwork_count > 0`**, which is the one place in Write to Disk that does reference a count variable. However, this is just a gate (skip the entire loop vs. enter it) — the actual loop still uses the `IsEmpty` exit condition. If `$$unwork_count` were stale-low but `$$unwork[n]` entries existed, the loop would be skipped entirely. Worth verifying that "Create Unworked Entry" always increments `$$unwork_count`.

- **Column routing inconsistency between bill/pay and unworked loops.** The flag-to-column logic is slightly different in the two loops. The bill/pay loop uses explicit multi-condition `and`/`or` chains, while the unworked loop uses `Sum(...) > 1` for the "double-time" column 2 check. In practice, unworked entries rarely carry overtime/holiday flags simultaneously, so this is unlikely to cause issues — but it's a maintenance risk.

- **Fields skipped by design:** `_contact_id`, `_timecard_id`, `_vendor_id`, and `date` are NOT set from the variable data. They are populated via auto-enter calculations triggered when `_timecard_id` is set. This means the rule engine variables don't need to carry these fields accurately — they're always derived from the TCD relationship at write time.

---

- [x] **Create Rule Variables** — Loads Clock TCLs into global arrays
- [x] **Midnight Split** — Splits midnight-spanning segments
- [x] **Meal Penalty (definitive, v2)** — Definitive meal penalty calculation
- [x] **Meal Penalty (limited)** — Limited-hour meal penalty
- [x] **Meal Penalty (multiplicative)** — Multiplicative meal penalty
- [x] **Minimum Calls - BH** — Multi-tier minimum call enforcement
- [x] **Minimum Call - BH** — Single-tier minimum call enforcement
- [x] **Before/After Unpaid Meal** — Break-adjacent hour adjustments
- [x] **Night Rate** — Night differential application
- [x] **Daily Overtime** — Daily OT threshold splitting
- [x] **Weekly Overtime** — Weekly cumulative OT
- [x] **Consecutive Days - BH** — Consecutive day premium
- [x] **Day of Week** — Day-of-week premium
- [x] **Write to Disk - BH** — Persists global arrays to TCL records
- [x] **Validate Time Card** — Overlap/continuity validation
- [ ] **Clear OutOfWhack flags** — Post-success flag cleanup

---

## Known Bug: Multiple Breaks

### Symptoms

When applying contract rules to Time Cards with multiple breaks (multiple unpaid meals or gaps), billable/payable records are generated incorrectly — the last Clock line(s) may be missing from the output, or extra spurious entries may appear.

### Root Cause: "Before/After Unpaid Meal" — `$record_count` and `$tcl_loop` Not Updated After Array Insertions

The **"Before/After Unpaid Meal"** script calls **"Create Worked Entry"** when the worker hasn't met the required hours before/after a meal break. "Create Worked Entry" calls "Duplicate Rule Variable" which inserts a new entry into the `$bill`/`$pay` array and increments `$<mode>_count`.

However, the "Before/After Unpaid Meal" script has **two problems** after each insertion:

1. **`$record_count` is not incremented** — The increment was intentionally commented out in Dec 2021 / Feb 2022 because it was causing an infinite loop. The loop exit condition `$tcl_loop > $record_count` becomes stale, causing the loop to exit before processing all entries.

2. **`$tcl_loop` is not incremented** — After "Duplicate Rule Variable" shifts all entries down and inserts a copy, the loop's next iteration re-reads the position that now contains the shifted-down record (the one that was previously at `$tcl_loop`). This is the original cause of the infinite loop: the same entry keeps triggering the rule, creating another insertion, forever.

**The original "fix" (commenting out `$record_count + 1`) stopped the infinite loop by making the loop exit early, but introduced the current bug:** with multiple breaks, each "Create Worked Entry" call adds an entry the loop never reaches, so the final Clock line(s) are skipped.

**The correct fix requires both:**
```
Set Variable [ $tcl_loop ; Value: $tcl_loop + 1 ]           // skip past inserted entry
Set Variable [ $record_count ; Value: $record_count + 1 ]   // track new array size
```

This is the same pattern used correctly by the **Minimum Calls** script, which does:
```
Set Variable [ $i ; Value: $i + 1 ]
Set Variable [ $record_count ; Value: $record_count + 1 ]
```

**Where to apply:** Only at the 3 "Create Worked Entry" call sites inside the Part 2 main loop (lines ~199, ~230, ~299 in the original script). NOT at the "Create Unworked Entry" sites (those write to `$$unwork[]`, not `$$bill/$$pay`). NOT at the Part 3 sites (after the loop has ended). See the [Before/After Unpaid Meal script](scripts/before-after-unpaid-meal.md) for exact locations.

### Secondary Issue: Meal Penalty Multiplicative — Stale `$record_count`

The **"Meal Penalty - multiplicative"** script also caches `$record_count` before its main loop and never refreshes it after calling "Duplicate Rule Variable" for splits. This causes the same last-entry-skipped behavior when splits occur with multiple Clock lines. However, this only affects contracts using the multiplicative meal penalty variant.

### Write to Disk Findings — Bug Impact Assessment

Review of the "Write to Disk - BH" script confirms it is **not contributing to the bug**. Key findings:

1. **`IsEmpty`-based exit, not count-based.** The bill/pay record loop evaluates `$$<mode>[j]` at each iteration and exits when empty. It never reads `$$bill_count` or `$$pay_count` to decide when to stop. This means all contiguous array entries are always written, even if count globals are stale.

2. **Entries are present but incorrectly processed.** The upstream bug in "Before/After Unpaid Meal" causes its loop to exit early, so the last Clock line(s) don't get their meal-adjacent adjustments applied. However, those entries still exist in the array (they were loaded by "Create Rule Variables" and are contiguous). Downstream rules (Night Rate, Daily OT, etc.) DO process them correctly because they read the global `$$<mode>_count` (which "Duplicate Rule Variable" keeps accurate). Write to Disk then persists them. The result: the last entries appear in the output but with **missing before/after meal adjustments**, not entirely absent.

3. **One caveat: `$$unwork_count` gate.** The unworked loop is gated by `$$unwork_count > 0`. If "Create Unworked Entry" fails to increment `$$unwork_count`, the entire unworked loop would be skipped. This is a secondary concern — the primary bill/pay arrays are unaffected.

4. **Minor inconsistency: column routing logic.** The bill/pay loop and the unworked loop use slightly different flag-to-column logic (explicit `and`/`or` vs `Sum() > 1`). This is unlikely to cause issues in practice but is a maintenance risk for future changes.

### Affected Scenarios

The bug is most visible with:
- **3+ Clock lines** (2+ breaks) — more entries means more chances for insertions and more entries missed
- **Short work segments before breaks** — these trigger the "before unpaid meal" rule, causing insertions
- **Contracts where `minimums_are_worked_time = True`** (currently hardcoded) — these use "Create Worked Entry" (array insertion) rather than "Create Unworked Entry" (separate array, no impact on bill/pay count)

### Investigation Plan

- [x] Review "Create Rule Variables" for break/unworked segment loading
- [x] Review "Before/After Unpaid Meal" for multi-break handling — **ROOT CAUSE FOUND**
- [x] Review "Write to Disk" for array count integrity — **CLEARED: uses `IsEmpty` exit, not count-based. Not contributing to bug.**
- [x] Review "Duplicate Rule Variable" for count update mechanism — **confirmed only updates global, not caller's local**
- [ ] Apply fix: add `$tcl_loop + 1` alongside `$record_count + 1` at the 3 "Create Worked Entry" sites in Before/After Unpaid Meal
- [ ] Un-hardcode `$minimums_are_worked_time` in Before/After Unpaid Meal (change `True` to `GetAsBoolean ( GLO_TCD_CTR__Contract::minimums_are_worked_time )`)
- [ ] Audit Meal Penalty Multiplicative for same `$record_count` fix pattern
- [ ] Verify no other scripts have the same stale-count pattern

---

## Changes Made — 02/12/2026

### Summary

Preparatory work to support un-hardcoding `$minimums_are_worked_time` in Before/After Unpaid Meal. When this flag reads from the contract (instead of being hardcoded to `True`), minimum entries go to `$$unwork[]` instead of `$$bill/$$pay`. Four fixes were needed to prevent overlap and data inconsistency between the two arrays.

### 1. Create Unworked Entry — Timestamp Fix

**File:** [create-unworked-entry.md](scripts/create-unworked-entry.md)

**Problem:** When callers provided new `time_in`/`time_out` values, the source record's `time_in_ts_c` and `time_out_ts_c` were preserved unchanged. This caused inconsistent time data on the unworked record — `time_in` said 9:30 AM but `time_in_ts_c` said 8:45 PM (from the source Clock line).

**Fix:** Uncommented and completed the timestamp reconstruction (lines 71-82). Now rebuilds both timestamp fields from `$date + $isAfterMidnight` and the provided times. Added midnight-wrap handling (`time_out < time_in` → next day) to match "Create Worked Entry"'s pattern. This is a prerequisite for any downstream script reading `$$unwork[]` by timestamps.

### 2. Minimum Calls - BH — Unworked Loop

**File:** [minimum-calls-bh.md](scripts/minimum-calls-bh.md)

**Problem:** A commented-out second loop through `$$unwork[]` (from Jul 2024) was a full mirror of the main loop with gap detection, entry creation, and counter tracking. This had three bugs: (a) `$start_of_call_repetition` indexed `$$unwork[]` but was passed to "Create Worked Entry" which expects a `$$bill/$$pay` index; (b) no state reset between the main and unworked loops, causing stale `$last_time_out_ts_c`; (c) gap detection was meaningless because unworked entries aren't chronologically ordered relative to `$$bill/$$pay`.

**Fix:** Simplified to an accumulate-only loop (lines 192-215). Iterates `$$unwork[]`, filters by mode, skips ignored and unpaid meal entries, and sums `$this_hrsUnworked` (not `$this_duration`) into `$running_total_worked`. The post-loop minimum check (line 220) then makes the correct shortfall decision using the combined worked + unworked total. No entry creation in this loop — that's the main loop's and post-loop check's job.

### 3. Minimum Calls - BH — `hrsUnworked` vs `duration`

**File:** [minimum-calls-bh.md](scripts/minimum-calls-bh.md)

**Problem:** The unworked loop was using `$this_duration` (`time_out_ts_c - time_in_ts_c`) for running totals. For unworked entries, the timestamp span can differ from the actual credited time.

**Fix:** Changed to `$this_hrsUnworked` at both accumulation points (isMinimumCall branch and else/"honest work" branch). `hrsUnworked` is the authoritative credited-time field — it's what callers explicitly set and what Write to Disk uses for column routing. Removed the `@DEV` comment that flagged this question.

### 4. Before/After Unpaid Meal — MC Unworked Credit

**File:** [before-after-unpaid-meal.md](scripts/before-after-unpaid-meal.md)

**Problem:** When `minimums_are_worked_time = False`, Minimum Calls (rule 3) creates entries in `$$unwork[]`. Before/After Unpaid Meal (rule 4) loops only `$$bill/$$pay` and can't see them. When the deference check fails (B/A shortfall > MC shortfall), B/A creates an entry for the full shortfall without accounting for MC's existing credit, producing redundant entries.

**Fix:** Added an `$$unwork[]` scan loop at the start of Part 2 (lines 150-164), before the main TCL loop. Sums `hrsUnworked` from all mode-matching `isMinimumCall` entries into `$mc_unwork_credit`, then adds this to `$since_last_meal`. Since `$since_start_of_call` is initialized from `$since_last_meal`, both counters get the credit. This reduces (or eliminates) the shortfall in the first gap check.

**Known limitation:** The credit is applied at initialization, so it primarily covers the first gap encountered. After each gap, `$since_last_meal` resets to 0 and the credit is consumed. Multi-gap time cards with MC entries at later gaps may not be fully covered. This is conservative (under-credits rather than over-credits).

---

## Remaining Work

### Must-do before deploying

| # | Task | File | Notes |
|---|------|------|-------|
| 1 | **Apply the `$tcl_loop + 1` / `$record_count + 1` fix** | Before/After Unpaid Meal | The root cause fix for the multiple breaks bug. Uncomment `$record_count + 1` and add `$tcl_loop + 1` at the 3 "Create Worked Entry" sites inside Part 2's main loop. Do NOT touch the "Create Unworked Entry" sites or Part 3. |
| 2 | **Un-hardcode `$minimums_are_worked_time`** | Before/After Unpaid Meal | Change line 55 from `True` to `GetAsBoolean ( GLO_TCD_CTR__Contract::minimums_are_worked_time )`. This activates the unworked path and all four fixes above. |

### Should-do

| # | Task | File | Notes |
|---|------|------|-------|
| 3 | **Audit Meal Penalty Multiplicative** | Meal Penalty - multiplicative | Same stale `$record_count` pattern — caches count before loop, never refreshes after splits. Needs the same `$i + 1` / `$record_count + 1` fix. Only affects contracts using the multiplicative variant. |
| 4 | **Verify no other scripts have stale-count pattern** | All rule sub-scripts | Scan all scripts that call "Duplicate Rule Variable" to confirm they increment both the loop counter and `$record_count`. |

### Known limitations to monitor

| # | Limitation | Impact | When to revisit |
|---|-----------|--------|-----------------|
| 5 | **MC credit applied at initialization only** | Multi-gap time cards where MC created an entry at a *later* gap will under-credit that gap. First gap may be over-credited. | If testing reveals incorrect shortfall amounts on multi-gap time cards with `minimums_are_worked_time = False`. Fix would require per-gap timestamp matching against `$$unwork[]`. |
| 6 | **Downstream rules don't see unworked minimums** | When `minimums_are_worked_time = False`, Night Rate, Daily OT, Weekly OT only iterate `$$bill/$$pay` and won't apply rate adjustments to unworked minimum entries. | If business rules require minimum call hours to accumulate toward OT thresholds or receive night differential. This was the original reason for the hardcoding ("per the beautiful Michelle"). |

---

## Testing Plan

### Test Case 1: Multiple Breaks — Root Cause Fix

**Prerequisite:** Apply remaining task #1 (`$tcl_loop + 1` / `$record_count + 1`).

**Setup:** Time Card with 3+ Clock lines and short work segments between breaks (e.g., 3:00-8:00 AM, 9:00-9:30 AM, 8:45-11:45 PM). Contract with `hrs_before_unpaid_meal` set (e.g., 3 hours).

**Steps:**
1. Apply rules with `minimums_are_worked_time = True` (current hardcoded state)
2. Verify all 3 Clock lines produce bill/pay records with correct before/after meal adjustments
3. Verify no spurious or missing entries
4. Compare against known-good output from before the changes (if available)

**What to check:**
- `$$bill_count` / `$$pay_count` matches the actual number of entries in the array
- The last Clock line's bill/pay record has meal-related adjustments applied (not raw clock values)
- No infinite loop (script completes in reasonable time)

### Test Case 2: Un-hardcode `minimums_are_worked_time`

**Prerequisite:** Apply remaining tasks #1 and #2.

**Setup:** Same time card as Test 1. Contract with `minimums_are_worked_time = False`.

**Steps:**
1. Apply rules
2. Verify minimum entries appear as Unworked records (not Billable/Payable)
3. Verify `$$unwork[]` entries have correct, consistent timestamps (`time_in`/`time_out` match `time_in_ts_c`/`time_out_ts_c`)
4. Verify no duplicate/redundant entries between Minimum Calls and Before/After Unpaid Meal
5. Verify the Minimum Calls post-loop check correctly accounts for unworked credits (shortfall is reduced)

### Test Case 3: MC + B/A Overlap Prevention

**Setup:** Contract where minimum call < before-meal requirement (e.g., minimum = 2 hours, before-meal = 3 hours). Worker works 1 hour before a meal break. `minimums_are_worked_time = False`.

**Expected:**
- Minimum Calls creates a 1-hour unworked entry (2 - 1 = 1)
- Before/After sees the MC credit, computes shortfall as 3 - 1 (work) - 1 (MC credit) = 1 hour
- Before/After creates a 1-hour unworked entry
- Total unworked credit: 2 hours (correct — the before-meal requirement minus actual work)
- NOT 3 hours (which would happen without fix #4)

### Test Case 4: Regression — `minimums_are_worked_time = True`

**Setup:** Contract with `minimums_are_worked_time = True`. Same data as Tests 1-3.

**Expected:** Behavior identical to before our changes. The unworked loops and MC credit scan are no-ops when all minimums go to `$$bill/$$pay` (no MC entries in `$$unwork[]` to find).
