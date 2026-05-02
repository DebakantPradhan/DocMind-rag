# DocMind RAG

A Retrieval-Augmented Generation (RAG) system built with Next.js that intelligently chunks and embeds markdown documentation, enabling semantic search and context-aware answers powered by Google's Gemini API.

## Project Overview

**DocMind RAG** is a document intelligence platform that:

- 🔍 **Recursively chunks** markdown files with intelligent text splitting (1000-char chunks, 200-char overlap)
- 🧠 **Generates embeddings** using Google Gemini's embedding model (1536 dimensions)
- 💾 **Stores vectors** in AstraDB for semantic similarity search
- 📝 **Tracks changes** with file hashing and sync manifests
- 🤖 **Powers RAG queries** via the `/api/chat` endpoint

## Key Components

### Backend Methods & Features

#### Document Processing (`scripts/loadDb.ts`)

- **`loadDb.ts`** — Main orchestration script for document synchronization
- **`RecursiveCharacterTextSplitter`** — Intelligently splits text at logical boundaries
- **`createEmbedding(text)`** — Converts text chunks to 1536-dimensional vectors using Gemini
- **`storeDocument(text, sourceFile, collection)`** — Stores embeddings with metadata in AstraDB
- **`processFile(filePath, relPath, manifest, collection, stats)`** — Handles file processing with rename/delete detection
- **Smart caching** — Uses content hashing to detect renamed/moved files without re-embedding

#### Sync & Change Detection (`scripts/syncManifest.ts`)

- **`getSyncManifest()`** — Loads the document sync state
- **`hashFileContent(content)`** — Creates unique file fingerprints
- **`updateManifestEntry()`** — Updates tracking for processed files
- **`findDeletedFiles()`** — Detects removed documentation
- **`markAsDeleted()`** — Marks documents as deleted in database

#### Chat API (`app/api/chat/route.ts`)

- RESTful endpoint for RAG queries
- Accepts user questions and returns context-aware responses
- Uses stored embeddings for semantic retrieval

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

```
ASTRA_DB_API_ENDPOINT=your_astra_endpoint
ASTRA_DB_APPLICATION_TOKEN=your_astra_token
ASTRA_DB_NAMESPACE=your_namespace
ASTRA_DB_COLLECTION=documents
GEMINI_API_KEY=your_gemini_key
DOCS_DIR=./path/to/docs
```

## Testing RAG Functionality

To verify DocMind RAG is working correctly, ask the LLM about these **DocMind-specific** features:

- **"Can DocMind detect when a markdown file is renamed?"**
- **"How does DocMind chunk large documents?"**
- **"What embedding dimension does DocMind use?"**
- **"How does DocMind handle file deletion?"**
- **"Explain DocMind's sync manifest tracking system"**
- **"What's the overlap strategy in DocMind's text splitting?"**
- **"How does DocMind store vector embeddings?"**

These questions test whether the RAG system has properly indexed your documentation about DocMind's methods and architecture.
