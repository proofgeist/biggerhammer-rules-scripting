import {
  dateField,
  fmTableOccurrence,
  numberField,
  textField,
} from "@proofkit/fmodata";

export const TCD__TimeCard = fmTableOccurrence(
  "TCD__TimeCard",
  {
    __id: textField().entityId("FMFID:4296032412"),
    _contact_id: textField().entityId("FMFID:30065836188"),
    date: dateField().entityId("FMFID:34360803484"),
    _call_id: textField().entityId("FMFID:42950738076"),
    _contract_id: textField().entityId("FMFID:51540672668"),
    _event_id: textField().entityId("FMFID:55835639964"),
    _vendor_id: textField().entityId("FMFID:64425574556"),
    _employeeRating_id: textField().entityId("FMFID:81605443740"),
    _defaultJobTitle_id: textField().entityId("FMFID:111670214812"),
    _template_id: textField().entityId("FMFID:124555116700"),
    defaultJobTitles: textField().entityId("FMFID:128850083996"),
    additionalEarningsDescription: textField().entityId("FMFID:163209822364"),
    additionalEarningsAmount: numberField().entityId("FMFID:167504789660"),
    _timecardline_id: textField()
      .entityId("FMFID:236224266396")
      .comment(
        "Additional Earnings require the creation of a payable Time Card Line.  This is the foreign ID of that record.",
      ),
    defaultDepartment: textField().entityId("FMFID:261994070172"),
    _defaultDepartment_id: textField().entityId("FMFID:270584004764"),
    status: numberField()
      .entityId("FMFID:313533677724")
      .comment("Used to prevent editing."),
    additionalEarningsCodePay: textField().entityId("FMFID:382253154460"),
    additionalEarningsCodeBill: textField().entityId("FMFID:386548121756"),
  },
  {
    entityId: "FMTID:1065116",
    navigationPaths: [],
  },
);
