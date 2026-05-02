# DocMind RAG - Project Documentation & Implementation Guide

**Created**: 2025-12-02
**Project**: DocMind RAG - Personal Knowledge Base with AI Search
**Status**: Core sync system ready, chat endpoint in progress
**Repository**: /home/devk/Desktop/rag_bot

---

## What is RAG? (Retrieval-Augmented Generation)

### Simple Definition

RAG is a technique that combines information retrieval with language generation:

```
User Query
    ↓
[RETRIEVAL PHASE] Search knowledge base for relevant information
    ↓
[AUGMENTATION PHASE] Combine retrieved information with query
    ↓
[GENERATION PHASE] Feed to LLM to synthesize answer
    ↓
Response with sources
```

### Why RAG Instead of Just Using LLM?

| Problem          | LLM Alone                         | RAG Solution                        |
| ---------------- | --------------------------------- | ----------------------------------- |
| Knowledge cutoff | Can't access info after training  | Retrieves current/custom knowledge  |
| Hallucination    | Generates confident wrong answers | Grounds answers in actual documents |
| Privacy          | Data sent to external API         | Custom data stays in your DB        |
| Specificity      | Generic answers                   | Answers based on your exact data    |

### How DocMind Works in Practice

**Without DocMind (just LLM):**

```
User: "What's my embedding strategy?"
LLM: "Common approaches include batch processing,
      dimension reduction, and compression..."
      [Generic textbook answer]
```

**With DocMind RAG:**

```
User: "What's my embedding strategy?"
    ↓
[DocMind: Search vault for "embedding", "strategy", "chunk"]
    ↓
[DocMind: Retrieve Implementation-Decisions.md]
    ↓
[DocMind: Read "2000 chars API input, 5000 chars storage"]
    ↓
LLM: "DocMind's strategy uses 2000 character API calls
      with 5000 character storage for context preservation."
    ↓
Source: Implementation-Decisions.md (via DocMind RAG)
```

---

## DocMind RAG Pipeline: How the System Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              INPUT PHASE (DocMind Sync)              │
│  Read Obsidian markdown files from vault            │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│        PROCESSING PHASE (DocMind loadDb.ts)         │
│  1. Compute content hash                            │
│  2. Detect rename/duplicate                         │
│  3. Split into chunks (recursive text splitter)     │
│  4. Generate embeddings (Gemini API)                │
│  5. Store in vector DB (Astra DB)                   │
│  6. Track in manifest                               │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│            STORAGE PHASE (Astra DB)                 │
│  Collection: rag_learning                           │
│  Metric: cosine (87% accuracy)                      │
│  Dimension: 1536                                    │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│            QUERY PHASE (DocMind Chat API)           │
│  1. Embed user query (same model)                   │
│  2. Search vector DB (cosine similarity)            │
│  3. Retrieve top-K documents                        │
│  4. Send to LLM with context                        │
│  5. Return synthesized answer + sources             │
└─────────────────────────────────────────────────────┘
```

---

## File Structure

### Project Layout

```
/home/devk/Desktop/rag_bot/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts          [NOT YET: Chat endpoint]
│   ├── layout.tsx                 [Next.js layout]
│   ├── page.tsx                   [Frontend UI - todo]
│   └── globals.css                [Styling]
├── scripts/
│   ├── loadDb.ts                  [Main sync orchestrator ✓]
│   └── syncManifest.ts            [Manifest tracking ✓]
├── data/
│   └── sync-manifest.json         [Created on first sync]
├── package.json                   [Dependencies]
├── tsconfig.json                  [TypeScript config]
├── next.config.ts                 [Next.js config]
├── .env                           [API keys + config]
└── README.md                      [Project overview]
```

### Data Locations

```
Obsidian Vault: /home/devk/Obsidian/Personal/
                ├── RAG-Architecture-Learnings.md
                ├── Real-Time-Data-Problem.md
                ├── Implementation-Decisions.md
                ├── LLM-Knowledge-Boundaries.md
                └── [Other markdown files]

Vector Database: Astra DB
                 Endpoint: https://06057ac5-1ea1-42dc-9874-590236539ec5-us-east-2.apps.astra.datastax.com
                 Namespace: default_keyspace
                 Collection: rag_learning

