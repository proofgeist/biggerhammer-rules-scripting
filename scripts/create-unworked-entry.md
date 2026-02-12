# Create Unworked Entry

> Creates a $$unwork[n] entry for penalty/premium hours (MINOR BUG: commented-out timestamp fix)

## Script Text

```
# # Create unworked entry 
#  Creates a global variable repetition containing the data of a rule variable, modified to be a Minimum Call record.
# 
# @history
#  06/08/2017 - Marc Berning - Initial Version
#  06/09/2017 - Marc Berning - Disabled the setting of several fields, so that the Minimum Call record preserves the status of the TCL that initiated its creation.
#  04/05/2018 - Marc Berning - Added $hrsUnworked parameter, support for isFlat field
#  05/07/2018 - Marc Berning - Renamed script.  Added isMinimumcall parameter.  Enhanced isAfterMidnight calculation.
#  02/15/2019 - Kate Lee - Added contractJobTitle parameter
#  03/12/2019 - Marc Berning - contractJobTitle must be treated as an optional parameter.  Enhanced script documentation.
# 
# @assumptions
#  Environment: Allow User Abort & Error Capture states are appropriately set.
#  Environment: The parameters have already been adequately validated.
# 
# @param text $source (req): The complete set of name-value data upon which the unworked record is to be based.
# @param time $time_in (opt):
# @param time $time_out (opt):
# @param bool $isMinimumCall (opt): defaults to True
# @param time $hrsUnworked (opt):  If $time_in and $time_out are not provided, this can be used.
# @param bool $incl_NT (opt): Include Minimum Call records when calculating Night Rate
# @param bool $incl_OT (opt): Include Minimum Call records when calculating Overtime
# @param num $isFlat (opt): is Flat.  Default: 0
# @param bool $isMP1 (opt): is Meal Penalty.  Default: False
# @param bool $isMP2 (opt): is Meal Penalty.  Default: False
# @param bool $isTurnaround (opt): is Turnaround.  Default: False
# @param num $baseRateOverride (opt): is Turnaround.  Default: False
# @param text $note (opt): The text for the Note field. 
# 
# 
#  Parse out script parameters here.
Set Variable [ $scriptParams ; Value: Get ( ScriptParameter ) ]
Set Variable [ $source ; Value: CF_getProperty ( $scriptParams; "source" ) ]
Set Variable [ $time_in ; Value: Let ( 	~t = CF_getProperty ( $scriptParams; "time_in" ); 	If ( IsEmpty ( ~t ); ""; GetAsTime ( ~t )) ) ]
Set Variable [ $time_out ; Value: Let ( 	~t = CF_getProperty ( $scriptParams; "time_out" ); 	If ( IsEmpty ( ~t ); ""; GetAsTime ( ~t )) ) ]
Set Variable [ $isMinimumCall ; Value: Let ( 	~m = CF_getProperty ( $scriptParams; "isMinimumCall" ); 	If ( IsEmpty ( ~m ); True; GetAsBoolean ( ~m )) ) ]
Set Variable [ $hrsUnworked ; Value: CF_getProperty ( $scriptParams; "hrsUnworked" ) ]
Set Variable [ $incl_NT ; Value: GetAsBoolean ( CF_getProperty ( $scriptParams; "incl_NT" )) ]
Set Variable [ $incl_OT ; Value: GetAsBoolean ( CF_getProperty ( $scriptParams; "incl_OT" )) ]
Set Variable [ $isFlat ; Value: Let ( 	~flat = CF_getProperty ( $scriptParams; "isFlat" ); 	If ( IsEmpty ( ~flat ); 0; GetAsNumber ( ~flat )) ) ]
Set Variable [ $isMP1 ; Value: Let ( 	~mp = CF_getProperty ( $scriptParams; "isMP1" ); 	If ( IsEmpty ( ~mp ); False; GetAsBoolean ( ~mp )) ) ]
Set Variable [ $isMP2 ; Value: Let ( 	~mp = CF_getProperty ( $scriptParams; "isMP2" ); 	If ( IsEmpty ( ~mp ); False; GetAsBoolean ( ~mp )) ) ]
Set Variable [ $isTurnaround ; Value: Let ( 	~turnaround = CF_getProperty ( $scriptParams; "isTurnaround" ); 	If ( IsEmpty ( ~turnaround ); False; GetAsBoolean ( ~turnaround )) ) ]
Set Variable [ $baseRateOverride ; Value: GetAsNumber ( CF_getProperty ( $scriptParams; "baseRateOverride" )) ]
Set Variable [ $note ; Value: CF_getProperty ( $scriptParams; "note" ) ]
Set Variable [ $contractJobTitle ; Value: CF_getProperty ( $scriptParams; "contractJobTitle_id" ) ]
# 
# 
#  Calculate the afterMidnight-ness
Set Variable [ $isAfterMidnight ; Value: Let ([ 	~ts_date	= GetAsDate ( CF_getProperty ( $source; GFN ( TCL__TimeCardLine::time_out_ts_c ))); 	~date	= GetAsDate ( CF_getProperty ( $source; GFN ( TCL__TimeCardLine::date ))) ]; 	Case ( 		~ts_date > ~date; 			True; 		IsEmpty ( $time_in ); 			False… ]
# 
#  Create the new Unworked record.
Set Variable [ $null ; Value: Let ( 	$$unwork_count = $$unwork_count + 1; 	CF_SetVarByName ( "$$unwork"; $$unwork_count; $source ) ) ]
# 
# @history 08/07/2024, chris.corsi@proofgeist.com - Finish reworking unworked entry to consider updated source fields
# @history Jul 15, 2024, chris.corsi@proofgeist.com - if they provided new times, the "source" times conflict with the new times, they need to be reset
# @history 02/12/2026, chris.corsi@proofgeist.com - Uncommented timestamp fix: when callers provide
#   new time_in/time_out values, the source record's time_in_ts_c and time_out_ts_c were preserved
#   unchanged, causing inconsistent time data on the unworked record. Now reconstructs both timestamp
#   fields from the source date + the provided times. This is a prerequisite for any downstream script
#   that reads $$unwork[] entries by their timestamp fields (e.g., the Minimum Calls unworked loop).
#   Also added $isAfterMidnight and midnight-wrap handling to match Create Worked Entry's pattern.

# Parse the new time_in/time_out tsc
Set Variable [ $date ; Value: CF_getProperty ( $source; "date" ) ]
Set Variable [ $ts_date ; Value: $date + $isAfterMidnight ]
#  Set the "new" dates
If [ not IsEmpty ( $time_in ) ]
Set Variable [ $time_in_tsc ; Value: Timestamp ( $ts_date ; $time_in ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::time_in_ts_c ); $time_in_tsc ) ]
End If
If [ not IsEmpty ( $time_out ) ]
Set Variable [ $time_out_tsc ; Value: Let ( ~date = If ( not $isAfterMidnight and $time_out < $time_in; $ts_date + 1; $ts_date ); Timestamp ( ~date ; $time_out ) ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::time_out_ts_c ); $time_out_tsc ) ]
End If
# 
#  Set a few fields
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::time_in ); $time_in ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::time_out ); $time_out ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( 	$$unwork[$$unwork_count]; 	GFN ( TCL__TimeCardLine::isAfterMidnight ); 	$isAfterMidnight ) ]
# 
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::hrsUnworked ); If ( IsEmpty ( $hrsUnworked ); $time_out - $time_in; $hrsUnworked )) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isFlat ); $isFlat ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isMinimumCall ); $isMinimumCall ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isMP1 ); $isMP1 ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isMP2 ); $isMP2 ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isTurnaround ); $isTurnaround ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::noteRule ); $note ) ]
# 
#  Clear a few fields
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isOutOfWhack ); False ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isPaidMeal ); False ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isUnpaidMeal ); False ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::noteGracePeriod ); "" ) ]
# 
#  If passed as a parameter
If [ not IsEmpty ( $contractJobTitle ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::_contractJobTitle_id ); $contractJobTitle ) ]
End If
# 
#  If passed as a parameter
If [ not IsEmpty ( $baseRateOverride ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::dollarsBaseRateOverride ); $baseRateOverride ) ]
End If
# 
#  If the System Preference indicates that Minimum Call CANNOT be paid at OT...
If [ not $incl_OT ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isOTDailyL1 ); False ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isOTDailyL2 ); False ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isOTWeekly ); False ) ]
End If
# 
#  If the System Preference indicates that Minimum Call CANNOT be paid at Night Rate...
If [ $incl_NT ]
If [ $time_in = Time ( 0; 0; 0 ) ]
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isNightRate ); False ) ]
End If
Else
Set Variable [ $$unwork[$$unwork_count] ; Value: CF_setPropertyValue ( $$unwork[$$unwork_count]; GFN ( TCL__TimeCardLine::isNightRate ); False ) ]
End If
# 
#  That's it - exit script!
Exit Script [ Text Result: True		//  We always return something  ]
# 

```
