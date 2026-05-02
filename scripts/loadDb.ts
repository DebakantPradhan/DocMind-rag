import { DataAPIClient, vector } from '@datastax/astra-db-ts';
import { GoogleGenAI } from '@google/genai';
import { PuppeteerWebBaseLoader } from '@langchain/community/document_loaders/web/puppeteer';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import 'dotenv/config';

import {
	getSyncManifest,
	saveSyncManifest,
	hashFileContent,
	updateManifestEntry,
	findDeletedFiles,
	markAsDeleted,
	type SyncManifest,
	type SyncStats,
} from './syncManifest';

import * as fs from 'fs';
import * as path from 'path';

const {
	ASTRA_DB_NAMESPACE,
	ASTRA_DB_COLLECTION,
	ASTRA_DB_API_ENDPOINT,
	ASTRA_DB_APPLICATION_TOKEN,
	GEMINI_API_KEY,
} = process.env;

// const ipoData : any= [
//   "https://www.chittorgarh.com/ipo/ipo_dashboard.asp",
//   "https://www.chittorgarh.com/report/ipo-in-india-list-main-board-sme/82/mainboard/",
//   "https://www.chittorgarh.com/report/upcoming-ipos-drhp-filed/158/mainboard/",
//   "https://www.chittorgarh.com/report/ipo-list-by-time-table-and-lot-size/118/mainboard/",
//   "https://www.chittorgarh.com/calendar/ipo-calendar/1/",
//   "https://www.chittorgarh.com/ipo/ipo_perf_tracker.asp",
//   "https://www.chittorgarh.com/report/ipo-subscription-status-live-bidding-data-bse-nse/21/",
//   "https://www.investorgain.com/report/live-ipo-gmp/331/ipo/",
//   "https://www.chittorgarh.com/"
// ]

const DOCS_DIR = process.env.DOCS_DIR as string;
const MANIFEST_FILE = 'data/sync-manifest.json';

// The client gets the API key from the environment variable `GEMINI_API_KEY`.
const ai = new GoogleGenAI({});

// Initialize the db client
const client = new DataAPIClient();

// Ensure required environment variables are present
if (!ASTRA_DB_API_ENDPOINT || !ASTRA_DB_APPLICATION_TOKEN) {
	console.error('Missing ASTRA_DB_API_ENDPOINT or ASTRA_DB_APPLICATION_TOKEN in environment');
	process.exit(1);
}

const db = await client.db(ASTRA_DB_API_ENDPOINT as string, {
	token: ASTRA_DB_APPLICATION_TOKEN,
	keyspace: ASTRA_DB_NAMESPACE as string,
});

const splitter = new RecursiveCharacterTextSplitter({
	chunkSize: 1000,
	chunkOverlap: 200,
});

type similarityMetric = 'cosine' | 'euclidean' | 'dot_product';

// const createCollections = async (similarityMetric : similarityMetric = "dot_product") => {
//   const res = await db.createCollection(
//     ASTRA_DB_COLLECTION as string,{
//     vector: {
//       dimension: 1536,
//       metric: similarityMetric
//     }
// });
//   console.log('Connected to AstraDB:', res);
// }

/**
 * // ===== COLLECTION SETUP =====
 * Create collection if it doesn't exist
 * Only runs once (safe to run multiple times)
 */
async function initializeCollection() {
	try {
		const collections = await db.listCollections();
		const exists = collections.some((c) => c.name === ASTRA_DB_COLLECTION);

		if (exists) {
			console.log(`✅ Collection "${ASTRA_DB_COLLECTION}" already exists\n`);
			return;
		}

		await db.createCollection(ASTRA_DB_COLLECTION as string, {
			vector: {
				dimension: 1536,
				metric: 'dot_product',
			},
		});
		console.log(`✅ Created collection "${ASTRA_DB_COLLECTION}"\n`);
	} catch (error) {
		console.error('❌ Error initializing collection:', error);
		process.exit(1);
	}
}

