import { fmTableOccurrence, textField } from "@proofkit/fmodata";

export const EVE__Event = fmTableOccurrence(
  "EVE__Event",
  {
    __id: textField().entityId("FMFID:4296032396"),
    _company_id: textField()
      .entityId("FMFID:51540672652")
      .comment("formerly: Client"),
    _contract_id: textField()
      .entityId("FMFID:416612892812")
      .comment("Default Contract ID"),
    code: textField()
      .entityId("FMFID:532577009804")
      .comment("For G/L Code Evaluate Calc"),
    _client_id: textField().entityId("FMFID:558346813580"),
  },
  {
    entityId: "FMTID:1065100",
    navigationPaths: [],
  },
);
