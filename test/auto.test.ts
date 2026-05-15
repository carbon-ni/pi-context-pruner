import { describe, expect, it } from "vitest";
import {
	DEFAULT_AUTO_THRESHOLD_PERCENT,
	configureAutoPrune,
	normalizeContextPercent,
	parseAutoThreshold,
	shouldAutoPrune,
} from "../src/auto.js";

describe("parseAutoThreshold", () => {
	it("defaults to 60%", () => {
		expect(parseAutoThreshold("")).toBe(DEFAULT_AUTO_THRESHOLD_PERCENT);
		expect(DEFAULT_AUTO_THRESHOLD_PERCENT).toBe(60);
	});

	it("accepts plain numbers, percentages, and zero", () => {
		expect(parseAutoThreshold("80")).toBe(80);
		expect(parseAutoThreshold("80%")).toBe(80);
		expect(parseAutoThreshold("0")).toBe(0);
	});

	it("rejects invalid thresholds", () => {
		expect(parseAutoThreshold("101")).toBeUndefined();
		expect(parseAutoThreshold("-1")).toBeUndefined();
		expect(parseAutoThreshold("soon")).toBeUndefined();
	});
});

describe("configureAutoPrune", () => {
	it("enables auto-prune with the default threshold", () => {
		expect(configureAutoPrune("")).toEqual({ enabled: true, thresholdPercent: 60 });
	});

	it("disables auto-prune when threshold is zero", () => {
		expect(configureAutoPrune("0")).toEqual({ enabled: false, thresholdPercent: 0 });
	});
});

describe("shouldAutoPrune", () => {
	it("does not prune when disabled", () => {
		expect(shouldAutoPrune({ percent: 90 }, { enabled: false, thresholdPercent: 0 })).toMatchObject(
			{
				shouldPrune: false,
				reason: "Auto-prune is disabled",
			},
		);
	});

	it("prunes when context usage reaches threshold", () => {
		expect(shouldAutoPrune({ percent: 75 }, { enabled: true, thresholdPercent: 70 })).toMatchObject(
			{
				shouldPrune: true,
				usagePercent: 75,
			},
		);
	});

	it("does not prune before threshold", () => {
		expect(shouldAutoPrune({ percent: 69 }, { enabled: true, thresholdPercent: 70 })).toMatchObject(
			{
				shouldPrune: false,
				usagePercent: 69,
			},
		);
	});

	it("handles fractional percent values defensively", () => {
		expect(normalizeContextPercent(0.75)).toBe(75);
		expect(
			shouldAutoPrune({ percent: 0.75 }, { enabled: true, thresholdPercent: 70 }).shouldPrune,
		).toBe(true);
	});

	it("does not prune when usage is unavailable", () => {
		expect(shouldAutoPrune(undefined, { enabled: true, thresholdPercent: 70 })).toMatchObject({
			shouldPrune: false,
			reason: "Context usage is unavailable",
		});
	});
});
