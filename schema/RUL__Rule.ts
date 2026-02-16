import { fmTableOccurrence, textField } from "@proofkit/fmodata";

export const RUL__Rule = fmTableOccurrence(
  "RUL__Rule",
  {
    __id: textField().entityId("FMFID:4296032491"),
    description: textField().entityId("FMFID:8590999787"),
    name: textField().entityId("FMFID:38655770859"),
    client: textField().entityId("FMFID:51540672747"),
  },
  {
    entityId: "FMTID:1065195",
    navigationPaths: [],
  },
);