// const listCollections = async () => {
//   const colls = await db.listCollections();
//   console.log('Connected to AstraDB:', colls);
// }

//scrape page content using puppeteer

/* ===== EMBEDDING FUNCTION ===== */

/**
 * Convert text to vector using Gemini embedding model
 * This makes text searchable by meaning
 */
async function createEmbedding(text: string): Promise<number[]> {
	if (!text || text.length < 10) return [];

	try {
		//  await ai.models.embedContent({
		//   model: "embedding-001",
		//   contents: text.substring(0, 2000),
		// });

		const result = await ai.models.embedContent({
			model: 'gemini-embedding-2',
			contents: text.substring(0, 2000),
			config: { outputDimensionality: 1536 },
		});

		if (result?.embeddings && result.embeddings.length > 0 && result.embeddings[0]?.values) {
			return result.embeddings[0].values as number[];
		}

		console.error('❌ Embedding response missing embeddings:', result);
		return [];
	} catch (error) {
		console.error('❌ Embedding error:', error);
		return [];
	}
}

// ===== STORAGE FUNCTION =====
/**
 * Store a single text chunk with its vector in the database
 * Returns the document ID so we can track it
 */
async function storeDocument(
	text: string,
	sourceFile: string,
	collection: any
): Promise<string | null> {
	try {
		const vector = await createEmbedding(text);
		if (!vector || vector.length === 0) {
			console.log('    ⚠️ No embedding generated');
			return null;
		}

		const result = await collection.insertOne({
			$vector: vector,
			text: text.substring(0, 5000),
			source_file: sourceFile,
			source_type: 'markdown',
			created_at: new Date().toISOString(),
			is_evergreen: true,
		});

		return result.insertedId;
	} catch (error) {
		console.error('    ❌ Storage error:', error);
		return null;
	}
}

// ===== FILE PROCESSING =====
/**
 * Process a single markdown file with smart rename/delete detection
 */
