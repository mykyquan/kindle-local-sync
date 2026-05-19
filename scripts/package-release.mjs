import { deflateRawSync } from "node:zlib";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const RELEASE_DIR = "release";
const REQUIRED_FILES = ["main.js", "manifest.json"];
const OPTIONAL_FILES = ["styles.css"];

const root = process.cwd();
const releaseDir = path.join(root, RELEASE_DIR);
const crcTable = createCrcTable();

if (process.argv.includes("--clean")) {
	await cleanReleaseDir();
	console.log(`Cleaned ${RELEASE_DIR}/`);
	process.exit(0);
}

try {
	const manifest = await readJson("manifest.json");
	const version = manifest.version;

	if (typeof version !== "string" || version.trim() === "") {
		throw new Error("manifest.json must contain a non-empty version string.");
	}

	await validateReleaseMetadata(manifest);

	const requiredAssets = await verifyRequiredFiles(REQUIRED_FILES);
	const optionalAssets = await collectOptionalFiles(OPTIONAL_FILES);
	const assets = [...requiredAssets, ...optionalAssets];

	await cleanReleaseDir();
	await mkdir(releaseDir, { recursive: true });

	for (const asset of assets) {
		await copyFile(path.join(root, asset), path.join(releaseDir, asset));
	}

	const zipName = `kindle-local-sync-v${version}.zip`;
	const zipPath = path.join(releaseDir, zipName);
	await createZip(
		assets.map((asset) => ({
			name: asset,
			path: path.join(root, asset),
		})),
		zipPath,
	);

	console.log(`Packaged Kindle Local Sync ${version}`);
	console.log(`Release assets written to ${RELEASE_DIR}/`);
	for (const asset of assets) {
		console.log(`- ${RELEASE_DIR}/${asset}`);
	}
	console.log(`- ${RELEASE_DIR}/${zipName}`);
} catch (error) {
	console.error(`Release packaging failed: ${error.message}`);
	process.exit(1);
}

async function cleanReleaseDir() {
	await rm(releaseDir, { recursive: true, force: true });
}

async function readJson(filePath) {
	const contents = await readFile(path.join(root, filePath), "utf8");
	return JSON.parse(contents);
}

async function verifyRequiredFiles(files) {
	const missingFiles = [];

	for (const file of files) {
		if (!(await isFile(path.join(root, file)))) {
			missingFiles.push(file);
		}
	}

	if (missingFiles.length > 0) {
		throw new Error(
			`Missing required release file${missingFiles.length === 1 ? "" : "s"}: ${missingFiles.join(", ")}. Run npm run build before packaging.`,
		);
	}

	return files;
}

async function validateReleaseMetadata(manifest) {
	const requiredStringFields = ["id", "name", "description", "version", "minAppVersion"];

	for (const field of requiredStringFields) {
		if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
			throw new Error(`manifest.json must contain a non-empty ${field} string.`);
		}
	}

	if (manifest.isDesktopOnly !== true) {
		throw new Error("manifest.json must keep isDesktopOnly set to true.");
	}

	const packageJson = await readJson("package.json");
	if (packageJson.version !== manifest.version) {
		throw new Error(
			`Version mismatch: manifest.json is ${manifest.version}, but package.json is ${packageJson.version}.`,
		);
	}

	if (packageJson.license !== "MIT") {
		throw new Error(`License must remain MIT, but package.json declares ${packageJson.license}.`);
	}

	if (await isFile(path.join(root, "versions.json"))) {
		const versions = await readJson("versions.json");
		if (versions[manifest.version] !== manifest.minAppVersion) {
			throw new Error(
				`versions.json must map ${manifest.version} to minAppVersion ${manifest.minAppVersion}.`,
			);
		}
	}
}

async function collectOptionalFiles(files) {
	const existingFiles = [];

	for (const file of files) {
		if (await isFile(path.join(root, file))) {
			existingFiles.push(file);
		}
	}

	return existingFiles;
}

