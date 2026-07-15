import { describe, expect, it } from "vitest";
import {
	SYNC_END_MARKER,
	SYNC_START_MARKER,
} from "../render/renderMarkdown";
import { analyzeManagedRegion } from "./ManagedRegion";

describe("analyzeManagedRegion", () => {
	it("classifies Markdown without managed markers", () => {
		expect(analyzeManagedRegion("# Book\n\nPersonal notes.")).toEqual({
			kind: "no-markers",
		});
	});

	it("classifies one valid empty managed region", () => {
		expect(analyzeManagedRegion(`${SYNC_START_MARKER}${SYNC_END_MARKER}`)).toMatchObject({
			kind: "valid-empty",
		});
	});

	it("classifies one valid whitespace-only managed region", () => {
		expect(analyzeManagedRegion(`${SYNC_START_MARKER}\n \t\n${SYNC_END_MARKER}`)).toMatchObject({
			kind: "valid-empty",
		});
	});

	it("extracts safely parseable highlight IDs from one valid region", () => {
		const markdown = [
			SYNC_START_MARKER,
			"",
			"### Highlight",
			"",
			"> First",
			"",
			"<!-- kindle-local-sync-id: kls-first -->",
			"",
			"",
			"### Highlight",
			"",
			"> Second",
			"",
			"<!-- kindle-local-sync-id: kls-second -->",
			"",
			SYNC_END_MARKER,
		].join("\n");

		expect(analyzeManagedRegion(markdown)).toMatchObject({
			kind: "valid-with-ids",
			highlightIds: ["kls-first", "kls-second"],
		});
	});

	it("protects a nonempty region without safely parseable highlight IDs", () => {
		expect(analyzeManagedRegion([
			SYNC_START_MARKER,
			"legacy generated content",
			SYNC_END_MARKER,
		].join("\n"))).toEqual({
			kind: "unsafe",
			reason: "nonempty-unparseable-content",
		});
	});

	it("classifies a start marker without an end marker", () => {
		expect(analyzeManagedRegion(`${SYNC_START_MARKER}\nmanaged content`)).toEqual({
			kind: "unsafe",
			reason: "start-without-end",
		});
	});

	it("classifies an end marker without a preceding start marker", () => {
		expect(analyzeManagedRegion(`managed content\n${SYNC_END_MARKER}`)).toEqual({
			kind: "unsafe",
			reason: "end-without-start",
		});
	});

	it("classifies reversed markers", () => {
		expect(analyzeManagedRegion(`${SYNC_END_MARKER}\n${SYNC_START_MARKER}`)).toEqual({
			kind: "unsafe",
			reason: "reversed-markers",
		});
	});

	it("classifies nested markers", () => {
		expect(analyzeManagedRegion([
			SYNC_START_MARKER,
			SYNC_START_MARKER,
			SYNC_END_MARKER,
			SYNC_END_MARKER,
		].join("\n"))).toEqual({
			kind: "unsafe",
			reason: "nested-markers",
		});
	});

	it("classifies duplicate complete regions", () => {
		expect(analyzeManagedRegion([
			SYNC_START_MARKER,
			SYNC_END_MARKER,
			SYNC_START_MARKER,
			SYNC_END_MARKER,
		].join("\n"))).toEqual({
			kind: "unsafe",
			reason: "duplicate-regions",
		});
	});
});