Manifest: data/sync-manifest.json (tracks file hashes & embeddings)
```

---

## Key Components & Functions

### 1. **syncManifest.ts** - Data Tracking Layer

**Purpose**: Track which files have been synced, what embeddings exist, detect renames/deletes

#### Functions:

**`getSyncManifest(): SyncManifest`**

- Reads `data/sync-manifest.json`
- Returns manifest object tracking all files
- Returns empty object `{}` if file doesn't exist
- Called at start of sync to load previous state

**`saveSyncManifest(manifest: SyncManifest): void`**

- Writes manifest to `data/sync-manifest.json`
- Pretty-prints JSON (readable format)
- Called at end of sync after all updates
- Persists all changes to disk

**`hashFileContent(content: string): string`**

- Computes SHA256 hash of file content
- Returns hex string (64 characters)
- Key innovation: Hash-based tracking enables rename detection
- Called for every `.md` file read

**`findDeletedFiles(manifest: SyncManifest, currentFiles: Map<string, string>): string[]`**

- Compares manifest against files currently on disk
- Returns array of content hashes that are in manifest but NOT in currentFiles
- Identifies deleted files
- Called before deletion cleanup

**`updateManifestEntry(hash: string, filePath: string, manifest: SyncManifest, documentIds: string[]): void`**

- Updates manifest for a file's content hash
- Adds new path to `lastKnownPaths` array with timestamp
- Stores document IDs from embeddings
- Clears `isDeleted` flag if file was restored
- Called after successful embedding

**`markAsDeleted(hash: string, manifest: SyncManifest): void`**

- Marks file as deleted (soft delete)
- Sets `isDeleted: true` and `deletedAt: timestamp`
- Clears `documentIds` array
- Called after deleting embeddings from DB

#### Data Structure:

```typescript
manifest = {
  "abc123def456...": {  // SHA256 content hash
    lastKnownPaths: [
      { path: "My-Notes.md", lastSeen: "2025-12-02T10:30:00Z" },
      { path: "Personal-Learnings.md", lastSeen: "2025-12-02T14:15:00Z" }
    ],
    documentIds: ["doc_id_1", "doc_id_2", ...],
    isDeleted: false,
    deletedAt: null
  }
}
```

---

### 2. **loadDb.ts** - Main Orchestration

**Purpose**: Read files from Obsidian vault, create embeddings, store in Astra DB

#### Key Functions:

**`initializeCollection(): Promise<void>`**

- Creates vector collection if it doesn't exist
- Safe to run multiple times (idempotent)
- Configures:
    - Collection name: `rag_learning`
    - Dimension: 1536 (Gemini embedding size)
    - Metric: `cosine` (for semantic similarity)
- Called once at startup before syncing
- **Output**: Logs if collection created or already exists

**`createEmbedding(text: string): Promise<number[]>`**

- Converts text to vector using Gemini embedding API
- Inputs: Text (truncated to 2000 chars for cost)
- Process:
    1. Check text length (skip if < 10 chars)
    2. Call `ai.models.embedContent()` with Gemini API
    3. Returns vector array (1536 numbers)
- **Rate limited**: 2 requests/sec (500ms delay between calls)
- **Cost**: ~$0.0004 per call
- Returns empty array `[]` on error (continues gracefully)

**`storeDocument(text: string, sourceFile: string, collection: any): Promise<string | null>`**

- Stores single text chunk with embedding in Astra DB
- Process:
    1. Generate embedding via `createEmbedding()`
    2. Truncate text to 5000 chars for storage
    3. Insert into collection with metadata:
        - `$vector`: The embedding vector
        - `text`: Full chunk text
        - `source_file`: Which markdown file
        - `source_type`: "markdown"
        - `created_at`: Timestamp
        - `is_evergreen`: true (always relevant)
    4. Returns document ID or null if failed
- **Output**: Document ID for tracking (added to manifest)

**`processFile(filePath, relPath, manifest, collection, stats, allCurrentFiles): Promise<void>`**

- Processes a single markdown file
- Decision flow:
    ```
    1. Read file content
    2. Compute SHA256 hash
    3. Check if hash exists in manifest:
       ├─ YES + Same path → Skip (unchanged file)
       ├─ YES + Different path → Rename detected! Update path
       └─ NO → New file! Continue...
    4. For new files:
       ├─ Split content into chunks (1000 chars, 200 overlap)
       ├─ For each chunk:
       │  ├─ Generate embedding
       │  ├─ Store in DB
       │  └─ Collect document IDs
       └─ Update manifest with all document IDs
    ```
- **Cost optimization**: Renames reuse embeddings (no re-embedding)
- **Updates**: stats object with new/renamed/skipped counts

**`syncDocuments(): Promise<void>`** [Main Entry Point]

- Orchestrates entire sync process
- Steps:
    1. Load previous manifest from disk
    2. Connect to Astra DB
    3. Initialize `currentFiles` Map
    4. **Walk directory** recursively:
        - Skip: `.obsidian/`, `.git/`, `node_modules/`
        - Find: All `.md` files
        - For each: Call `processFile()`
    5. **Detect deletions** (files in manifest but not on disk):
        - Call `findDeletedFiles()`
        - For each deleted: Remove embeddings from DB, mark as deleted
    6. **Save manifest** to disk
    7. **Log summary**: new, renamed, skipped, deleted counts
- **No errors stop the process**: Continues even if individual files fail

**`main(): Promise<void>`**

- Entry point for script
- Calls: `initializeCollection()` then `syncDocuments()`
- Wraps in catch for fatal errors

---

## How Data Flows Through the System

### Step 1: Directory Walk

```
readDir("/home/devk/Obsidian/Personal/")
    ↓
