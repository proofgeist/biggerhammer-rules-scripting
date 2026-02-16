import { fmTableOccurrence, textField } from "@proofkit/fmodata";

export const CON__Contact = fmTableOccurrence(
  "CON__Contact",
  {
    __id: textField().entityId("FMFID:4296032389"),
    Name_First: textField().entityId("FMFID:30065836165"),
    Name_Last: textField().entityId("FMFID:34360803461"),
    Name_Middle: textField().entityId("FMFID:38655770757"),
  },
  {
    entityId: "FMTID:1065093",
    navigationPaths: [],
  },
);
