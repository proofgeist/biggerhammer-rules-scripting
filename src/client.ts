import { FMServerConnection } from "@proofkit/fmodata";
import { config } from "dotenv";

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
	CJT__ContractJobTitle,
	CON__Contact,
	CTR__Contract,
	EVE__Event,
	TCD__TimeCard,
	TCL__TimeCardLine,
} from "../schema/index.js";
