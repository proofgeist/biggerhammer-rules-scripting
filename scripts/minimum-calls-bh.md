# Minimum Calls - BH

> Multi-tier minimum call enforcement (correctly handles $record_count — reference implementation)

## Script Text

```
# #Minimum calls 
#  Applies basic Minimum Call rules to the Time Card Lines
#  As a modular script, several assumptions will be made regarding the context & environment.
#  As a PSOS script, we want to avoid opening windows, and ALL user interactions..
# 
# @history
#  01/03/2017 - Marc Berning - Initial Version
#  06/08/2017 - Marc Berning - Rewrite
#  06/09/2017 - Marc Berning - the Creation of a Minimum Call record now uses data from the previous record instead of the current record.
#  05/24/2018 - Marc Berning - Added check for Flat Rate.
#  08/28/2018 - Marc Berning - Added $start_of_call_repetition upon which is based any minimum Call records that may be created.
#  06/21/2022 - Kate Lee - Added ignore minimum call around line 176
# 
# @assumptions
#  Context: We are already oriented to a Globals-based layout.
#  Context: The "current" Time Card is & its related Contract is available via the GLO_TCD__Timecard and GLO_TCD_CTR__Contract relationships.
#  Environment: Allow User Abort & Error Capture states are appropriately set.
# 
# @return num $error (req): non-zero indicates a problem
# @return text $message (cond): Human readable message about the general outcome of the script. Requied if error.
# 
# @rule	An employee must be paid the equivelent of a minimum quantity of hours, {hrs_minimum_call}, specified by the contract.
# @rule	Certain Job Titles may have a different (higher) minimum, which supercedes the contract-specified value.
# @rule	Included in the total hours calculation: Worked time, paid meals, and Minimum Call records already created such as Before/After Unpaid Meals.
# @rule	If there are ANY Show Calls (flat rate), then there shall be no Minimum Call
# 
# 
#  Single-iteration loop
Loop [ Flush: Always ]
# 
#  Preheat variables here
Set Variable [ $rule_name ; Value: "Minimum Calls" ]
Set Variable [ $call_count ; Value: 0 ]
Set Variable [ $record_count ; Value: Evaluate ( "$$" & $$this_mode & "_count" ) ]
# 
#  Collect rule-specific values from the rule record or the contract.
Set Variable [ $rule_values ; Value: Let ([ 	~rules	= CF_GetArrayColumn ( $$contract_rules; 1; "∞" ); 	~pos		= CF_ListValuePositions ( ~rules; "name=" & $rule_name ; "" ); 	~rule	= GetValue ( $$contract_rules; GetValue ( ~pos; 1 )) ]; 	Substitute ( ~rule; "∞"; ¶ ) ) ]
Exit Loop If [ IsEmpty ( $rule_values ) ]
Exit Loop If [ Let ( 	~s = CF_getProperty ( $rule_values; "scope" ); 	not IsEmpty ( ~s ) and not PatternCount ( ~s; $$this_mode ) ) ]
Set Variable [ $hrs_minimum_first ; Value: GetAsNumber ( CF_getProperty ( $rule_values ; "hour1" )) ]
Set Variable [ $hrs_minimum_next ; Value: GetAsNumber ( CF_getProperty ( $rule_values ; "hour2" )) ]
Set Variable [ $minimums_included_in_NT ; Value: GetAsBoolean ( GLO_TCD_CTR__Contract::minimums_included_in_NT ) ]
Set Variable [ $minimums_included_in_OT ; Value: GetAsBoolean ( GLO_TCD_CTR__Contract::minimums_included_in_OT ) ]
Set Variable [ $minimums_are_worked_time ; Value: GetAsBoolean ( GLO_TCD_CTR__Contract::minimums_are_worked_time ) ]
Set Variable [ $hrs_meal_break_max ; Value: Time ( GLO_TCD_CTR__Contract::hrs_meal_break_max; 0; 0 ) ]
# 
#  If there are ANY Flat rate TCL records, Minimum Call is not applicable.  -  YBCA
Set Variable [ $i ; Value: 0 ]
Loop [ Flush: Always ]
Exit Loop If [ Let ( $i = $i + 1; $i > $record_count ) ]
Set Variable [ $this_record ; Value: Evaluate ( "$$" & $$this_mode & "[$i]" ) ]
Exit Loop If [ GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::isFlat ))) ]
End Loop
Exit Loop If [ GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::isFlat ))) ]
# 
#  Loop through the Bill/Pay repeating variables
Set Variable [ $i ; Value: 0 ]
Loop [ Flush: Always ]
Exit Loop If [ Let ( $i = $i + 1; $i > $record_count ) ]
# 
#  Break a few "field" values out into dedicated varaibles.  This will make reading/writing this section much easier, and reduce custom function calls.
Set Variable [ $this_record ; Value: Evaluate ( "$$" & $$this_mode & "[$i]" ) ]
Set Variable [ $this_time_in_ts_c ; Value: GetAsTimestamp ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::time_in_ts_c ))) ]
Set Variable [ $this_time_out_ts_c ; Value: GetAsTimestamp ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::time_out_ts_c ))) ]
Set Variable [ $this_time_out ; Value: GetAsTime ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::time_out ))) ]
Set Variable [ $this_hrsUnworked ; Value: GetAsTime ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::hrsUnworked ))) ]
Set Variable [ $this_isMinimumCall ; Value: GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::isMinimumCall ))) ]
Set Variable [ $this_ignoreMinimumCall ; Value: GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::ignoreMinimumCall ))) ]
Set Variable [ $this_isUnpaidMeal ; Value: GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::isUnpaidMeal ))) ]
Set Variable [ $this_contractJobTitle_id ; Value: CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::_contractJobTitle_id )) ]
Set Variable [ $this_duration ; Value: $this_time_out_ts_c - $this_time_in_ts_c ]
# 
#  How much time (if any) transpired between this record and the previous record.
Set Variable [ $time_gap ; Value: Let ( 	~diff = $this_time_in_ts_c - $last_time_out_ts_c; 	Case ( 		IsEmpty ( $last_time_out_ts_c ); 			""; 		~diff = 0; 			""; 		~diff 	) ) ]
# 
#  Calculate the current job title's minimum.
Set Variable [ $cjt_min_call ; Value: Let ([ 	~table	= SQLTable ( CJT__ContractJobTitle::__id ); 	~cjt_id	= SQLField ( CJT__ContractJobTitle::__id ); 	~hrs_min	= SQLField ( CJT__ContractJobTitle::hrs_min_call ); 	~query	= "SELECT " & ~hrs_min & " FROM " & ~table & " WHERE " & ~cjt_id & " = ?… ]
# 
#  Calculate the current effective minimum - the Max of all minimums we've seen on this Time Card so far.
Set Variable [ $current_minimum_call ; Value: If ( $call_count < 1; 	Time ( Max ( $hrs_minimum_first; $cjt_min_call; $last_min_call ); 0; 0 ); 	Time ( $hrs_minimum_next; 0; 0 ) ) ]
# 
#  Keep track of which repetition represents the start of the current Call
If [ IsEmpty ( $last_time_out_ts_c ) ]
#  Minimum Call records will be based on this repetition,
Set Variable [ $start_of_call_repetition ; Value: $i ]
End If
# 
#  If the current record is preceeded by a time gap, and too much time has transpired ...
If [ $time_gap + $running_total_unworked > $hrs_meal_break_max ]
If [ $running_total_worked > 0 	and $running_total_worked < $current_minimum_call ]
#  Make a new Minimum Call record
If [ $minimums_are_worked_time ]
Perform Script [ “Create Worked Entry” ; Specified: From list ; Parameter: Let ([ 	~missing		= $current_minimum_call - $running_total_worked; 	~last_out	= GetAsTime ( $last_time_out_ts_c ); 	~new_out		= ~last_out + ~missing ]; 	List ( 		"iSource="	& $start_of_call_repetition; 		"time_in="	& CF_TimeFormat ( ~last_out ); 		"time_out="	& CF_TimeFormat ( ~new_out ); 		"incl_NT="	& True;  //  $minimums_included_in_NT; 		"incl_OT="	& True;  //  $minimums_included_in_OT; 		"note="		& "Minimum Call Applied"; 	) ) ]
Set Variable [ $i ; Value: $i + 1 ]
Set Variable [ $record_count ; Value: $record_count + 1 ]
Else
# KL
// Perform Script [ “Create Unworked Entry” ; Specified: From list ; Parameter: List ( 	"source="		& CF_addPSlashes ( Evaluate ( "$$" & $$this_mode & "[" & $start_of_call_repetition & "]" )); //	"time_in="		& CF_TimeFormat ( ~last_out ); //	"time_out="		& CF_TimeFormat ( ~new_out ); 	"hrsUnworked="	& $current_minimum_call - $running_total_worked; 	"incl_NT="		& True;  //  $minimums_included_in_NT; 	"incl_OT="		& True;  //  $minimums_included_in_OT; 	"note="			& "Minimum Call Applied"; ) ]
Perform Script [ “Create Unworked Entry” ; Specified: From list ; Parameter: Let ([ 	~missing		= $current_minimum_call - $running_total_worked; 	~last_out	= GetAsTime ( $last_time_out_ts_c ); 	~new_out		= ~last_out + ~missing ]; 	List ( 		"source="		& CF_addPSlashes ( $last_record ); 		"time_in="		& CF_TimeFormat ( ~last_out ); 		"time_out="		& CF_TimeFormat ( ~new_out ); 		"hrsUnworked="	& ~missing; 		"incl_NT="		& $minimums_included_in_NT; 		"incl_OT="		& $minimums_included_in_OT; 		"note="			& "Minimum Call Applied"; 	) ) ]
End If
Set Variable [ $start_of_call_repetition ; Value: $i ]
Set Variable [ $last_min_call ; Value: "" ]
Set Variable [ $time_gap ; Value: 0 ]
End If
#  Reset counters
Set Variable [ $running_total_worked ; Value: 0 ]
Set Variable [ $running_total_unworked ; Value: 0 ]
Set Variable [ $call_count ; Value: $call_count + 1 ]
#  Regardless of Job Title-specific minimums, the subsequent calls use the 2nd Call (next) value.
Set Variable [ $current_minimum_call ; Value: Time ( $hrs_minimum_next; 0; 0 ) ]
End If
# 
# 
# 
#  Start to examine each Time Card Line (variable) for its Minimum Call qualifications.
If [ False ]
# 
# 
# 
#  If the current record is a Minumum Call record ...
Else If [ $this_isMinimumCall ]
Set Variable [ $running_total_worked ; Value: $running_total_worked + $this_duration ]
Set Variable [ $running_total_unworked ; Value: 0 ]
# 
# 
#  If the current record is an Ignore Minumum Call record ...
Else If [ $this_ignoreMinimumCall ]
# 
# 
#  If the current record is an un-paid meal ...
Else If [ $this_isUnpaidMeal ]
#  If the current record + the preceeding time gap + the running total of unworked time is more than is allowed...
If [ $this_duration + $time_gap + $running_total_unworked > $hrs_meal_break_max ]
#  If we have done any work at all, but not enough to meet the minimum...
If [ $running_total_worked > 0 	and $running_total_worked < $current_minimum_call ]
If [ $minimums_are_worked_time ]
Perform Script [ “Create Worked Entry” ; Specified: From list ; Parameter: Let ([ 	~missing		= $current_minimum_call - $running_total_worked; 	~last_out	= GetAsTime ( $last_time_out_ts_c ); 	~new_out		= ~last_out + ~missing ]; 	List ( 		"iSource="	& $start_of_call_repetition; 		"time_in="	& CF_TimeFormat ( ~last_out ); 		"time_out="	& CF_TimeFormat ( ~new_out ); 		"incl_NT="	& True;  //  $minimums_included_in_NT; 		"incl_OT="	& True;  //  $minimums_included_in_OT; 		"note="		& "Minimum Call Applied"; 	) ) ]
Set Variable [ $record_count ; Value: $record_count + 1 ]
Else
# KL 3/19/22
// Perform Script [ “Create Unworked Entry” ; Specified: From list ; Parameter: List ( 	"source="		& CF_addPSlashes ( Evaluate ( "$$" & $$this_mode & "[" & $start_of_call_repetition & "]" )); //	"time_in="		& CF_TimeFormat ( ~last_out ); //	"time_out="		& CF_TimeFormat ( ~new_out ); 	"hrsUnworked="	& $current_minimum_call - $running_total_worked; 	"incl_NT="		& True;  //  $$minimums_included_in_NT; 	"incl_OT="		& True;  //  $$minimums_included_in_OT; 	"note="			& "Minimum Call Applied"; ) ]
Perform Script [ “Create Unworked Entry” ; Specified: From list ; Parameter: Let ([ 	~missing		= $current_minimum_call - $running_total_worked; 	~last_out	= GetAsTime ( $last_time_out_ts_c ); 	~new_out		= ~last_out + ~missing ]; 	List ( 		"source="		& CF_addPSlashes ( $last_record ); 		"time_in="		& CF_TimeFormat ( ~last_out ); 		"time_out="		& CF_TimeFormat ( ~new_out ); 		"hrsUnworked="	& ~missing; 		"incl_NT="		& $minimums_included_in_NT; 		"incl_OT="		& $minimums_included_in_OT; 		"note="			& "Minimum Call Applied"; 	) ) ]
End If
Set Variable [ $i ; Value: $i + 1 ]
Set Variable [ $call_count ; Value: $call_count + 1 ]
End If
#  Reset counters
Set Variable [ $running_total_worked ; Value: 0 ]
Set Variable [ $running_total_unworked ; Value: 0 ]
Set Variable [ $last_min_call ; Value: "" ]
Else
Set Variable [ $running_total_unworked ; Value: $running_total_unworked + $this_duration ]
End If
# 
# 
# 
#  Otherwise the current record is honest work ...
Else
Set Variable [ $running_total_worked ; Value: $running_total_worked + $this_duration ]
Set Variable [ $running_total_unworked ; Value: 0 ]
# 
# 
# 
End If
# 
#  Remember the last OUT timestamp, so that it can be compared with the next IN timestamp, watching for (unpaid meal) gaps.
Set Variable [ $last_time_out_ts_c ; Value: If ( $running_total_worked = 0 and $running_total_unworked = 0 and $last_min_call = ""; 	""; 	$this_time_out_ts_c ) ]
#  Remember the last minimum call requirement, so that it can be compared with the next line's minimum.
Set Variable [ $last_min_call ; Value: $cjt_min_call ]
#  Remember the last record, as it may be needed when we create a Minimum Call record
Set Variable [ $last_record ; Value: $this_record ]
# 
#  End of record loop
End Loop
# 
# @history 08/07/2024, chris.corsi@proofgeist.com - @TODO finish fixing minimums to consider unworked time
# @history Jul 9, 2024, chris.corsi@proofgeist.com: Loop through the Unworked virtual time
# @history 02/12/2026, chris.corsi@proofgeist.com - Simplified unworked loop to accumulate-only.
#   Unworked entries are not chronologically ordered relative to the bill/pay array, so gap detection
#   and entry creation were producing nonsensical results (wrong array indexes for iSource, stale
#   $last_time_out_ts_c from the main loop). Now this loop only counts unworked credited hours toward
#   $running_total_worked so the post-loop minimum check can make the correct shortfall decision.
#   Uses $this_hrsUnworked (not $this_duration) as the authoritative credited-time value.
#
#  Loop through $$unwork[] to count credited hours toward the minimum call running total.
Set Variable [ $unwork_count ; Value: $$unwork_count ]
Set Variable [ $i ; Value: 0 ]
Loop [ Flush: Always ]
Exit Loop If [ Let ( $i = $i + 1; $i > $unwork_count ) ]
#
Set Variable [ $this_record ; Value: Evaluate ( "$$unwork[$i]" ) ]
Set Variable [ $this_isBill ; Value: CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::isBill )) ]
Set Variable [ $this_isPay ; Value: CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::isPay )) ]
# Skip to the next unworked record if this doesn't match the mode
If [ $$this_mode = "bill" and $this_isBill or $$this_mode = "pay" and $this_isPay ]
Set Variable [ $this_hrsUnworked ; Value: GetAsTime ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::hrsUnworked ))) ]
Set Variable [ $this_isMinimumCall ; Value: GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::isMinimumCall ))) ]
Set Variable [ $this_ignoreMinimumCall ; Value: GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::ignoreMinimumCall ))) ]
Set Variable [ $this_isUnpaidMeal ; Value: GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::isUnpaidMeal ))) ]
#
#  Count credited unworked time toward the minimum (skip ignored and unpaid meal entries)
If [ not $this_ignoreMinimumCall and not $this_isUnpaidMeal ]
Set Variable [ $running_total_worked ; Value: $running_total_worked + $this_hrsUnworked ]
End If
#
End If
#  End of unworked record loop
End Loop
# 
#  If we have finished examining the TCL records, and have not met the Minimum Call requirements ...
// If [ $running_total_worked > 0 	and $running_total_worked < $current_minimum_call ]
#  KL 6/21/22 Added if this line has been marked ignore minimum call
If [ $running_total_worked > 0 	and $running_total_worked < $current_minimum_call 	and $this_ignoreminimumcall ≠ 1 ]
#  Make a new Minimum Call record
If [ $minimums_are_worked_time ]
// Perform Script [ “Create Worked Entry” ; Specified: From list ; Parameter: Let ([ 	~missing		= $current_minimum_call - $running_total_worked; 	~last_out	= GetAsTime ( $last_time_out_ts_c ); 	~new_out		= ~last_out + ~missing ]; 	List ( 		"iSource="	& $start_of_call_repetition; 		"time_in="	& CF_TimeFormat ( ~last_out ); 		"time_out="	& CF_TimeFormat ( ~new_out ); 		"incl_NT="	& True;  //  $minimums_included_in_NT; 		"incl_OT="	& True;  //  $minimums_included_in_OT; 		"last_rec="	& True; 		"note="		& "Minimum Call Applied"; 	) ) ]
Perform Script [ “Create Worked Entry” ; Specified: From list ; Parameter: Let ([ 	~missing		= $current_minimum_call - $running_total_worked; 	~last_out	= GetAsTime ( $last_time_out_ts_c ); 	~new_out		= ~last_out + ~missing ]; 	List ( 		"iSource="	& $i - 1; 		"time_in="	& CF_TimeFormat ( $this_time_out ); 		"time_out="	& CF_TimeFormat ( ~new_out ); 		"incl_NT="	& True;  //  $minimums_included_in_NT; 		"incl_OT="	& True;  //  $minimums_included_in_OT; 		"last_rec="	& True; 		"note="		& "Minimum Call Applied"; 	) ) ]
Else
#  KL 3/19/22
// Perform Script [ “Create Unworked Entry” ; Specified: From list ; Parameter: List ( 	"source="		& CF_addPSlashes ( Evaluate ( "$$" & $$this_mode & "[" & $start_of_call_repetition & "]" )); //	"time_in="		& CF_TimeFormat ( ~last_out ); //	"time_out="		& CF_TimeFormat ( ~new_out ); 	"hrsUnworked="	& $current_minimum_call - $running_total_worked; 	"incl_NT="		& True;  //  $$minimums_included_in_NT; 	"incl_OT="		& True;  //  $$minimums_included_in_OT; 	"note="			& "Minimum Call Applied"; ) ]
Perform Script [ “Create Unworked Entry” ; Specified: From list ; Parameter: Let ([ 	~missing		= $current_minimum_call - $running_total_worked; 	~last_out	= GetAsTime ( $last_time_out_ts_c ); 	~new_out		= ~last_out + ~missing ]; 	List ( 		"source="		& CF_addPSlashes ( $last_record ); 		"time_in="		& CF_TimeFormat ( ~last_out ); 		"time_out="		& CF_TimeFormat ( ~new_out ); 		"hrsUnworked="	& ~missing; 		"incl_NT="		& $minimums_included_in_NT; 		"incl_OT="		& $minimums_included_in_OT; 		"note="			& "Minimum Call Applied"; 	) ) ]
End If
End If
# 
Exit Loop If [ True		//  Always exit the single-iteration control loop to prevent infinite spin!  ]
End Loop
# 
#  Cleanup steps: close worker windows, gather script results, etc...
Set Variable [ $result ; Value: List	( 	"error="			& If ( IsEmpty ( $error ); 0; $error ); 	"message="		& CF_addPSlashes ( $message ); 	"scriptName="	& Get ( ScriptName ); ) ]
# 
#  That's it - exit script!
Exit Script [ Text Result: $result		//  We always return the result variable  ]
# 

```
