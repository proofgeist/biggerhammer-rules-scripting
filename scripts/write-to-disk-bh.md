# Write to Disk - BH

> Creates or updates Time Card Line records from Bill & Pay variables

## Script Text

```
# #
#  Creates or updates Time Card Line records from Bill & Pay variables
#
# @history
#  12/02/2016 - Marc Berning - Initial Version
#  03/30/2017 - Marc Berning - Added the assembly and return of the list of Time Card Line IDs to the list of properties
#  02/25/2026 - Chris Corsi - Fixed column-assignment cascade in bill and unwork sections: moved isMP1/isMP2 check before isHoliday and isDayOfWeek so meal penalty hours on holidays route to hrsColumn4 (MP) instead of hrsColumn1 (OT/Holiday)
#
# @assumptions
#  Context: We are already oriented to a Globals-based layout.
#  Environment: Allow User Abort & Error Capture states are appropriately set.
#  Environment: Parameter(s) have already been validated
#
# @param enum $mode (req): Base variable name(s) to be used.  Valid values: "Bill", "Pay" or both.
#
# @return num $error (req): non-zero indicates a problem
# @return text $message (cond): Human readable message about the general outcome of the script. Requied if error.
# @return text $tcl_ids (cond): List of Time Card Line IDs.
#
#
#  Preheat variables here
Set Variable [ $startTime ; Value: Get ( CurrentTimeUTCMilliseconds ) ]
Set Variable [ $process_timer ; Value: $startTime ]
#
#  Single-iteration loop
Loop [ Flush: Always ]
#
#  Parse out script parameters here.
Set Variable [ $scriptParams ; Value: Get ( ScriptParameter ) ]
Set Variable [ $mode ; Value: CF_getProperty ( $scriptParams; "mode" ) ]
#
#  Preheat variables here
Set Variable [ $target_table_name ; Value: GTN ( GLO_TCL__TimeCardLine::__id ) ]
Set Variable [ $primary_key_name ; Value: GFN ( GLO_TCL__TimeCardLine::__id ) ]
Set Variable [ $timecard_key_name ; Value: GFN ( GLO_TCL__TimeCardLine::_timecard_id ) ]
Set Variable [ $column_fields ; Value: List ( GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn0 ); GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn1 ); GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn2 ); GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn3 ); GetFieldName ( GLO_TCL__TimeCardLi… ]
#
#  If the current Time Card has the TCL column definitions
If [ not IsEmpty ( GLO_TCD__TimeCard::tcl_columns ) ]
#  Set the column multipliers from the Time Card as a JSON array
Set Variable [ $mult_list ; Value: "" ]
Set Variable [ $j ; Value: 0 ]
Loop [ Flush: Always ]
Set Variable [ $mult_list ; Value: List ( $mult_list; JSONGetElement ( GLO_TCD__TimeCard::tcl_columns ; "[" & $j & "].mult" ) ) ]
Exit Loop If [ Let ( $j = $j + 1; $j > ValueCount ( JSONListKeys ( GLO_TCD__TimeCard::tcl_columns ; "" ))) ]
End Loop
Set Variable [ $tclx_array ; Value: "[" & Substitute ( $mult_list; ¶; "," ) & "]" ]
Exit Loop If [ IsEmpty ( $tclx_array ) or Left ( $tclx_array ; 1 ) = "?" ]
End If
#
#  Gather all the bill & pay IDs in one go.
Set Variable [ $bill_pay_ids ; Value: Let ([ ~table = SQLTable ( TCL__TimeCardLine::__id ); ~id = SQLField ( TCL__TimeCardLine::__id ); ~tcd_id = SQLField ( TCL__TimeCardLine::_timecard_id ); ~bill = SQLField ( TCL__TimeCardLine::isBill ); ~pay = SQLField ( TCL__TimeCardLine::isPay … ]
Exit Loop If [ CF_SQLErrorCheck ( "$bill_pay_ids" ) ]
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & "SQL Statement¶¶" ) ]
#
#  Outer loop to process each of the modes
Loop [ Flush: Always ]
Exit Loop If [ Let ( $i = $i + 1; $i > ValueCount ( $mode )) ]
Set Variable [ $this_mode ; Value: GetValue ( $mode; $i ) ]
#
#  Get a list of bill or pay TCL IDs, so that we can recycle those records, rather than always deleting & creating new records.
Set Variable [ $reusable_ids ; Value: Case ( $this_mode = "bill"; CF_GetArrayColumn ( $bill_pay_ids; 1; "," ); $this_mode = "pay"; CF_GetArrayColumn ( $bill_pay_ids; 2; "," ) ) ]
#
#  Loop through each "record" - which is still a repeating variable
Set Variable [ $j ; Value: 0 ]
Loop [ Flush: Always ]
Set Variable [ $startRecordTimer ; Value: Get ( CurrentTimeUTCMilliseconds ) ]
Set Variable [ $j ; Value: $j + 1 ]
Set Variable [ $this_source_variable ; Value: "$$" & $this_mode & "[" & $j & "]" ]
Set Variable [ $this_record ; Value: Evaluate ( $this_source_variable ) ]
Set Variable [ $field_count ; Value: ValueCount ( $this_record ) ]
Exit Loop If [ IsEmpty ( $this_record ) ]
#
#  Clear any pre-existing relationship so that we can create records as necessary.
Set Field [ GLO__Global::_new_id_g ; "" ]
#  Attempt to set the Primary key field first, so we don't inadvertantly create records needlessly.
Set Field [ GLO__Global::_new_id_g ; Pop ( "$reusable_ids" ) ]
#
#  Set the Time Card id, which will facilitate setting several fields via auto-enter calcs.
Set Variable [ $this_timecard_id ; Value: CF_getProperty ( $this_record ; $timecard_key_name ) ]
If [ Evaluate ( $target_table_name & "::" & $timecard_key_name ) ≠ $this_timecard_id ]
Set Field By Name [ $target_table_name & "::" & $timecard_key_name ; CF_getProperty ( $this_record ; $timecard_key_name ) ]
If [ Get ( LastError ) ]
Set Variable [ $error ; Value: Get ( LastError ) ]
Set Variable [ $message ; Value: CF_ErrorDescription ( $error ) ]
Exit Loop If [ True ]
End If
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & $timecard_key_name & ¶ ) ]
End If
#
#  Set the column_multipliers field needed soon for proper field assignments
If [ Evaluate ( $target_table_name & "::" & GFN ( TCL__TimeCardLine::column_multipliers )) ≠ $tclx_array ]
Set Field By Name [ $target_table_name & "::" & GFN ( TCL__TimeCardLine::column_multipliers ) ; $tclx_array ]
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & GFN ( TCL__TimeCardLine::column_multipliers ) & ¶ ) ]
End If
#
#  Loop through each of the name-value pairs, setting fields as we go.
Set Variable [ $k ; Value: 0 ]
Loop [ Flush: Always ]
Exit Loop If [ Let ( $k = $k + 1; $k > $field_count ) ]
Set Variable [ $this_name_value ; Value: GetValue ( $this_record; $k ) ]
If [ not IsEmpty ( $this_name_value ) ]
Set Variable [ $this_name ; Value: CF_getPropertyListKeys ( $this_name_value ) ]
If [ ValueCount ( FilterValues ( $this_name; List ( "_contact_id"; "_timecard_id"; "_vendor_id"; "date"; ) )) = 0 ]
If [ Right ( $this_name; 2 ) ≠ "_c" //  skip calculation fields and Right ( $this_name; 2 ) ≠ "_s" //  skip summary fields ]
// Set Variable [ $this_value ; Value: CF_getProperty ( $this_name_value; $this_name ) ]
Set Variable [ $this_value ; Value: CF_stripPSlashes ( CF_getProperty ( $this_name_value; $this_name )) ]
If [ Evaluate ( $target_table_name & "::" & $this_name ) ≠ $this_value ]
Set Field By Name [ $target_table_name & "::" & $this_name ; $this_value ]
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & $this_name & ¶ ) ]
End If
End If
End If
End If
#
#  end of field loop
End Loop
#
#  Add the current TCL ID to a list of TCL IDs
Set Variable [ $tcl_ids ; Value: $tcl_ids & Evaluate ( $target_table_name & "::" & $primary_key_name ) & ¶ ]
#
#  Prepare for a/another trip through the loop
Set Variable [ $tclx_array ; Value: GLO_TCL__TimeCardLine::column_multipliers ]
Set Variable [ $target_field ; Value: "" ]
#
# @history 02/25/2026, chris.corsi@proofgeist.com - Moved isMP1/isMP2 check above isHoliday and isDayOfWeek.
#   create-unworked-entry copies the source clock record verbatim, so an MP entry on a holiday inherits
#   isHoliday=True. The previous cascade hit isHoliday first, routing the MP hour to hrsColumn1 (OT/Holiday)
#   instead of hrsColumn4 (MP). Fix: check isMP1/isMP2 before isHoliday and isDayOfWeek.
#  Identify the appropriate Hours column.
If [ GLO_TCL__TimeCardLine::isUnpaidMeal ]
#  This space intentionally left blank.
Else If [ GLO_TCL__TimeCardLine::isDriveTime ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn5 ) ]
Else If [ GLO_TCL__TimeCardLine::isOTDailyL2 or ( GLO_TCL__TimeCardLine::isHoliday and ( GLO_TCL__TimeCardLine::isOTDailyL1 or GLO_TCL__TimeCardLine::isOTWeekly or GLO_TCL__TimeCardLine::isConsecutiveDay6th or GLO_TCL__TimeCardLine::isConsecutiveDay7th or GLO_TCL__TimeCardLine::isConsecutiveDay8th ) ) or ( GLO_TCL__TimeCardLine::isOTDailyL1 and GLO_TCL__TimeCardLine::isConsecutiveDay7th ) ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn2 ) ]
Else If [ ( GLO_TCL__TimeCardLine::isOTDailyL1 or GLO_TCL__TimeCardLine::isOTWeekly or GLO_TCL__TimeCardLine::isConsecutiveDay6th or GLO_TCL__TimeCardLine::isConsecutiveDay7th or GLO_TCL__TimeCardLine::isConsecutiveDay8th ) and not GLO_TCL__TimeCardLine::ignoreOvertime ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn1 ) ]
Else If [ ( GLO_TCL__TimeCardLine::isMP1 or GLO_TCL__TimeCardLine::isMP2 ) and not GLO_TCL__TimeCardLine::ignoreMealPenatly ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn4 ) ]
Else If [ GLO_TCL__TimeCardLine::isHoliday and not GLO_TCL__TimeCardLine::ignoreHoliday ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn1 ) ]
Else If [ GLO_TCL__TimeCardLine::isNightRate and not GLO_TCL__TimeCardLine::ignoreNightRate ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn3 ) ]
Else If [ GLO_TCL__TimeCardLine::isDayOfWeek ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn1 ) ]
Else
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn0 ) ]
End If
#
#  Set or Clear all the "column" fields
Set Variable [ $m ; Value: 0 ]
Loop [ Flush: Always ]
Exit Loop If [ Let ( $m = $m + 1; $m > ValueCount ( $column_fields )) ]
Set Variable [ $value ; Value: Let ( x = GLO_TCL__TimeCardLine::timeDuration_c / 3600; If ( x = 0; ""; x ) ) ]
Set Variable [ $next_field ; Value: GetValue ( $column_fields; $m ) ]
Set Variable [ $next_value ; Value: If ( $next_field = $target_field; $value; "" ) ]
If [ Evaluate ( $next_field ) ≠ $next_value ]
Set Field By Name [ $next_field ; $next_value ]
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & Substitute ( $next_field; $target_table_name & "::"; "" ) & ¶ ) ]
End If
End Loop
#
#  Update the field of calculated values - used for the modified flag.
Set Variable [ $modified ; Value: If ( IsEmpty ( GLO_TCL__TimeCardLine::hrsColumn0 ); 0; GLO_TCL__TimeCardLine::hrsColumn0 ) & If ( IsEmpty ( GLO_TCL__TimeCardLine::hrsColumn1 ); 0; GLO_TCL__TimeCardLine::hrsColumn1 ) & If ( IsEmpty ( GLO_TCL__TimeCardLine::hrsColumn2 ); 0; GLO_TCL__Time… ]
If [ GLO_TCL__TimeCardLine::isModified_calc ≠ $modified ]
Set Field [ GLO_TCL__TimeCardLine::isModified_calc ; $modified ]
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & GFN ( GLO_TCL__TimeCardLine::isModified_calc ) & ¶ ) ]
End If
#
#  Record the record-level timer results
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $startRecordTimer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; "-------------------------------------¶" & elapsed & Tab & "Record total¶¶¶" ) ]
#
#  end of "record" loop
End Loop
#
#  Exit script if $error
Exit Loop If [ $error ]
#
#  Collect any unused reusable_ids for proper recycling/disposal
Set Variable [ $unused_ids ; Value: Substitute ( List ( $unused_ids; $reusable_ids ); "¶¶"; ¶ ) ]
#
#  end of mode loop
End Loop
#
#  Exit script if $error
Exit Loop If [ $error ]
#
#  If the rules created any Minimum Call/Unworked recrods, we need to create these too.
If [ $$unwork_count > 0 ]
#
Insert Calculated Result [ Target: $process_log ; Let ( $process_timer = Get ( CurrentTimeUTCMilliseconds ); "¶---------- Start Unworked Loop ----------¶" ) ]
#
#  Loop through each "record" - whick is still a repeating variable
Set Variable [ $j ; Value: 0 ]
Loop [ Flush: Always ]
Set Variable [ $j ; Value: $j + 1 ]
Set Variable [ $startRecordTimer ; Value: Get ( CurrentTimeUTCMilliseconds ) ]
Set Variable [ $this_source_variable ; Value: "$$unwork[" & $j & "]" ]
Set Variable [ $this_record ; Value: Evaluate ( $this_source_variable ) ]
Set Variable [ $field_count ; Value: ValueCount ( $this_record ) ]
Exit Loop If [ IsEmpty ( $this_record ) ]
#
#  Clear any pre-existing relationship so that we can create records as necessary.
Set Field [ GLO__Global::_new_id_g ; "" ]
#  Attempt to set the Primary key field first, so we don't inadvertantly create records needlessly.
Set Field [ GLO__Global::_new_id_g ; Pop ( "$unused_ids" ) ]
#
#  Set the Time Card id, which will facilitate setting several fields via auto-enter calcs.
Set Variable [ $this_timecard_id ; Value: CF_getProperty ( $this_record ; $timecard_key_name ) ]
If [ Evaluate ( $target_table_name & "::" & $timecard_key_name ) ≠ $this_timecard_id ]
Set Field By Name [ $target_table_name & "::" & GFN ( TCL__TimeCardLine::_timecard_id ) ; CF_getProperty ( $this_record ; $timecard_key_name ) ]
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & GFN ( TCL__TimeCardLine::_timecard_id ) & ¶ ) ]
End If
#
#  Set the column_multipliers field needed soon for proper field assignments
If [ Evaluate ( $target_table_name & "::" & GFN ( TCL__TimeCardLine::column_multipliers )) ≠ $tclx_array ]
Set Field By Name [ $target_table_name & "::" & GFN ( TCL__TimeCardLine::column_multipliers ) ; $tclx_array ]
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & GFN ( TCL__TimeCardLine::column_multipliers ) & ¶ ) ]
End If
#
Set Variable [ $k ; Value: 0 ]
Loop [ Flush: Always ]
Exit Loop If [ Let ( $k = $k + 1; $k > $field_count ) ]
Set Variable [ $this_name_value ; Value: GetValue ( $this_record; $k ) ]
If [ not IsEmpty ( $this_name_value ) ]
Set Variable [ $this_name ; Value: CF_getPropertyListKeys ( $this_name_value ) ]
If [ ValueCount ( FilterValues ( $this_name; List ( "_contact_id"; "_timecard_id"; "_vendor_id"; "date"; ) )) = 0 ]
If [ Right ( $this_name; 2 ) ≠ "_c" //  skip calculation fields and Right ( $this_name; 2 ) ≠ "_s" //  skip summary fields ]
// Set Variable [ $this_value ; Value: CF_getProperty ( $this_name_value; $this_name ) ]
Set Variable [ $this_value ; Value: CF_stripPSlashes ( CF_getProperty ( $this_name_value; $this_name )) ]
If [ Evaluate ( $target_table_name & "::" & $this_name ) ≠ $this_value ]
Set Field By Name [ $target_table_name & "::" & $this_name ; $this_value ]
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & $this_name & ¶ ) ]
End If
End If
End If
End If
#
#  end of field loop
End Loop
#
#  We need to add this ID to our list of TCL IDs too.
Set Variable [ $tcl_ids ; Value: $tcl_ids & Evaluate ( $target_table_name & "::" & $primary_key_name ) & ¶ ]
#
#  Prepare for a/another trip through the loop
Set Variable [ $target_field ; Value: "" ]
#
# @history 02/25/2026, chris.corsi@proofgeist.com - Moved isMP1/isMP2 check above isHoliday and isDayOfWeek.
#   Mirrors the same fix applied to the bill section above. The unwork cascade had the identical priority
#   bug: isHoliday was checked before isMP1/isMP2, causing inherited-holiday MP entries to land in
#   hrsColumn1 (OT/Holiday) instead of hrsColumn4 (MP).
#  Identify the appropriate Hours column.
If [ GLO_TCL__TimeCardLine::isUnpaidMeal ]
#  This space intentionally left blank.
Else If [ GLO_TCL__TimeCardLine::isDriveTime ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn5 ) ]
Else If [ GLO_TCL__TimeCardLine::isOTDailyL2 or Sum ( GLO_TCL__TimeCardLine::isOTDailyL1; GLO_TCL__TimeCardLine::isOTWeekly; GLO_TCL__TimeCardLine::isHoliday; GLO_TCL__TimeCardLine::isConsecutiveDay6th; GLO_TCL__TimeCardLine::isConsecutiveDay7th; GLO_TCL__TimeCardLine::isConsecutiveDay8th; ) > 1 ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn2 ) ]
Else If [ ( GLO_TCL__TimeCardLine::isOTDailyL1 or GLO_TCL__TimeCardLine::isOTWeekly ) and not GLO_TCL__TimeCardLine::ignoreOvertime ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn1 ) ]
Else If [ ( GLO_TCL__TimeCardLine::isMP1 or GLO_TCL__TimeCardLine::isMP2 ) and not GLO_TCL__TimeCardLine::ignoreMealPenatly ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn4 ) ]
Else If [ GLO_TCL__TimeCardLine::isHoliday and not GLO_TCL__TimeCardLine::ignoreHoliday ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn1 ) ]
Else If [ GLO_TCL__TimeCardLine::isNightRate and not GLO_TCL__TimeCardLine::ignoreNightRate ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn3 ) ]
Else If [ GLO_TCL__TimeCardLine::isDayOfWeek ]
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn1 ) ]
Else
Set Variable [ $target_field ; Value: GetFieldName ( GLO_TCL__TimeCardLine::hrsColumn0 ) ]
End If
#
#  Set or Clear all the "column" fields
Set Variable [ $m ; Value: 0 ]
Loop [ Flush: Always ]
Exit Loop If [ Let ( $m = $m + 1; $m > ValueCount ( $column_fields )) ]
Set Variable [ $value ; Value: Let ( x = GLO_TCL__TimeCardLine::timeDuration_c / 3600; If ( x = 0; ""; x ) ) ]
Set Variable [ $next_field ; Value: GetValue ( $column_fields; $m ) ]
Set Variable [ $next_value ; Value: If ( $next_field = $target_field; $value; "" ) ]
If [ Evaluate ( $next_field ) ≠ $next_value ]
Set Field By Name [ $next_field ; $next_value ]
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & Substitute ( $next_field; $target_table_name & "::"; "" ) & ¶ ) ]
End If
End Loop
#
#  Update the field of calculated values - used for the modified flag.
Set Variable [ $modified ; Value: If ( IsEmpty ( GLO_TCL__TimeCardLine::hrsColumn0 ); 0; GLO_TCL__TimeCardLine::hrsColumn0 ) & If ( IsEmpty ( GLO_TCL__TimeCardLine::hrsColumn1 ); 0; GLO_TCL__TimeCardLine::hrsColumn1 ) & If ( IsEmpty ( GLO_TCL__TimeCardLine::hrsColumn2 ); 0; GLO_TCL__Time… ]
If [ GLO_TCL__TimeCardLine::isModified_calc ≠ $modified ]
Set Field [ GLO_TCL__TimeCardLine::isModified_calc ; $modified ]
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & GFN ( GLO_TCL__TimeCardLine::isModified_calc ) & ¶ ) ]
End If
#
#  Record the record-level timer results
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $startRecordTimer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; "-------------------------------------¶" & elapsed & Tab & "Record total¶¶¶" ) ]
#
#  end of "record" loop
End Loop
End If
#
#  Commit, if we must
If [ Get ( RecordOpenCount ) ]
Commit Records/Requests [ With dialog: Off ]
If [ Get ( LastError ) ]
Set Variable [ $error ; Value: Get ( LastError ) ]
Set Variable [ $message ; Value: "Could not commit records.  Please wait a short while & try again." ]
Revert Record/Request [ With dialog: Off ]
End If
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; elapsed & Tab & "Commit record(s)" ) ]
End If
#
#  If we have any extra TCL records, we must delete them.
If [ ValueCount ( $unused_ids ) > 0 ]
Perform Script [ "Delete Record PSOS" ; Specified: From list ; Parameter: List ( "id=" & CF_addPSlashes ( $unused_ids ); "TO=" & GetFieldName ( TCL__TimeCardLine::__id ) ) ]
Set Variable [ $scriptResult ; Value: Let ( ~error = Get ( LastError ); If ( ~error; List ( "error=" & ~error; "message=Error: " & ~error & " - Perform Script error" ); Get ( ScriptResult ) ) ) ]
Set Variable [ $error ; Value: GetAsNumber ( CF_getProperty ( $scriptResult; "error" )) ]
Set Variable [ $message ; Value: CF_getProperty ( $scriptResult; "message" ) ]
Insert Calculated Result [ Target: $process_log ; Let ([ elapsed = ( Get ( CurrentTimeUTCMilliseconds ) - $process_timer ) / 1000; $process_timer = Get ( CurrentTimeUTCMilliseconds ) ]; ¶ & elapsed & Tab & "Delete " & ValueCount ( $unused_ids ) & " record" & If ( ValueCount ( $unused_ids ) > 1; "s" ) ) ]
End If
#
Exit Loop If [ True //  Always exit the single-iteration control loop to prevent infinite spin!  ]
End Loop
#
#  Cleanup steps: gather script results, etc...
Set Variable [ $result ; Value: List ( "error=" & If ( IsEmpty ( $error ); 0; $error ); "message=" & CF_addPSlashes ( $message ); "tcl_ids=" & CF_addPSlashes ( $tcl_ids ); "scriptName=" & Get ( ScriptName ); ) ]
#
#  Record a log entry
Perform Script [ "Create Log Entry" ; Specified: From list ; Parameter: List ( "action=" & "Performance Monitor"; "file_name=" & Get ( FileName ); "script_name=" & Get ( ScriptName ); "run_time=" & ( Get ( CurrentTimeUTCMilliseconds ) - $startTime ) / 1000; "error=" & If ( IsEmpty ( $error ); 0; $error ); "parameters=" & CF_addPSlashes ( Get ( ScriptParameter )); "results=" & CF_addPSlashes ( $result ); "notes=" & CF_addPSlashes ( CF_Trim4 ( $process_log )); ) ]
#
#  That's it - exit script!
Exit Script [ Text Result: $result //  We always return the result variable  ]
#
```