Filter: Keep only .md files (skip .obsidian/, .git/, node_modules/)
    ↓
Map to: {relPath, filePath}
```

### Step 2: File Processing Loop

```
For each .md file:
    ├─ Read content
    ├─ Compute hash
    ├─ Check manifest[hash]
    │
    ├─ If hash exists + same path:
    │  └─ Skip (unchanged)
    │
    ├─ If hash exists + different path:
    │  └─ Rename detected → Update path, skip embedding
    │
    └─ If new hash:
       ├─ Split into chunks
       ├─ For each chunk:
       │  ├─ Embed (Gemini API)
       │  ├─ Store (Astra DB)
       │  └─ Collect docId
       └─ Update manifest with all docIds
```

### Step 3: Deletion Detection

```
For each hash in manifest:
    If NOT in currentFiles:
       ├─ Delete all embeddings from DB
       ├─ Mark as deleted in manifest
       └─ Log deletion
```

### Step 4: Persist State

```
Save updated manifest to data/sync-manifest.json
    ↓
Next sync reads this manifest
    ↓
Knows what's already embedded
```

---

## Configuration & Environment

### .env File

```
# Astra DB Configuration
ASTRA_DB_NAMESPACE="default_keyspace"
ASTRA_DB_COLLECTION="rag_learning"
ASTRA_DB_API_ENDPOINT="https://06057ac5-1ea1-42dc-9874-590236539ec5-us-east-2.apps.astra.datastax.com"
ASTRA_DB_APPLICATION_TOKEN="[your-token]"

# Gemini API
GEMINI_API_KEY="[your-key]"

# Data Source
DOCS_DIR="/home/devk/Obsidian/Personal"
```

### Constants in Code

```typescript
// Text splitting
chunkSize: 1000; // Characters per chunk
chunkOverlap: 200; // Characters to overlap between chunks

// Embedding API
embeddingModel: 'gemini-embedding-2';
embeddingDimension: 1536;
maxCharsPerCall: 2000; // Cost optimization (API limit)
storageSize: 5000; // Context preservation (DB storage)

// Rate limiting
delayBetweenCalls: 500; // Milliseconds (prevents 429 errors)

// Vector search
metric: 'cosine'; // Similarity calculation
dimension: 1536; // Vector size
```

---

## Running the Sync

### Command

```bash
npm run sync
```

### What DocMind Sync Does

```
1. TypeScript compiled to JS (tsx handles this)
2. Load environment variables from .env
3. Connect to Astra DB
4. Connect to Google Gemini API
5. Create DocMind collection if needed
6. Walk /home/devk/Obsidian/Personal/
7. For each markdown file:
   - Check if changed (DocMind hash comparison)
   - If new: embed and store in DocMind index
   - If renamed: update DocMind path, skip embedding
   - If unchanged: skip (DocMind cache hit)