async function isFile(filePath) {
	try {
		return (await stat(filePath)).isFile();
	} catch (error) {
		if (error.code === "ENOENT") {
			return false;
		}

		throw error;
	}
}

async function createZip(entries, outputPath) {
	const localFileRecords = [];
	const centralDirectoryRecords = [];
	let offset = 0;

	for (const entry of entries) {
		const source = await readFile(entry.path);
		const compressed = deflateRawSync(source, { level: 9 });
		const fileName = Buffer.from(entry.name, "utf8");
		const crc = crc32(source);
		const { dosTime, dosDate } = toDosDateTime((await stat(entry.path)).mtime);

		const localHeader = Buffer.alloc(30);
		localHeader.writeUInt32LE(0x04034b50, 0);
		localHeader.writeUInt16LE(20, 4);
		localHeader.writeUInt16LE(0, 6);
		localHeader.writeUInt16LE(8, 8);
		localHeader.writeUInt16LE(dosTime, 10);
		localHeader.writeUInt16LE(dosDate, 12);
		localHeader.writeUInt32LE(crc, 14);
		localHeader.writeUInt32LE(compressed.length, 18);
		localHeader.writeUInt32LE(source.length, 22);
		localHeader.writeUInt16LE(fileName.length, 26);
		localHeader.writeUInt16LE(0, 28);

		localFileRecords.push(localHeader, fileName, compressed);

		const centralHeader = Buffer.alloc(46);
		centralHeader.writeUInt32LE(0x02014b50, 0);
		centralHeader.writeUInt16LE(20, 4);
		centralHeader.writeUInt16LE(20, 6);
		centralHeader.writeUInt16LE(0, 8);
		centralHeader.writeUInt16LE(8, 10);
		centralHeader.writeUInt16LE(dosTime, 12);
		centralHeader.writeUInt16LE(dosDate, 14);
		centralHeader.writeUInt32LE(crc, 16);
		centralHeader.writeUInt32LE(compressed.length, 20);
		centralHeader.writeUInt32LE(source.length, 24);
		centralHeader.writeUInt16LE(fileName.length, 28);
		centralHeader.writeUInt16LE(0, 30);
		centralHeader.writeUInt16LE(0, 32);
		centralHeader.writeUInt16LE(0, 34);
		centralHeader.writeUInt16LE(0, 36);
		centralHeader.writeUInt32LE(0, 38);
		centralHeader.writeUInt32LE(offset, 42);

		centralDirectoryRecords.push(centralHeader, fileName);
		offset += localHeader.length + fileName.length + compressed.length;
	}

	const centralDirectory = Buffer.concat(centralDirectoryRecords);
	const endRecord = Buffer.alloc(22);
	endRecord.writeUInt32LE(0x06054b50, 0);
	endRecord.writeUInt16LE(0, 4);
	endRecord.writeUInt16LE(0, 6);
	endRecord.writeUInt16LE(entries.length, 8);
	endRecord.writeUInt16LE(entries.length, 10);
	endRecord.writeUInt32LE(centralDirectory.length, 12);
	endRecord.writeUInt32LE(offset, 16);
	endRecord.writeUInt16LE(0, 20);

	await writeFile(outputPath, Buffer.concat([...localFileRecords, centralDirectory, endRecord]));
}

function toDosDateTime(date) {
	const year = Math.max(date.getFullYear(), 1980);

	return {
		dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
		dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
}

function createCrcTable() {
	const table = new Uint32Array(256);

	for (let i = 0; i < table.length; i += 1) {
		let value = i;
		for (let bit = 0; bit < 8; bit += 1) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[i] = value >>> 0;
	}

	return table;
}

function crc32(buffer) {
	let crc = 0xffffffff;

	for (const byte of buffer) {
		crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}

	return (crc ^ 0xffffffff) >>> 0;
}