async function processFile(
	filePath: string,
	relPath: string,
	manifest: SyncManifest,
	collection: any,
	stats: SyncStats,
	allCurrentFiles: Map<string, string> // path → hash mapping
) {
	const content = fs.readFileSync(filePath, 'utf-8');
	const currentHash = hashFileContent(content);

	// Check if this content hash already exists (rename/move detection)
	if (manifest[currentHash]) {
		const tracking = manifest[currentHash];
		const oldPath = tracking.lastKnownPaths[tracking.lastKnownPaths.length - 1].path;

		if (oldPath !== relPath) {
			// File was renamed/moved
			console.log(`  🔄 Renamed: ${oldPath} → ${relPath}`);
			stats.renamed++;

			// Update manifest with new path (keep same embeddings!)
			updateManifestEntry(currentHash, relPath, manifest, tracking.documentIds);
			return; // No need to re-embed!
		} else {
			// Same file, not changed
			console.log(`  ⏭️  Skipped (unchanged): ${relPath}`);
			stats.skipped++;
			return;
		}
	}

	// New file
	console.log(`  ✨ New file: ${relPath}`);
	stats.new++;

	// Split and embed
	const chunks = await splitter.splitText(content);
	const documentIds: string[] = [];

	console.log(`    📄 Split into ${chunks.length} chunks`);

	for (const chunk of chunks) {
		const docId = await storeDocument(chunk, relPath, collection);
		if (docId) {
			documentIds.push(docId);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	// Update manifest
	updateManifestEntry(currentHash, relPath, manifest, documentIds);
	console.log(`    ✅ Stored ${documentIds.length} embeddings`);
}

// const scrapePage = async (url: string) => {
// 	const loader = new PuppeteerWebBaseLoader(url, {
// 		launchOptions: {
// 			headless: true,
// 		},
// 		gotoOptions: {
// 			waitUntil: 'domcontentloaded',
// 			timeout: 60000,
// 		},
// 		evaluate: async (page, browser) => {
// 			const result = await page.evaluate(() => {
// 				return document.body.innerHTML;
// 			});
// 			await browser.close();
// 			return result;
// 		},
// 	});

// 	const res = (await loader.scrape()).replace(/<[^>]*>?/gm, '');

// 	return res;
// };

/* ===== MAIN SYNC FUNCTION ===== */
/**
 * Find all markdown files and sync them
 * Main entry point for the sync process
 */
async function syncDocuments() {
	console.log(`\n📚 Starting document sync from: ${DOCS_DIR}\n`);

	// Check if directory exists
	if (!fs.existsSync(DOCS_DIR)) {
		console.error(`❌ Directory not found: ${DOCS_DIR}`);
		console.log(`Create this folder and add markdown files.`);
		process.exit(1);
	}

	const manifest = getSyncManifest();
	const collection = await db.collection(ASTRA_DB_COLLECTION as string);
	const stats: SyncStats = { new: 0, updated: 0, skipped: 0, renamed: 0, deleted: 0 };

	// Step 1: Build map of current files (path → hash)
	const currentFiles = new Map<string, string>();

	async function walkDir(dir: string) {
		const files = fs.readdirSync(dir);

		for (const file of files) {
			const filePath = path.join(dir, file);
			const stat = fs.statSync(filePath);

			if (stat.isDirectory()) {
				if (['.obsidian', '.git', 'node_modules'].includes(file)) continue;
				await walkDir(filePath);
				continue;
			}

			if (file.endsWith('.md')) {
				const relPath = path.relative(DOCS_DIR, filePath);
				const content = fs.readFileSync(filePath, 'utf-8');
				const hash = hashFileContent(content);
				currentFiles.set(relPath, hash);

				// Process this file (NOW AWAITED!)
				await processFile(filePath, relPath, manifest, collection, stats, currentFiles);
			}
		}
	}

	await walkDir(DOCS_DIR);

	// Step 2: Detect deleted files (in manifest but not on disk)
	const deletedHashes = findDeletedFiles(manifest, currentFiles);
	for (const hash of deletedHashes) {
		console.log(`  🗑️  Deleted: ${manifest[hash].lastKnownPaths[0].path}`);

		// Delete embeddings from DB
		for (const docId of manifest[hash].documentIds) {
			try {
				await collection.deleteOne({ _id: docId });
			} catch (e) {
				// Document might not exist
			}
		}

		// Mark as deleted in manifest
		markAsDeleted(hash, manifest);
		stats.deleted++;
	}

	// Step 3: Save updated manifest
	saveSyncManifest(manifest);

	console.log(`\n✅ Sync Complete!`);
	console.log(`  ✨ New files: ${stats.new}`);
	console.log(`  🔄 Renamed: ${stats.renamed}`);
	console.log(`  ⏭️  Skipped: ${stats.skipped}`);
	console.log(`  🗑️  Deleted: ${stats.deleted}\n`);
}

// load the scraped content into AstraDB after generating embeddings using Gemini API

// const loadSampleData = async () => {
// 	const collection = await db.collection(ASTRA_DB_COLLECTION as string);

// 	for await (const url of ipoData) {
// 		const content = await scrapePage(url);
// 		const chunks = await splitter.splitText(content);

// 		for await (const chunk of chunks) {
// 			const response = await ai.models.embedContent({
// 				model: 'gemini-embedding-2',
// 				contents: chunk,
// 				config: { outputDimensionality: 1536 },
// 			});
// 			console.log('Embedding response : ', response);
// 			const vector = response?.embeddings?.[0]?.values;
// 			// console.log('Generated vector : ', vector);
// 			const res = await collection.insertOne({
// 				$vector: vector,
// 				text: chunk,
// 			});

// 			console.log('Inserted document with res : ', res);
// 		}
// 	}
// };

//Now it is time to call the above functions to create collection and load data into AstraDB

// createCollections().then(() => loadSampleData());

// ===== EXECUTION =====
async function main() {
	await initializeCollection();
	await syncDocuments();
}

main().catch((error) => {
	console.error('❌ Fatal error:', error);
	process.exit(1);
});
