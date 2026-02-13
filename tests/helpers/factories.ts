import { eq } from "@proofkit/fmodata";
import {
	CJT__ContractJobTitle,
	db,
	TCD__TimeCard,
	TCL__TimeCardLine,
} from "../../src/client.js";

/** Get required env var or throw. Use in tests that need env. */
export function requireEnv(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`Missing required env var: ${name}`);
	return v;
}

/** Get __id from a record or throw. Use when record is expected to have id. */
export function assertId<T extends { __id?: string }>(obj: T): string {
	const id = obj.__id;
	if (!id) throw new Error("Expected record to have __id");
	return id;
}

// Cache CJT lookups by contract ID to avoid repeated queries
const cjtCache = new Map<string, string>();

/**
 * Match a contract ID to its env-configured CJT ID.
 */
function getCjtFromEnv(contractId: string): string | undefined {
	if (contractId === process.env.TEST_CONTRACT_ID_WORKED) {
		return process.env.TEST_CONTRACT_JOB_TITLE_ID_WORKED;
	}
	if (contractId === process.env.TEST_CONTRACT_ID_UNWORKED) {
		return process.env.TEST_CONTRACT_JOB_TITLE_ID_UNWORKED;
	}
	return undefined;
}

/**
 * Look up the first Contract Job Title for a given contract.
 * Caches results so we only query once per contract.
 */
async function getContractJobTitleId(contractId: string): Promise<string> {
	const cached = cjtCache.get(contractId);
	if (cached) return cached;

	const result = await db
		.from(CJT__ContractJobTitle)
		.list()
		.where(eq(CJT__ContractJobTitle._contract_id, contractId))
		.execute();

	if (result.error) {
		throw new Error(
			`Failed to look up CJT for contract ${contractId}: ${result.error}`,
		);
	}

	if (result.data.length === 0) {
		throw new Error(
			`No Contract Job Titles found for contract ${contractId}. ` +
				`The rules engine requires a valid _contractJobTitle_id on Clock TCLs.`,
		);
	}

	const cjtId = result.data[0].__id;
	if (!cjtId)
		throw new Error(`CJT record has no __id for contract ${contractId}`);
	cjtCache.set(contractId, cjtId);
	return cjtId;
}

/**
 * Create a Time Card record for testing.
 * Returns the created record including its __id.
 */
export async function createTimeCard(params: {
	contactId: string;
	eventId: string;
	contractId: string;
	date: string;
	callId?: string;
	vendorId?: string;
	employeeRatingId?: string;
}) {
	const result = await db
		.from(TCD__TimeCard)
		.insert({
			_contact_id: params.contactId,
			_event_id: params.eventId,
			_contract_id: params.contractId,
			date: params.date,
			_call_id: params.callId ?? "",
			_vendor_id: params.vendorId ?? "",
			_employeeRating_id: params.employeeRatingId ?? "",
		})
		.execute();

	if (result.error)
		throw new Error(`Failed to create TimeCard: ${result.error}`);
	return result.data;
}

/**
 * Create a Clock-type TCL record for testing.
 * time_in and time_out should be "HH:MM:SS" format.
 * contractId is required to auto-lookup a Contract Job Title.
 */
export async function createClockTCL(params: {
	timecardId: string;
	contactId: string;
	eventId: string;
	contractId: string;
	date: string;
	timeIn: string;
	timeOut: string;
	contractJobTitleId?: string;
	companyId?: string;
	vendorId?: string;
}) {
	// Resolve CJT: explicit param > contract-specific env var > OData lookup
	const cjtId =
		params.contractJobTitleId ??
		getCjtFromEnv(params.contractId) ??
		(await getContractJobTitleId(params.contractId));

	const result = await db
		.from(TCL__TimeCardLine)
		.insert({
			_timecard_id: params.timecardId,
			_contact_id: params.contactId,
			_event_id: params.eventId,
			date: params.date,
			time_in: params.timeIn,
			time_out: params.timeOut,
			_contractJobTitle_id: cjtId,
			_company_id: params.companyId ?? "",
			_vendor_id: params.vendorId ?? "",
			isBill: 0,
			isPay: 0,
			isMinimumCall: 0,
			isUnpaidMeal: 0,
			isPaidMeal: 0,
			isFlat: 0,
			isAfterMidnight: 0,
		})
		.execute();

	if (result.error)
		throw new Error(`Failed to create Clock TCL: ${result.error}`);
	return result.data;
}

/**
 * Call the FM testing script to apply contract rules to a Time Card.
 * Returns the parsed script result.
 */
export async function applyRules(
	timecardId: string,
	mode: string = "bill\npay",
) {
	const result = await db.runScript("Test - Apply Contract Rules", {
		scriptParam: JSON.stringify({ timecard_id: timecardId, mode }),
	});

	if (result.resultCode !== 0) {
		throw new Error(`Script returned error code: ${result.resultCode}`);
	}

	// Parse the JSON result from the FM script
	let parsed: { error: number; message: string; success_ids: string };
	try {
		parsed = JSON.parse(result.result ?? "{}");
	} catch {
		console.error("Failed to parse script result as JSON:", result.result);
		throw new Error(`Script returned unparseable result: ${result.result}`);
	}

	console.log("applyRules result:", parsed);

	return parsed;
}

/**
 * Fetch all TCL records for a given Time Card, grouped by type.
 * All TCL types (Clock, Bill, Pay, Unworked) share _timecard_id.
 */
export async function getResultTCLs(timecardId: string) {
	const result = await db
		.from(TCL__TimeCardLine)
		.list()
		.where(eq(TCL__TimeCardLine._timecard_id, timecardId))
		.execute();

	if (result.error) throw new Error(`Failed to fetch TCLs: ${result.error}`);

	const records = result.data;

	console.log(
		`getResultTCLs: ${records.length} total records for TCD ${timecardId}`,
	);
	for (const r of records) {
		console.log(
			`  TCL ${r.__id}: isBill=${r.isBill} isPay=${r.isPay} isMinimumCall=${r.isMinimumCall} hrsUnworked=${r.hrsUnworked} time_in=${r.time_in} time_out=${r.time_out} _timecardline_id=${r._timecardline_id}`,
		);
	}

	const clock: typeof records = [];
	const billable: typeof records = [];
	const payable: typeof records = [];
	const unworked: typeof records = [];

	for (const r of records) {
		if (r.isBill && r.hrsUnworked) {
			unworked.push(r);
		} else if (r.isPay && r.hrsUnworked) {
			unworked.push(r);
		} else if (r.isBill) {
			billable.push(r);
		} else if (r.isPay) {
			payable.push(r);
		} else {
			clock.push(r);
		}
	}

	console.log(
		`  Classified: clock=${clock.length} billable=${billable.length} payable=${payable.length} unworked=${unworked.length}`,
	);

	return { clock, billable, payable, unworked, all: records };
}
