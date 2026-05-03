// app/api/chat/route.ts

import { streamText, UIMessage, convertToModelMessages } from 'ai';
import { google } from '@ai-sdk/google';
import { DataAPIClient } from '@datastax/astra-db-ts';

//used default google provided embedding model, not the ai-sdk one to embed the content since its code already written in loadDb as well. But used ai-sdk for the chat part since it has a nice abstraction for streaming responses and handling messages. Can switch to google genAI client for both embedding and chat in the future if want more control or to use newer models. For now, this hybrid approach works well and keeps things simple.
import { GoogleGenAI } from '@google/genai';

export const maxDuration = 30;

// ============================================
// Initialize clients
// ============================================

// Astra DB (Vector Database)
const astraClient = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN);

const astraDb = await astraClient.db(process.env.ASTRA_DB_API_ENDPOINT as string, {
	keyspace: process.env.ASTRA_DB_NAMESPACE as string,
});

// Gemini API
const genAI = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY,
});

// ============================================
// STATIC SYSTEM PROMPT (instructions only)
// ============================================
const BASE_SYSTEM_PROMPT = `You are DocMind, a RAG-powered personal knowledge assistant.

Your primary purpose is to search, retrieve, and provide information from the user's personal knowledge base.

CORE INSTRUCTIONS:
1. PRIMARY SOURCE: Always prioritize information from the personal documents provided in context
2. CITATION: Always cite which document you're referencing
3. REASONING & ANALYSIS: Use your training and reasoning capabilities to:
   - Analyze and contextualize information from documents
   - Identify patterns and connections
   - Provide deeper insights by combining multiple documents
4. FALLBACK: When queries extend beyond provided documents, use your training knowledge to:
   - Provide broader context or background
   - Offer complementary information or expert analysis
5. TRANSPARENCY: Clearly distinguish between:
   - Information retrieved from personal documents
   - Analysis/reasoning based on your training
6. PRIORITY HIERARCHY:
   - Direct matches in personal documents (cite immediately)
   - Derived insights from personal documents (analyze and explain)
   - External knowledge only when necessary to support document content`;

// ============================================
// Helper Functions
// ============================================

/**
 * Generate embedding for a query using Gemini
 */
async function generateEmbedding(query: string): Promise<number[]> {
	try {
		// const model = genAI.getGenerativeModel({
		//   model: "embedding-001",
		// })

		// const result = await model.embedContent(query)
		const result = await genAI.models.embedContent({
			model: 'gemini-embedding-2',
			contents: query,
			config: { outputDimensionality: 1536 },
		});

		if (!result.embeddings || !result.embeddings[0].values) {
			console.error('No embedding values returned');
			return [];
		}

		return result.embeddings[0].values as number[];
	} catch (error) {
		console.error('Embedding error:', error);
		return [];
	}
}

/**
 * Query vector database for relevant documents (DocMind RAG)
 */
async function queryVectorDB(userQuery: string, topK = 3) {
	try {
		console.log(`🔍 Querying vector DB for: "${userQuery}"`);

		// Step 1: Generate embedding for user query
		const embedding = await generateEmbedding(userQuery);

		if (embedding.length === 0) {
			console.warn('No embedding generated');
			return [];
		}

		// Step 2: Query Astra DB collection
		const collection = await astraDb.collection(process.env.ASTRA_DB_COLLECTION as string);

		const results = await collection.find(
			{},
			{
				sort: { $vector: embedding },
				limit: topK,
			}
		);
		const documentsRaw = await results.toArray();

		// Step 3: Format results
		const documents = documentsRaw.map((doc: any) => ({
			text: doc.text || '',
			source: doc.source_file || 'Unknown',
			score: doc.$similarity || 0,
		}));

		console.log(`✅ Found ${documents.length} relevant documents`);
		documents.forEach((doc, i) => {
			console.log(`  ${i + 1}. ${doc.source} (score: ${doc.score.toFixed(2)})`);
		});

		return documents;
	} catch (error) {
		console.error('Vector DB query error:', error);
		return [];
	}
}

/**
 * Format retrieved documents into context string (NO system prompt here!)
 */
function buildContext(documents: any[]): string {
    if (documents.length === 0) {
        return '[No relevant documents found in your knowledge base]';
    }

    return documents
        .map((doc, i) => `[Document ${i + 1} - ${doc.source}]\n${doc.text}`)
        .join('\n\n---\n\n');
}

// ============================================
// API Route Handler
// ============================================

export async function POST(request: Request) {
	try {
		console.log('\n📨 Received chat request with ' );

		
		// -------- Step 1: Parse request --------
		const { messages } = await request.json();

        if (!messages || messages.length === 0) {
            return Response.json({ error: 'No messages provided' }, { status: 400 });
        }

        // Step 2: Extract current user query
        const lastMessage = messages[messages.length - 1];
        const userQuery =
            lastMessage.parts
                ?.filter((part: any) => part.type === 'text')
                .map((part: any) => part.text)
                .join('') ?? '';

        console.log(`👤 User: "${userQuery}"`);

        // Step 3: Query vector DB only for this turn's query
        const relevantDocs = await queryVectorDB(userQuery, 3);

        // Step 4: Format context (ONLY docs, no system prompt)
        const context = buildContext(relevantDocs);
        console.log(`📚 Context built from ${relevantDocs.length} documents`);

        // Step 5: Prepare messages with injected context
        // The library handles chat history automatically!
        const enhancedMessages = await convertToModelMessages(messages);

        // Only inject context into the CURRENT user message
        if (enhancedMessages.length > 0 && enhancedMessages[enhancedMessages.length - 1].role === 'user') {
            enhancedMessages[enhancedMessages.length - 1] = {
                role: 'user',
                content: `RELEVANT DOCUMENTS FROM YOUR KNOWLEDGE BASE:\n${context}\n\n---\n\nYOUR QUESTION: ${userQuery}`,
            };
        }

        // Step 6: Call Gemini with streaming
        console.log('🚀 Calling Gemini API...');

        const result = streamText({
            model: google('gemini-3.1-flash-lite-preview'),
            system: BASE_SYSTEM_PROMPT, // ← Static instructions, applied to ALL turns
            messages: enhancedMessages, // ← Library handles history automatically
            temperature: 0.7,
            maxOutputTokens: 1024,
            providerOptions: {
                google: {
                    thinkingConfig: {
                        thinkingLevel: 'medium',
                        includeThoughts: false,
                    },
                },
            },
        });

        console.log('✅ Streaming response...');

        // Step 7: Return stream
        return result.toUIMessageStreamResponse();
    } catch (error) {
        console.error('❌ Chat API Error:', error);

        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

        return Response.json({ error: errorMessage }, { status: 500 });
    }
}

// Optional: GET for testing
export async function GET() {
    return Response.json({
        status: '✅ DocMind Chat API is running',
        models: ['gemini-3.1-pro-preview'],
        features: ['RAG', 'Vector DB', 'Streaming'],
        timestamp: new Date().toISOString(),
    });
}
