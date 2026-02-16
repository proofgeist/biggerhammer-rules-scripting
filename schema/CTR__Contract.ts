import { fmTableOccurrence, numberField, textField } from "@proofkit/fmodata";

export const CTR__Contract = fmTableOccurrence(
  "CTR__Contract",
  {
    __id: textField().entityId("FMFID:4296032403"),
    Name: textField().entityId("FMFID:30065836179"),
    hrs_after_unpaid_meal: numberField().entityId("FMFID:34360803475"),
    hrs_before_unpaid_meal: numberField().entityId("FMFID:38655770771"),
    hrs_minimum_call: numberField().entityId("FMFID:42950738067"),
    mins_grace_period: numberField().entityId("FMFID:47245705363"),
    hrs_meal_break_max: numberField().entityId("FMFID:51540672659"),
    hrs_night_rate_carryover: numberField().entityId("FMFID:55835639955"),
    mult_extra_loud: numberField().entityId("FMFID:64425574547"),
    mult_holiday: numberField().entityId("FMFID:68720541843"),
    mult_meal_penalty1: numberField().entityId("FMFID:73015509139"),
    mult_meal_penalty2: numberField().entityId("FMFID:77310476435"),
    mult_night: numberField().entityId("FMFID:81605443731"),
    mult_overtime_daily_L1: numberField().entityId("FMFID:85900411027"),
    mult_overtime_weekly: numberField().entityId("FMFID:90195378323"),
    mult_recording: numberField().entityId("FMFID:94490345619"),
    hrs_before_meal_penalty1: numberField().entityId("FMFID:98785312915"),
    hrs_before_meal_penalty2: numberField().entityId("FMFID:103080280211"),
    hrs_overtime_daily_L1: numberField().entityId("FMFID:107375247507"),
    hrs_overtime_weekly: numberField().entityId("FMFID:111670214803"),
    time_night_end: textField().entityId("FMFID:124555116691"),
    time_night_start: textField().entityId("FMFID:128850083987"),
    hrs_turnaround_night: numberField().entityId("FMFID:133145051283"),
    mult_overtime_daily_L2: numberField().entityId("FMFID:137440018579"),
    one: numberField().entityId("FMFID:141734985875"),
    start_of_week: textField().entityId("FMFID:146029953171"),
    hrs_overtime_daily_L2: numberField().entityId("FMFID:150324920467"),
    hrs_meal_penalty1: numberField().entityId("FMFID:154619887763"),
    hrs_6th_day: numberField().entityId("FMFID:158914855059"),
    hrs_7th_day: numberField().entityId("FMFID:163209822355"),
    mult_6th_day: numberField().entityId("FMFID:167504789651"),
    mult_7th_day: numberField().entityId("FMFID:171799756947"),
    mins_work_unit: numberField()
      .entityId("FMFID:176094724243")
      .comment(
        "Billable & Payable time's smallest common denominator.  i.e. 30-minutes",
      ),
    hrs_meal_penalty2: numberField().entityId("FMFID:180389691539"),
    hrs_meal_break_min: numberField().entityId("FMFID:184684658835"),
    expense_description: textField()
      .entityId("FMFID:188979626131")
      .comment("KL 1/18/18 Additional Earnings or Expense"),
    expense_amount: numberField()
      .entityId("FMFID:193274593427")
      .comment("KL 1/18/18 Additional Earnings or Expense"),
    mult_minimum_call: numberField().entityId("FMFID:201864528019"),
    minimums_are_worked_time: numberField().entityId("FMFID:206159495315"),
    minimums_included_in_OT: numberField().entityId("FMFID:210454462611"),
    minimums_included_in_NT: numberField().entityId("FMFID:214749429907"),
    display_modifiers_calc: textField().entityId("FMFID:253404135571"),
    require_CJT: numberField().entityId("FMFID:261994070163"),
    code: textField()
      .entityId("FMFID:270584004755")
      .comment(
        "KL 6.12.19 CTG Earnings Code includes a component for the Contract's Union",
      ),
    type: numberField()
      .entityId("FMFID:274878972051")
      .comment(
        "Type 1 = old-school Bigger Hammer, Type 2 = Contract Rule-based",
      ),
    dollars_total_calc: textField().entityId("FMFID:279173939347"),
    venue: textField().entityId("FMFID:287763873939"),
    isDefault: numberField().entityId("FMFID:300648775827"),
  },
  {
    entityId: "FMTID:1065107",
    navigationPaths: [],
  },
);
