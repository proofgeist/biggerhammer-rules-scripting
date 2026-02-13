import { config } from "dotenv";

config();

const required = [
  "FM_SERVER",
  "FM_DATABASE",
  "OTTO_API_KEY",
  "TEST_CONTRACT_ID_WORKED",
  "TEST_CONTACT_ID",
  "TEST_EVENT_ID",
];

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(
      `Missing required env var: ${name}. Copy .env.example to .env and fill in the values.`
    );
  }
}
