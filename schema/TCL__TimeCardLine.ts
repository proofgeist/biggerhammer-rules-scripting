import {
  dateField,
  fmTableOccurrence,
  numberField,
  textField,
  timestampField,
} from "@proofkit/fmodata";

export const TCL__TimeCardLine = fmTableOccurrence(
  "TCL__TimeCardLine",
  {
    __id: textField().entityId("FMFID:4296032421"),
    _contact_id: textField().entityId("FMFID:8590999717"),
    date: dateField().entityId("FMFID:81605443749"),
    _timecard_id: textField().entityId("FMFID:94490345637"),
    time_in: textField().entityId("FMFID:103080280229"),
    time_out: textField().entityId("FMFID:111670214821"),
    isAfterMidnight: numberField().entityId("FMFID:120260149413"),
    timeDuration_c: textField().readOnly().entityId("FMFID:124555116709"),
    time_in_ts_c: timestampField().readOnly().entityId("FMFID:128850084005"),
    time_out_ts_c: timestampField().readOnly().entityId("FMFID:133145051301"),
    hrsUnworked: textField().entityId("FMFID:146029953189"),
    hrsWorked_c: textField().readOnly().entityId("FMFID:150324920485"),
    isMinimumCall: numberField().entityId("FMFID:171799756965"),
    _contractJobTitle_id: textField().entityId("FMFID:176094724261"),
    _employeeRating_id: textField().entityId("FMFID:193274593445"),
    _contractRate_id: textField().entityId("FMFID:197569560741"),
    dollarsPayRateBase: numberField().entityId("FMFID:206159495333"),
    dollarsBillRateBase: numberField().entityId("FMFID:219044397221"),
    isMisc1: numberField()
      .entityId("FMFID:240519233701")
      .comment("Miscellaneous 1"),
    isMP1: numberField().entityId("FMFID:253404135589"),
    isMP2: numberField().entityId("FMFID:257699102885"),
    isNightRate: numberField().entityId("FMFID:261994070181"),
    isPaidMeal: numberField().entityId("FMFID:266289037477"),
    isRecording: numberField().entityId("FMFID:270584004773"),
    isUnpaidMeal: numberField().entityId("FMFID:274878972069"),
    isOTDailyL1: numberField().entityId("FMFID:279173939365"),
    isOTWeekly: numberField().entityId("FMFID:287763873957"),
    isOTDailyL2: numberField().entityId("FMFID:292058841253"),
    ignoreGracePeriod: numberField().entityId("FMFID:296353808549"),
    ignoreHoliday: numberField().entityId("FMFID:300648775845"),
    ignoreMealPenatly: numberField().entityId("FMFID:304943743141"),
    ignoreOvertime: numberField().entityId("FMFID:309238710437"),
    noteGracePeriod: textField().entityId("FMFID:322123612325"),
    ignoreNightRate: numberField().entityId("FMFID:326418579621"),
    _timecardline_id: textField()
      .entityId("FMFID:330713546917")
      .comment(
        "Used to link the Billable & Payable records back to their parent TCL record.",
      ),
    dollarsTotal_c: numberField().readOnly().entityId("FMFID:343598448805"),
    isPay: numberField()
      .entityId("FMFID:347893416101")
      .comment("True if this record represents Payable values."),
    isBill: numberField()
      .entityId("FMFID:352188383397")
      .comment("True if this record represents Billable values."),
    noteRule: textField().entityId("FMFID:365073285285"),
    _vendor_id: textField().entityId("FMFID:369368252581"),
    isConsecutiveDay7th: numberField().entityId("FMFID:386548121765"),
    isConsecutiveDay8th: numberField().entityId("FMFID:390843089061"),
    total_pay_employee_c: numberField()
      .readOnly()
      .entityId("FMFID:416612892837"),
    contact_name_full_c: textField()
      .readOnly()
      .entityId("FMFID:420907860133")
      .comment(
        "local field used in getsummary functions; do not delete (please)",
      ),
    hrsColumn0: numberField()
      .entityId("FMFID:446677663909")
      .comment("a.k.a. hours_ST"),
    hrsColumn1: numberField()
      .entityId("FMFID:450972631205")
      .comment("a.k.a. hours_OT"),
    hrsColumn2: numberField()
      .entityId("FMFID:455267598501")
      .comment("a.k.a. hours_DT"),
    hrsColumn3: numberField()
      .entityId("FMFID:459562565797")
      .comment("a.k.a. hours_NT"),
    hrsColumn4: numberField()
      .entityId("FMFID:463857533093")
      .comment("a.k.a. hours_MP"),
    _company_id: textField()
      .entityId("FMFID:493922304165")
      .comment("Event Company id = Event Client"),
    total_pay_c: numberField().readOnly().entityId("FMFID:515397140645"),
    _event_id: textField().entityId("FMFID:519692107941"),
    isExpense: numberField().entityId("FMFID:528282042533"),
    isOutOfWhack: numberField().entityId("FMFID:536871977125"),
    _department_id: textField().entityId("FMFID:541166944421"),
    department: textField().entityId("FMFID:545461911717"),
    isDayOfWeek: numberField()
      .entityId("FMFID:558346813605")
      .comment("KL 11/16/2018 - Keeping for BH historical data"),
    isFlat: numberField().entityId("FMFID:562641780901"),
    isConsecutiveDay6th: numberField().entityId("FMFID:566936748197"),
    isDriveTime: numberField().entityId("FMFID:575526682789"),
    isTurnaround: numberField().entityId("FMFID:579821650085"),
    hrsColumn5: numberField()
      .entityId("FMFID:588411584677")
      .comment("a.k.a. hours_DR"),
    isDayOfWeekSaturday: numberField().entityId("FMFID:614181388453"),
    isDayOfWeekSunday: numberField().entityId("FMFID:618476355749"),
    dollarsBaseRateModified: numberField().entityId("FMFID:622771323045"),
    column_multipliers: textField()
      .entityId("FMFID:665720996005")
      .comment("JSON array of multipliers"),
    dollarsBaseRateOverride: numberField().entityId("FMFID:678605897893"),
    gl_code_c: textField().readOnly().entityId("FMFID:682900865189"),
    month_year_c: textField().readOnly().entityId("FMFID:687195832485"),
    _contractPTOType_id: textField().entityId("FMFID:712965636261"),
    isEarly: numberField().entityId("FMFID:725850538149"),
    ignoreEarly: numberField().entityId("FMFID:734440472741"),
    ignoreMinimumCall: numberField().entityId("FMFID:738735440037"),
    isContinuity: numberField().entityId("FMFID:747325374629"),
    dollarsVacation_c: numberField().readOnly().entityId("FMFID:755915309221"),
    dollarsTotalAndVacation_c: numberField()
      .readOnly()
      .entityId("FMFID:764505243813"),
    isMisc2: numberField()
      .entityId("FMFID:773095178405")
      .comment("Miscellaneous 2"),
    contractJobTitleName: textField().entityId("FMFID:781685112997"),
  },
  {
    entityId: "FMTID:1065125",
    navigationPaths: [],
  },
);
