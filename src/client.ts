import { config } from "dotenv";
import { FMServerConnection } from "@proofkit/fmodata";

config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const connection = new FMServerConnection({
  serverUrl: requireEnv("FM_SERVER"),
  auth: { apiKey: requireEnv("OTTO_API_KEY") },
});

export const db = connection.database(requireEnv("FM_DATABASE"));

export {
  TCL__TimeCardLine,
  TCD__TimeCard,
  EVE__Event,
  CON__Contact,
  CTR__Contract,
  CJT__ContractJobTitle,
} from "../schema/index.js";
