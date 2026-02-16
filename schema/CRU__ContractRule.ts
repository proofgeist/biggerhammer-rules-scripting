import { fmTableOccurrence, textField, numberField } from "@proofkit/fmodata";

export const CRU__ContractRule = fmTableOccurrence(
  "CRU__ContractRule",
  {
    __id: textField().entityId("FMFID:4296032490"),
    _rule_id: textField().entityId("FMFID:30065836266"),
    sequence: numberField().entityId("FMFID:47245705450"),
    _contract_id: textField().entityId("FMFID:51540672746"),
    description: textField().entityId("FMFID:55835640042"),
    hour1: numberField().entityId("FMFID:60130607338"),
    multiplier1: numberField().entityId("FMFID:64425574634"),
    time1: textField().entityId("FMFID:68720541930"),
    day: textField().entityId("FMFID:73015509226"),
    minutes: numberField().entityId("FMFID:77310476522"),
    time2: textField().entityId("FMFID:85900411114"),
    hour2: numberField().entityId("FMFID:90195378410"),
    ordinal: textField().entityId("FMFID:94490345706"),
    operation: textField().entityId("FMFID:98785313002"),
    enabled: numberField()
      .entityId("FMFID:107375247594")
      .comment("Default value 1 (True)"),
    bill1: numberField().entityId("FMFID:111670214890"),
    bill2: numberField().entityId("FMFID:115965182186"),
    bill3: numberField().entityId("FMFID:120260149482"),
    pay1: numberField().entityId("FMFID:124555116778"),
    pay2: numberField().entityId("FMFID:128850084074"),
    pay3: numberField().entityId("FMFID:133145051370"),
    multiplier2: numberField().entityId("FMFID:137440018666"),
    scope: textField().entityId("FMFID:141734985962"),
    json_c: textField().readOnly().entityId("FMFID:146029953258"),
    label: textField().entityId("FMFID:150324920554"),
    field: textField().entityId("FMFID:154619887850"),
  },
  {
    entityId: "FMTID:1065194",
    navigationPaths: [],
  },
);
