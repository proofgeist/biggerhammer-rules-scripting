# Before/After Unpaid Meal

> Break-adjacent hour adjustments (ROOT CAUSE of multiple-breaks bug)

## Script Text

```
# #Before/after unpaid meal 
#  Applies Before & After Unpaid Meal Penalty rules to the Time Card Lines
#  As a modular script, several assumptions will be made regarding the context & environment.
#  As a PSOS script, we want to avoid opening windows, and ALL user interactions..
# 
# @history
#  07/28/2015 - Deborah Norton - Initial version
#  06/18/2015 - Marc Berning - Rewrite for transactionality using GLOBAL table
#  11/03/2015 - Marc Berning - Converted to modular script.
#  11/16/2015 - Marc Berning - Rewrite to do major processing in memory only.
#  03/10/2016 - Marc Berning - Added $last_meal check & recorded said value in note field.
#  03/10/2016 - Marc Berning - Added After Unpaid Meal Min Call check when TCD includes multiple unpaid meals.
#  08/19/2017 - Marc Berning - Between-meal minimum is assumed to be the lesser of the Before & After minimum.
#  08/23/2017 - Marc Berning - If Minimum Call would be required in addition to an 'after_unpaid_meal' record, the 'after_unpaid_meal' record is ignored, leaving the Minimum call rule to fill out the time card.
#  08/30/2017 - Marc Berning - Adapted for Bigger Hammer
#  02/27/2018 - Marc Berning - If the timeline gap is > Max Unpaid Meal Break, this rule does nothing, leaving the issue for the Minimum Call rule.
# 
# @assumptions
#  Context: We are already oriented to a Globals-based layout.
#  Context: The "current" Time Card is & its related Contract is available via the GLO_TCD__Timecard and GLO_TCD_CTR__Contract relationships.
#  Environment: Allow User Abort & Error Capture states are appropriately set.
# 
# @return num $error (req): non-zero indicates a problem
# @return text $message (cond): Human readable message about the general outcome of the script. Requied if error.
# 
# @rule           An employee must be paid for {rule_before_unpaid_meal} (3) hours before they can be dismissed for an unpaid meal break.
# @rule           Additionally, they must be paid for {rule_after_unpaid_meal} (1.5) hours before being dismissed.
# 
# 
#  Single-iteration loop
Loop [ Flush: Always ]
# 
#  Preheat variables here
Set Variable [ $call_count ; Value: 0 ]
Set Variable [ $meal_counter ; Value: 0 ]
Set Variable [ $new_record_count ; Value: 0 ]
Set Variable [ $since_last_meal ; Value: 0 ]
Set Variable [ $since_start_of_call ; Value: 0 ]
Set Variable [ $since_unpaid_meal ; Value: 0 ]
Set Variable [ $start_ts ; Value: $$start_ts ]
# 
#  Prepare a set of variables based on Contract values.  While not necessary, this will make reading/writing the script easier.
Set Variable [ $hrs_before_unpaid_meal ; Value: GLO_TCD_CTR__Contract::hrs_before_unpaid_meal ]
Set Variable [ $hrs_after_unpaid_meal ; Value: GLO_TCD_CTR__Contract::hrs_after_unpaid_meal ]
Set Variable [ $hrs_between_unpaid_meal ; Value: If ( $hrs_before_unpaid_meal ≤ 0 or $hrs_after_unpaid_meal ≤ 0; 	Max ( $hrs_before_unpaid_meal; $hrs_after_unpaid_meal ); 	Min ( $hrs_before_unpaid_meal; $hrs_after_unpaid_meal ) ) ]
Set Variable [ $hrs_meal_break_max ; Value: Let ( 	~max = GLO_TCD_CTR__Contract::hrs_meal_break_max; 	If ( IsEmpty ( ~max ); 		24; 		~max 	) ) ]
#  KL 03/03/2022 Since BH changed contract to Minimums are Unworked Time, BUT this rule should still create worked time as per the beautiful Michelle
// Set Variable [ $minimums_are_worked_time ; Value: True ]
# @history 08/07/2024, chris.corsi@proofgeist.com - @TODO - finish rewrite of minimums overlap
# @history Jun 28, 2024, chris.corsi@proofgeist.com - stepped back on this, mins should be unworked
Set Variable [ $minimums_are_worked_time ; Value: GetAsBoolean ( GLO_TCD_CTR__Contract::minimums_are_worked_time ) ]
# 
#  With the advent of multiple minimum call values, extra work is required to accurately determine what it should be.
If [ not IsEmpty ( GLO_TCD_CTR__Contract::hrs_minimum_call ) ]
Set Variable [ $hrs_minimum_first ; Value: GLO_TCD_CTR__Contract::hrs_minimum_call ]
Set Variable [ $hrs_minimum_next ; Value: GLO_TCD_CTR__Contract::hrs_minimum_call ]
Else
Set Variable [ $the_rule ; Value: Let ([ 	~names	= Substitute ( CF_GetArrayColumn ( $$contract_rules; 1; "∞" ); "name="; "" ); 	~pos1	= CF_ListValuePositions ( ~names ; "Minimum Call"; 1 ); 	~pos2	= CF_ListValuePositions ( ~names ; "Minimum Call (2-tier)"; 1 ); 	~pos		= List ( ~pos1; ~po… ]
If [ not IsEmpty ( $the_rule ) ]
Set Variable [ $hrs_minimum_first ; Value: GetAsNumber ( CF_getProperty ( $the_rule; "hour1" )) ]
Set Variable [ $hrs_minimum_next ; Value: Let ( 	~2 = GetAsNumber ( CF_getProperty ( $the_rule; "hour2" )); 	If ( IsEmpty ( ~2 ); 		$hrs_minimum_first; 		~2 	) ) ]
End If
End If
# 
# 
# 
# 
# ##########################################################################################
#    Part 1 - Collect info about what happened before the start of the current time card.
#    ALL of Part 1 can be disabled if it is deemed not appropriate for the client.
# ##########################################################################################
# 
# 
#  Assemble a list of Time Card Line IDs (without Minimum Calls or Unpaid Meals) from before the start of this time card.
Perform Script [ “Create History Variables” ; Specified: From list ; Parameter: Let ( 	~match = List ( 		GFN ( TCL__TimeCardLine::date ); 		GFN ( TCL__TimeCardLine::ignoreMealPenatly ); 		GFN ( TCL__TimeCardLine::isMP1 ); 		GFN ( TCL__TimeCardLine::isMP2 ); 		GFN ( TCL__TimeCardLine::isPaidMeal ); 		GFN ( TCL__TimeCardLine::time_in_ts_c ); 		GFN ( TCL__TimeCardLine::time_out_ts_c ); 	); 	List ( 		"start_date="	& GLO_TCD__TimeCard::date - 1; 		"end_ts="		& $$start_ts; 		"match_fields="	& CF_addPSlashes ( ~match ); 		"sort="			& "DESC"; 	) ) ]
Set Variable [ $scriptResult ; Value: Let ( 	~error = Get ( LastError ); 	If ( ~error; 		List ( "error=" & ~error; "message=Error: " & ~error & " - Perform Script error" ); 		Get ( ScriptResult ) 	) ) ]
Set Variable [ $error ; Value: GetAsNumber ( CF_getProperty ( $scriptResult; "error" )) ]
Set Variable [ $message ; Value: CF_getProperty ( $scriptResult; "message" ) ]
Set Variable [ $history_count ; Value: GetAsNumber ( CF_getProperty ( $scriptResult; "count" )) ]
If [ $error ]
Set Variable [ $error ; Value: True ]
Exit Loop If [ True ]
End If
# 
#  Loop through the history "records", looking for a paid or unpaid meal break.
Set Variable [ $i ; Value: 0 ]
Loop [ Flush: Always ]
Exit Loop If [ Let ( $i = $i + 1; $i > $history_count ) ]
# 
#  Retrieve a few fields from the current $$history record.
Set Variable [ $history_time_in_ts_c ; Value: GetAsTimestamp ( CF_getProperty ( $$history[$i]; GFN ( TCL__TimeCardLine::time_in_ts_c ))) ]
Set Variable [ $history_time_out_ts_c ; Value: GetAsTimestamp ( CF_getProperty ( $$history[$i]; GFN ( TCL__TimeCardLine::time_out_ts_c ))) ]
Set Variable [ $history_isPaidMeal ; Value: GetAsBoolean ( CF_getProperty ( $$history[$i]; GFN ( TCL__TimeCardLine::isPaidMeal ))) ]
# 
#  Was there enough time off from the end of this line to the start of the next?
If [ $start_ts - $history_time_out_ts_c ≥ Time ( $hrs_meal_break_min; 0; 0 ) 	or $history_isPaidMeal ]
#  We've gone far enough.  
Exit Loop If [ True ]
Else
#  Update the start time, rinse & repeat.
Set Variable [ $start_ts ; Value: $history_time_in_ts_c ]
End If
End Loop
# 
#  Now that we know how far back in time we need to go, we can clean up some (or all) of the $$history variable(s).
Set Variable [ $null ; Value: CF_ClearRepeatingVariable ( "$$history"; $i; $history_count ) ]
Set Variable [ $history_count ; Value: $i - 1 ]
# 
#  Loop through the history records, totaling worked hours as we go.
Set Variable [ $i ; Value: $history_count + 1 ]
Loop [ Flush: Always ]
Exit Loop If [ Let ( $i = $i - 1; $i < 1 ) ]
# 
#  Retrieve a few fields from the current $$history record.
Set Variable [ $history_time_in_ts_c ; Value: GetAsTimestamp ( CF_getProperty ( $$history[$i]; GFN ( TCL__TimeCardLine::time_in_ts_c ))) ]
Set Variable [ $history_time_out_ts_c ; Value: GetAsTimestamp ( CF_getProperty ( $$history[$i]; GFN ( TCL__TimeCardLine::time_out_ts_c ))) ]
# 
#  Update the running total
Set Variable [ $since_last_meal ; Value: $since_last_meal + ( $history_time_out_ts_c - $history_time_in_ts_c ) ]
# 
#  End of History Record loop.
End Loop
# 
# 
# 
# 
# ##########################################################################################
#    Part 2 - Loop through the Time Card Lines.
# ##########################################################################################
# 
# 
#  Instanciate a mode-specific record count variable.
Set Variable [ $record_count ; Value: Evaluate ( "$$" & $$this_mode & "_count" ) ]
# 
# @history 02/12/2026, chris.corsi@proofgeist.com - Account for Minimum Call unworked credits.
#   When minimums_are_worked_time = False, Minimum Calls (rule 3) creates entries in $$unwork[]
#   instead of $$bill/$$pay. Without this loop, Before/After can't see those entries and may create
#   redundant shortfall entries for the same gap. Sum MC unworked credits and add to $since_last_meal
#   so the shortfall checks account for time already credited.
#   Note: credit is applied at initialization, so it primarily covers the first gap encountered.
#   Multi-gap time cards with MC entries at later gaps may not be fully covered — this is conservative
#   (under-credits rather than over-credits) and can be refined if needed.
Set Variable [ $mc_unwork_credit ; Value: 0 ]
Set Variable [ $j ; Value: 0 ]
Loop [ Flush: Always ]
Exit Loop If [  Let ( $j = $j + 1; $j > $$unwork_count ) ]
Set Variable [ $uw_record ; Value: Evaluate ( "$$unwork[$j]" ) ]
Set Variable [ $uw_isBill ; Value: CF_getProperty ( $uw_record; GFN ( TCL__TimeCardLine::isBill )) ]
Set Variable [ $uw_isPay ; Value: CF_getProperty ( $uw_record; GFN ( TCL__TimeCardLine::isPay )) ]
If [ ( $$this_mode = "bill" and $uw_isBill ) or ( $$this_mode = "pay" and $uw_isPay ) ]
Set Variable [ $uw_isMinimumCall ; Value: GetAsBoolean ( CF_getProperty ( $uw_record; GFN ( TCL__TimeCardLine::isMinimumCall ))) ]
If [ $uw_isMinimumCall ]
Set Variable [ $mc_unwork_credit ; Value: $mc_unwork_credit + GetAsTime ( CF_getProperty ( $uw_record; GFN ( TCL__TimeCardLine::hrsUnworked ))) ]
End If
End If
End Loop
Set Variable [ $since_last_meal ; Value: $since_last_meal + $mc_unwork_credit / 3600 ]
# 
#  Prepare a bucket to count work since the start of the call
Set Variable [ $since_start_of_call ; Value: $since_last_meal ]
# 
#  Loop through the Time Card Lines
Set Variable [ $tcl_loop ; Value: 0 ]
Loop [ Flush: Always ]
Exit Loop If [ Let ( $tcl_loop = $tcl_loop + 1; $tcl_loop > $record_count ) ]
# 
#  Break a few "field" values out into dedicated varaibles.  This will make reading/writing this script easier.
Set Variable [ $this_record ; Value: Evaluate ( "$$" & $$this_mode & "[$tcl_loop]" ) ]
Set Variable [ $this_date ; Value: GetAsDate ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::date ))) ]
Set Variable [ $this_time_in ; Value: GetAsTime ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::time_in ))) ]
Set Variable [ $this_time_out ; Value: GetAsTime ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::time_out ))) ]
Set Variable [ $this_time_in_ts_c ; Value: GetAsTimestamp ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::time_in_ts_c ))) ]
Set Variable [ $this_time_out_ts_c ; Value: GetAsTimestamp ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::time_out_ts_c ))) ]
Set Variable [ $this_isUnpaidMeal ; Value: GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::isUnpaidMeal ))) ]
Set Variable [ $this_isPaidMeal ; Value: GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::isPaidMeal ))) ]
Set Variable [ $this_isFlat ; Value: GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::isFlat ))) ]
Set Variable [ $this_duration ; Value: ( $this_time_out_ts_c - $this_time_in_ts_c ) / 3600 ]
# 
# KL 12/6/21
Set Variable [ $this_ignoreMinimumCall ; Value: GetAsBoolean ( CF_getProperty ( $this_record; GFN ( TCL__TimeCardLine::ignoreMinimumCall ))) ]
# 
#  Calculate the appropriate minimum call value
Set Variable [ $hrs_minimum_call ; Value: If ( $call_count = 0; $hrs_minimum_first; $hrs_minimum_next ) ]
# 
# 
# 
# 
#  Begin by evaluating the (potential) gap between the last record and the start of this.
#  If this is NOT the first record, and there is a gap in the timeline BEFORE the current record...
If [ not IsEmpty ( $last_time_out_ts ) 	and GetAsBoolean ( $this_time_in_ts_c - $last_time_out_ts )	// True means a time gap  ]
If [ not $this_ignoreMinimumCall ]
If [ False ]
// Else If [ $this_ignoreMinimumCall ]
# 
#  If the gap in the timeline is more than the Maximum meal break...
Else If [ ( $this_time_in_ts_c - $last_time_out_ts ) / 3600 > $hrs_meal_break_max ]
#
# @history 02/12/2026, chris.corsi@proofgeist.com - New call boundary; skip B/A.
#   When the gap exceeds the maximum meal break, this is a new call, not a meal
#   dismissal. Do not apply the after-unpaid-meal rule across the gap. The bucket
#   resets below handle the transition ($since_start_of_call = 0, etc.).
#   Previously this branch checked $since_unpaid_meal against $hrs_after_unpaid_meal
#   and could create spurious shortfall entries spanning the inter-call gap.
Set Variable [ $call_count ; Value: $call_count + 1 ]
# 
#  If there isn't enough paid time since our last meal break...
Else If [ Let ( 	$work_requirement = If ( $meal_counter = 0; 		$hrs_before_unpaid_meal; 		$hrs_between_unpaid_meal 	); 	$since_last_meal < $work_requirement ) ]
# 
#  we need to create a Minimum Call record.
If [ $minimums_are_worked_time ]
Perform Script [ “Create Worked Entry” ; Specified: From list ; Parameter: Let ([ 	~missing		= $work_requirement - $since_last_meal; 	~last_out	= GetAsTime ( $last_time_out_ts ); 	~new_out		= ~last_out + ( ~missing * 3600 ) ]; 	List ( 		"iSource="	& Max ( $tcl_loop - 1; 1 ); 		"time_in="	& CF_TimeFormat ( ~last_out ); 		"time_out="	& CF_TimeFormat ( ~new_out ); 		"incl_NT="	& $incl_NT; 		"incl_OT="	& $incl_OT; 		"note="		& "Before unpaid meal rule applied"; 	) ) ]
# 
# 
# 
# *********************
# KL 12-20-21
# this was causing an infnite loop, VM disabled 02/22
Set Variable [ $record_count ; Value: $record_count + 1 ]
# @history 02/12/2026, chris.corsi@proofgeist.com - reinstate this counter
Set Variable [ $tcl_loop ; Value: $tcl_loop + 1 ]
# *********************
# 
Else
Perform Script [ “Create Unworked Entry” ; Specified: From list ; Parameter: Let ([ 	~requirement = Case ( 		$call_count = 0; 			$hrs_before_unpaid_meal; 		( $this_time_in_ts - $last_time_out_ts ) / 3600 > $hrs_meal_break_max; 			$hrs_after_unpaid_meal; 		$hrs_between_unpaid_meal 	); 	~duration = GetAsTime (( ~requirement - $since_last_meal ) * 3600 ) ]; 	List ( 		"source="		& CF_addPSlashes ( $this_record ); 		"hrsUnworked="	& ~duration; 		"time_in="		& CF_TimeFormat ( GetAsTime ( $last_time_out_ts )); 		"time_out="		& CF_TimeFormat ( GetAsTime ( $last_time_out_ts + ~duration )); 		"incl_NT="		& $incl_NT; 		"incl_OT="		& $incl_OT; 		"note="			& "Before unpaid meal rule applied"; 	) ) ]
# 
# 
# 
# *********************
# KL 12-20-21
# this was causing an infnite loop, VM disabled 02/22
// Set Variable [ $record_count ; Value: $record_count + 1 ]
# *********************
# 
End If
End If
End If
# 
#  Empty the buckets.
Set Variable [ $since_last_meal ; Value: 0 ]
Set Variable [ $since_unpaid_meal ; Value: 0 ]
#  Increment the unpaid meal meal counter
Set Variable [ $meal_counter ; Value: $meal_counter + 1 ]
# 
#  If the time gap was longer than the Maximum Meal Break...
If [ ( $this_time_in_ts_c - $last_time_out_ts ) / 3600 > $hrs_meal_break_max ]
#  reset this counter too.
Set Variable [ $since_start_of_call ; Value: 0 ]
End If
End If
# 
# 
# 
# 
#  Evaluating the current TCL record.
If [ False ]
# 
# 
#  If the current record is a paid meal...
Else If [ $this_isPaidMeal ]
#  Empty one bucket, but not the others.
Set Variable [ $since_last_meal ; Value: 0 ]
Set Variable [ $since_unpaid_meal ; Value: $since_unpaid_meal + $this_duration ]
// Set Variable [ $since_unpaid_meal ; Value: 0 ]
Set Variable [ $since_start_of_call ; Value: $since_start_of_call + $this_duration ]
# 
# 
#  If the current record is NOT an unpaid meal, in other words, work...
Else If [ not $this_isUnpaidMeal ]
#  Add it to the buckets.
Set Variable [ $since_last_meal ; Value: $since_last_meal + $this_duration ]
Set Variable [ $since_unpaid_meal ; Value: $since_unpaid_meal + $this_duration ]
Set Variable [ $since_start_of_call ; Value: $since_start_of_call + $this_duration ]
# 
# 
#  otherwise this is an unpaid meal.
Else
# 
#  If we don't have enough work in our bucket...
If [ Let ( 	$work_requirement = If ( IsEmpty ( $last_meal_id ); 		$hrs_before_unpaid_meal; 		$hrs_between_unpaid_meal 	); 	$since_last_meal < $work_requirement ) ]
# 
#  we need to create a Minimum record.
If [ $minimums_are_worked_time ]
Perform Script [ “Create Worked Entry” ; Specified: From list ; Parameter: Let ([ 	~missing		= $work_requirement - $since_last_meal; 	~last_out	= GetAsTime ( $last_time_out_ts ); 	~new_out		= ~last_out + ( ~missing * 3600 ) ]; 	List ( 		"iSource="	& Max ( $tcl_loop - 1; 1 ); 		"time_in="	& CF_TimeFormat ( ~last_out ); 		"time_out="	& CF_TimeFormat ( ~new_out ); 		"incl_NT="	& $incl_NT; 		"incl_OT="	& $incl_OT; 		"note="		& "Before unpaid meal rule applied"; 	) ) ]
# 
# 
# *********************
# KL 12-20-21
# this was causing an infnite loop, VM disabled 02/22
# @history 02/12/2026, chris.corsi@proofgeist.com - reinstate this counter
Set Variable [ $tcl_loop ; Value: $tcl_loop + 1 ]
Set Variable [ $record_count ; Value: $record_count + 1 ]
# *********************
# 
Else
Perform Script [ “Create Unworked Entry” ; Specified: From list ; Parameter: Let ( 	~duration = GetAsTime (( $work_requirement - $since_last_meal ) * 3600 ); 	List ( 		"source="		& CF_addPSlashes ( $this_record ); 		"hrsUnworked="	& ~duration; 		"time_in="		& CF_TimeFormat ( GetAsTime ( $last_time_out_ts )); 		"time_out="		& CF_TimeFormat ( GetAsTime ( $last_time_out_ts + ~duration )); 		"incl_NT="		& $incl_NT; 		"incl_OT="		& $incl_OT; 		"note="			& "Before unpaid meal rule applied @ " & CF_TimeFormat ( GetAsTime ( $last_time_out_ts )); 	) ) ]
# 
# 
# *********************
# KL 12-20-21
# this was causing an infnite loop, VM disabled 02/22
// Set Variable [ $record_count ; Value: $record_count + 1 ]
# *********************
# 
End If
End If
# 
#  Empty the buckets.
Set Variable [ $since_last_meal ; Value: 0 ]
Set Variable [ $since_unpaid_meal ; Value: 0 ]
Set Variable [ $meal_counter ; Value: $meal_counter + 1 ]
If [ $this_duration > $hrs_meal_break_max ]
Set Variable [ $since_start_of_call ; Value: 0 ]
Set Variable [ $call_count ; Value: $call_count + 1 ]
End If
End If
# 
#  Remember the last out timestamp.
Set Variable [ $last_time_out_ts ; Value: $this_time_out_ts_c ]
# 
#  End of Time Card Line loop
End Loop
# 
# 
# 
# 
# ##########################################################################################
#    Part 3 - Lastly we need to consider the After Unpaid Meal rule.
# ##########################################################################################
# 
# 
#  If there was at least 1 unpaid meal, and the amount of work since the meal is insufficient...
If [ $meal_counter > 0 	and $hrs_after_unpaid_meal > $since_unpaid_meal ]
# 
#  If the After Unpaid Meal record is sufficiemt to eliminate the need for a Minimum record...
If [ not IsEmpty ( $hrs_minimum_call ) 	and $hrs_after_unpaid_meal - $since_unpaid_meal > $hrs_minimum_call - $since_start_of_call ]
If [ not $this_IgnoreMinimumCall ]
#  we need to create a Minimum record.
If [ $minimums_are_worked_time ]
Perform Script [ “Create Worked Entry” ; Specified: From list ; Parameter: Let ([ 	~missing		= $hrs_after_unpaid_meal - $since_last_meal; 	~last_out	= GetAsTime ( $last_time_out_ts ); 	~new_out		= ~last_out + ( ~missing * 3600 ) ]; 	List ( 		"iSource="	& Max ( $tcl_loop - 1; 1 ); 		"time_in="	& CF_TimeFormat ( ~last_out ); 		"time_out="	& CF_TimeFormat ( ~new_out ); 		"incl_NT="	& $incl_NT; 		"incl_OT="	& $incl_OT; 		"last_rec="	& True; 		"note="		& "After unpaid meal rule applied"; 	) ) ]
# 
# 
# *********************
# KL 12-20-21
# this was causing an infnite loop, VM disabled 02/22
// Set Variable [ $record_count ; Value: $record_count + 1 ]
# *********************
# 
Else
Perform Script [ “Create Unworked Entry” ; Specified: From list ; Parameter: Let ( 	~duration = GetAsTime (( $hrs_after_unpaid_meal - $since_last_meal ) * 3600 ); 	List ( 		"source="		& CF_addPSlashes ( $this_record ); 		"hrsUnworked="	& ~duration; 		"time_in="		& CF_TimeFormat ( GetAsTime ( $last_time_out_ts )); 		"time_out="		& CF_TimeFormat ( GetAsTime ( $last_time_out_ts + ~duration )); 		"incl_NT="		& $incl_NT; 		"incl_OT="		& $incl_OT; 		"note="			& "After unpaid meal rule applied @ " & CF_TimeFormat ( GetAsTime ( $last_time_out_ts )); 	) ) ]
# 
# 
# *********************
# KL 12-20-21
# this was causing an infnite loop, VM disabled 02/22
// Set Variable [ $record_count ; Value: $record_count + 1 ]
# *********************
# 
End If
End If
End If
End If
# 
# 
# 
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
