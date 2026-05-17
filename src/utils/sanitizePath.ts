const INVALID_FILENAME_CHARACTERS = /[\\/:*?"<>|]/g;
const DEFAULT_BOOK_FILENAME = "Untitled Kindle Book";
const DEFAULT_HIGHLIGHTS_FOLDER = "Kindle Highlights";

export function sanitizeMarkdownFilename(title: string): string {
	const sanitizedTitle = sanitizePathSegment(title);
	const filename = sanitizedTitle || DEFAULT_BOOK_FILENAME;

	return `${filename}.md`;
}

export function sanitizeVaultFolderPath(folderPath: string): string {
	const segments = folderPath
		.replace(/\\/g, "/")
		.split("/")
		.map(sanitizePathSegment)
		.filter((segment) => segment.length > 0);

	return segments.join("/") || DEFAULT_HIGHLIGHTS_FOLDER;
}

function sanitizePathSegment(segment: string): string {
	return segment
		.replace(INVALID_FILENAME_CHARACTERS, " ")
		.replace(/\.\.+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+$/, "");
}
