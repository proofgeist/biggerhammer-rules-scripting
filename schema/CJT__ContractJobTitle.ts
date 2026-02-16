import { fmTableOccurrence, textField } from "@proofkit/fmodata";

export const CJT__ContractJobTitle = fmTableOccurrence(
  "CJT__ContractJobTitle",
  {
    __id: textField().entityId("FMFID:4296032404"),
    Name: textField().entityId("FMFID:30065836180"),
    _jobtitle_id: textField().entityId("FMFID:51540672660"),
    _contract_id: textField().entityId("FMFID:55835639956"),
  },
  {
    entityId: "FMTID:1065108",
    navigationPaths: [],
  },
);
