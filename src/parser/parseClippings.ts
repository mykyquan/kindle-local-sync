export interface KindleHighlight {
	bookTitle: string;
	author: string;
	location: string;
	content: string;
	dateAdded: string;
	type: "Highlight" | "Note";
}

interface ParsedTitleAndAuthor {
	bookTitle: string;
	author: string;
}

interface ParsedMetadata {
	location: string;
	dateAdded: string;
	type: KindleHighlight["type"] | null;
	isBookmark: boolean;
}

const CLIPPING_DELIMITER = "==========";

export function parseClippings(rawText: string): KindleHighlight[] {
	if (!rawText.trim()) {
		return [];
	}

	const highlights: KindleHighlight[] = [];
	const blocks = rawText
		.split(CLIPPING_DELIMITER)
		.map((block) => block.trim())
		.filter((block) => block.length > 0);

	for (const block of blocks) {
		try {
			const parsedHighlight = parseBlock(block);

			if (parsedHighlight) {
				highlights.push(parsedHighlight);
			}
		} catch {
			// Skip malformed clipping blocks and continue parsing the rest.
		}
	}

	return highlights;
}

function parseBlock(block: string): KindleHighlight | null {
	const lines = block
		.split(/\r?\n/)
		.map((line) => line.trim());

	const titleLine = lines[0];
	const metadataLine = lines[1];

	if (!titleLine || !metadataLine) {
		return null;
	}

	const metadata = parseMetadata(metadataLine);

	if (metadata.isBookmark || !metadata.type) {
		return null;
	}

	const content = parseContent(lines.slice(2));

	if (!content) {
		return null;
	}

	const { bookTitle, author } = parseTitleAndAuthor(titleLine);

	if (!bookTitle) {
		return null;
	}

	return {
		bookTitle,
		author,
		location: metadata.location,
		content,
		dateAdded: metadata.dateAdded,
		type: metadata.type,
	};
}

function parseTitleAndAuthor(line: string): ParsedTitleAndAuthor {
	const trimmedLine = line.trim();
	const authorMatch = trimmedLine.match(/\s\(([^()]*)\)\s*$/);

	if (!authorMatch) {
		return {
			bookTitle: trimmedLine,
			author: "Unknown",
		};
	}

	const author = authorMatch[1]?.trim() ?? "Unknown";
	const bookTitle = trimmedLine.slice(0, authorMatch.index).trim();

	return {
		bookTitle,
		author: author || "Unknown",
	};
}

function parseMetadata(line: string): ParsedMetadata {
	const locationMatch = line.match(/\b(?:Location|Loc\.)\s+(\d+(?:-\d+)?)/i);
	const dateAddedMatch = line.match(/\bAdded on\s+(.+)$/i);
	const isBookmark = /\bBookmark\b/i.test(line);

	let type: KindleHighlight["type"] | null = null;

	if (/\bHighlight\b/i.test(line)) {
		type = "Highlight";
	} else if (/\bNote\b/i.test(line)) {
		type = "Note";
	}

	return {
		location: locationMatch?.[1] ?? "",
		dateAdded: dateAddedMatch?.[1]?.trim() ?? "",
		type,
		isBookmark,
	};
}

function parseContent(lines: string[]): string {
	return lines
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join("\n")
		.trim();
}