8. Remove deleted files from DocMind index
9. Save DocMind manifest
10. Print DocMind sync summary
```

### Expected DocMind Output

```
✅ Collection "rag_learning" already exists

📚 Starting DocMind document sync from: /home/devk/Obsidian/Personal

  ✨ New file: RAG-Architecture-Learnings.md
    📄 Split into 5 chunks
    ✅ Stored 5 embeddings

  🔄 Renamed: Real-Time-Data-Problem.md → Real-Time-Issue.md

  ⏭️  Skipped (unchanged): Implementation-Decisions.md

  🗑️  Deleted: Old-Notes.md

✅ DocMind Sync Complete!
  ✨ New files: 1
  🔄 Renamed: 1
  ⏭️  Skipped: 1
  🗑️  Deleted: 1
```

---

## Key Design Decisions & Why

### 1. Content-Addressed Manifest (Hash-Based)

**Problem**: Traditional file tracking by path breaks on rename
**Solution**: Track by SHA256 content hash instead
**Benefit**: Renames detected automatically, embeddings reused, cost savings

### 2. Soft Deletes with Tombstones

**Problem**: Hard delete loses history permanently
**Solution**: Mark as deleted, keep in manifest with timestamp
**Benefit**: File can be restored if re-added, audit trail

### 3. Cosine Metric (not dot_product)

**Problem**: dot_product gave 62% retrieval accuracy
**Solution**: Tested cosine metric
**Benefit**: 87% retrieval accuracy (25% improvement)

### 4. 2000/5000 Chunk Ratio

**Problem**: Need balance between cost (API calls) and context (LLM needs full context)
**Solution**: 2000 chars API input, 5000 chars storage
**Benefit**: Cost optimization while preserving semantic context

### 5. Module Separation

**Problem**: Mixing data tracking with embedding logic hard to maintain
**Solution**: Split into `syncManifest.ts` (data) and `loadDb.ts` (orchestration)
**Benefit**: Separation of concerns, easier testing, reusable modules

---

## Error Handling Strategy

### Graceful Degradation

- If embedding fails on one chunk → Continue with next chunk
- If one file fails → Continue with next file
- If optional metadata fails → Log warning, keep going
- Only fatal errors (missing env vars, no connection) stop execution

### Error Logging

```typescript
console.error('❌ Error message'); // Fatal/critical
console.log('⚠️  Warning'); // Non-critical issue
console.log('✅ Success'); // Positive event
console.log('📄 Info'); // Status info
```

---

## Future Work / TODO

### High Priority

- [ ] Build chat endpoint (`app/api/chat/route.ts`)
- [ ] Implement query embedding & retrieval
- [ ] Add LLM context synthesis
- [ ] Build frontend UI

### Medium Priority

- [ ] Batch embedding optimization (10x faster sync)
- [ ] Incremental sync (check mtime, skip unchanged)
- [ ] Add retry logic with exponential backoff
- [ ] Implement embedding versioning

### Low Priority

- [ ] Add TTL/cleanup for old tombstones
- [ ] Export retrieved context as markdown
- [ ] Track document popularity metrics
- [ ] Add user authentication/multi-user support

---

## Testing DocMind RAG

### Query Suite (Test DocMind-Specific Features)

**DocMind Architecture Queries** (Test if RAG is working):

```
Q: "How does DocMind detect when a markdown file is renamed?"
Expected: "Uses SHA256 content hash-based tracking,
            recognizes same content at new path"

Q: "What's DocMind's embedding strategy?"
Expected: "2000 characters for Gemini API calls,
           5000 characters for database storage"

Q: "What accuracy did DocMind achieve with cosine metric?"
Expected: "87% retrieval accuracy with cosine,
           improved from 62% with dot_product"

Q: "How does DocMind chunk large documents?"
Expected: "RecursiveCharacterTextSplitter with
           1000-character chunks, 200-character overlap"

Q: "What's the dimension of DocMind's embeddings?"
Expected: "1536 dimensions using gemini-embedding-2 model"

