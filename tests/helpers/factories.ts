import { eq } from "@proofkit/fmodata";
import {
	CJT__ContractJobTitle,
	CRU__ContractRule,
	CTR__Contract,
	db,
	RUL__Rule,
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
export function assertId<T extends { __id?: string | null }>(obj: T): string {
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
	ignoreOvertime?: boolean;
	ignoreNightRate?: boolean;
	ignoreMealPenatly?: boolean;
	ignoreGracePeriod?: boolean;
	ignoreHoliday?: boolean;
	ignoreMinimumCall?: boolean;
	ignoreEarly?: boolean;
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
			ignoreOvertime: params.ignoreOvertime ? 1 : 0,
			ignoreNightRate: params.ignoreNightRate ? 1 : 0,
			ignoreMealPenatly: params.ignoreMealPenatly ? 1 : 0,
			ignoreGracePeriod: params.ignoreGracePeriod ? 1 : 0,
			ignoreHoliday: params.ignoreHoliday ? 1 : 0,
			ignoreMinimumCall: params.ignoreMinimumCall ? 1 : 0,
			ignoreEarly: params.ignoreEarly ? 1 : 0,
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

/**
 * Fetch a contract record by ID. Returns the full contract data
 * so tests can read rule configuration values at runtime.
 */
export async function getContract(contractId: string) {
	const result = await db
		.from(CTR__Contract)
		.list()
		.where(eq(CTR__Contract.__id, contractId))
		.execute();

	if (result.error)
		throw new Error(`Failed to read contract: ${result.error}`);
	if (result.data.length === 0)
		throw new Error(`No contract found with ID: ${contractId}`);

	return result.data[0];
}

/**
 * Create a Meal-type TCL record for testing (paid or unpaid).
 * time_in and time_out should be "HH:MM:SS" format.
 */
export async function createMealTCL(params: {
	timecardId: string;
	contactId: string;
	eventId: string;
	contractId: string;
	date: string;
	timeIn: string;
	timeOut: string;
	isPaidMeal?: boolean;
	isUnpaidMeal?: boolean;
	contractJobTitleId?: string;
	companyId?: string;
	vendorId?: string;
}) {
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
			isUnpaidMeal: params.isUnpaidMeal ? 1 : 0,
			isPaidMeal: params.isPaidMeal ? 1 : 0,
			isFlat: 0,
			isAfterMidnight: 0,
		})
		.execute();

	if (result.error)
		throw new Error(`Failed to create Meal TCL: ${result.error}`);
	return result.data;
}

/** Convert "HH:MM:SS" to decimal hours. */
export function parseTimeToHours(time: string): number {
	const parts = time.split(":");
	return (
		parseInt(parts[0], 10) +
		parseInt(parts[1], 10) / 60 +
		parseInt(parts[2] ?? "0", 10) / 3600
	);
}

// ---------------------------------------------------------------------------
// Contract Rule (CRU) helpers
// ---------------------------------------------------------------------------

/**
 * Find a master Rule record by name. These are shared records (not test-created).
 * Throws if the rule is not found.
 */
export async function findRule(name: string) {
	const result = await db
		.from(RUL__Rule)
		.list()
		.where(eq(RUL__Rule.name, name))
		.execute();

	if (result.error)
		throw new Error(`Failed to query RUL__Rule: ${result.error}`);
	if (result.data.length === 0)
		throw new Error(
			`Rule "${name}" not found in RUL__Rule. Available rules may differ.`,
		);

	return result.data[0];
}

/**
 * Create a CRU__ContractRule record linking a rule to a contract.
 * Returns the created record including its __id.
 */
export async function createContractRule(params: {
	ruleId: string;
	contractId: string;
	sequence?: number;
	hour1?: number;
	hour2?: number;
	multiplier1?: number;
	multiplier2?: number;
	time1?: string;
	time2?: string;
	day?: string;
	ordinal?: string;
	operation?: string;
	enabled?: number;
	scope?: string;
	minutes?: number;
	label?: string;
	field?: string;
}) {
	const result = await db
		.from(CRU__ContractRule)
		.insert({
			_rule_id: params.ruleId,
			_contract_id: params.contractId,
			sequence: params.sequence ?? 1,
			hour1: params.hour1 ?? 0,
			hour2: params.hour2 ?? 0,
			multiplier1: params.multiplier1 ?? 0,
			multiplier2: params.multiplier2 ?? 0,
			time1: params.time1 ?? "",
			time2: params.time2 ?? "",
			day: params.day ?? "",
			ordinal: params.ordinal ?? "",
			operation: params.operation ?? "",
			enabled: params.enabled ?? 1,
			scope: params.scope ?? "",
			minutes: params.minutes ?? 0,
			label: params.label ?? "",
			field: params.field ?? "",
		})
		.execute();

	if (result.error)
		throw new Error(`Failed to create ContractRule: ${result.error}`);
	return result.data;
}

/**
 * Delete a CRU__ContractRule record by __id. Used in test teardown.
 */
export async function deleteContractRule(cruId: string) {
	const result = await db
		.from(CRU__ContractRule)
		.delete()
		.where((q) => q.where(eq(CRU__ContractRule.__id, cruId)))
		.execute();

	if (result.error) {
		console.warn(
			`Warning: Failed to delete ContractRule ${cruId}:`,
			result.error,
		);
	}
}

/**
 * List all CRU__ContractRule records for a given contract.
 * Useful for diagnostics and pre-test verification.
 */
export async function getContractRules(contractId: string) {
	const result = await db
		.from(CRU__ContractRule)
		.list()
		.where(eq(CRU__ContractRule._contract_id, contractId))
		.execute();

	if (result.error)
		throw new Error(`Failed to list ContractRules: ${result.error}`);
	return result.data;
}

/**
 * List all master Rule records. Useful for discovering which rules
 * are available in the system for testing.
 */
export async function listRules() {
	const result = await db.from(RUL__Rule).list().execute();

	if (result.error)
		throw new Error(`Failed to list Rules: ${result.error}`);
	return result.data;
}