Q: "How does DocMind handle deleted files?"
Expected: "Soft delete with tombstones - marks as deleted,
           keeps in manifest with timestamp for audit trail"

Q: "Explain DocMind's sync manifest system"
Expected: "Tracks content hashes and document IDs to detect changes,
           renames, and deletions without re-embedding"
```

### Success Criteria for DocMind

- ✅ Answers reference **DocMind-specific** architecture details
- ✅ Numbers match exactly (87%, 1000 chars, 1536 dims)
- ✅ Explains **why** DocMind made design choices
- ✅ Cites source files (Implementation-Decisions.md, etc.)
- ✅ No generic RAG textbook answers

### DocMind Testing Flow

1. **Verify sync works**: `npm run sync`
2. **Check database**: Run `prisma studio` to see stored embeddings
3. **Query endpoint**: Send question to `/api/chat`
4. **Validate retrieval**: LLM should cite DocMind-specific documents
5. **Spot-check accuracy**: Cross-reference answers with your notes

---

## Testing Your RAG

### Query Suite (From LLM-Knowledge-Boundaries.md)

**Personal/Specific Queries** (True RAG test):

```
Q: "What embedding accuracy did I achieve?"
Expected: "87% with gemini-embedding-2"

Q: "What's my chunk size strategy?"
Expected: "2000 chars API, 5000 chars storage"

Q: "What metrics issue did I fix?"
Expected: "dot_product (62%) → cosine (87%)"
```

**Success Criteria**:

- ✅ Answer is specific to your notes (not generic)
- ✅ Numbers match exactly what you wrote
- ✅ Cites source files/dates
- ✅ Explains reasoning from your notes
- ✅ No hallucinations or made-up facts

**Failure Signs**:

- ❌ Generic textbook answers
- ❌ Wrong numbers (e.g., "75%" instead of 87%)
- ❌ No source attribution
- ❌ Confidently incorrect statements

---

## Tech Stack

| Component  | Technology    | Version | Why                                 |
| ---------- | ------------- | ------- | ----------------------------------- |
| Framework  | Next.js       | 16.2.4  | React + server, deployment ready    |
| Language   | TypeScript    | 5.x     | Type safety, better tooling         |
| Vector DB  | Astra DB      | Latest  | Managed, scalable, cassandra-backed |
| Embeddings | Google Gemini | API     | 87% accuracy on my data             |
| Text Split | LangChain     | 1.1.x   | Proven, production-ready            |
| Runtime    | tsx           | Latest  | Run TS directly in Node             |

---

## Troubleshooting

### Error: "ASTRA_DB_API_ENDPOINT missing"

→ Check `.env` file has ASTRA_DB_API_ENDPOINT set

### Error: "GEMINI_API_KEY missing"

→ Check `.env` file has GEMINI_API_KEY set

### Error: "Collection does not exist"

→ First run should create it. If not, check Astra DB is accessible

### Sync very slow

→ Rate limiting (500ms delay) is intentional. Safe for API limits

### All files marked as "skipped"

→ Manifest exists from previous sync. This is correct (no changes)

### Want to force re-embed everything

→ Delete `data/sync-manifest.json` and run sync again

---

## Summary

This RAG project implements:

1. **Sync Pipeline**: Read Obsidian vault → Detect changes → Embed → Store
2. **Smart Tracking**: Hash-based manifest prevents duplicates & detects renames
3. **Cost Optimization**: Selective embedding, rate limiting, chunk sizing
4. **Semantic Search**: Cosine-metric vector DB for finding related knowledge
5. **Graceful Degradation**: Continues even if individual chunks fail

**Current Status**: Core sync system complete and tested ✓
**Next Step**: Build chat endpoint to query and synthesize answers

---

## Quick Reference Commands

```bash
# Run sync (embed vault to DB)
npm run sync

# Install dependencies
npm install

# Check TypeScript errors
npx tsc --noEmit

# Lint code
npx eslint scripts/

# Start dev server (future: for chat UI)
npm run dev
```

---

**Last Updated**: 2025-12-02
**Project Lead**: DevK
**Questions?**: Refer to the other documentation files in Obsidian vault
