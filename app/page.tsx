'use client';
import "./globals.css";
import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/components/ai-elements/conversation';

import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';

import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';

export default function ChatPage() {
	// -------- STATE: Manage input manually (AI SDK 5.0) --------
	const [input, setInput] = useState<string>('');

	// -------- HOOK: useChat with new transport API --------
	const { messages, sendMessage, status } = useChat({
		transport: new DefaultChatTransport({
			api: '/api/chat',
		}),
	});

	// -------- HANDLER: Submit form --------
	const handleSubmit = (message: { text: string }, e: React.SyntheticEvent<HTMLFormElement>) => {
		e.preventDefault();

		if (!message.text.trim()) return;

		// Send message using new sendMessage API (AI SDK 5.0)
		sendMessage(message);

		// Clear input
		setInput('');
	};

	// Status values: "submitting" | "streaming" | "ready" | "error"
	const isLoading = status === 'submitted';

	return (
		<div className="flex flex-col h-screen">
			{/* -------- CHAT HISTORY -------- */}
			<Conversation>
				<ConversationContent>
					{messages.length === 0 ? (
						// Empty state
						<div className="flex items-center justify-center h-full">
							<div className="text-center">
								<h2 className="text-2xl font-bold text-gray-900 mb-2">
									Welcome to DocMind!!
								</h2>
								<p className="text-gray-600">
									Ask questions about your own knowledge base
								</p>
							</div>
						</div>
					) : (
						// Messages list
						messages.map((message) => (
							<Message key={message.id} from={message.role as 'user' | 'assistant'}>
								<MessageContent>
									{message.parts?.map((part, i) => {
										switch (part.type) {
											case 'text':
												return (
													<MessageResponse key={`${message.id}-${i}`}>
														{part.text}
													</MessageResponse>
												);
											default:
												return null;
										}
									})}
								</MessageContent>
							</Message>
						))
					)}

					{/* Loading indicator */}
					{isLoading && (
						<Message from="assistant">
							<MessageContent>
								<div className="flex items-center gap-2">
									<div className="animate-spin">⚙️</div>
									<span>
										{status === 'submitted' ? 'Sending...' : 'Thinking...'}
									</span>
								</div>
							</MessageContent>
						</Message>
					)}
				</ConversationContent>

				{/* Scroll to bottom button */}
				<ConversationScrollButton />
			</Conversation>

			{/* -------- INPUT AREA -------- */}
			<PromptInput onSubmit={handleSubmit} className="mt-4">
				{/* Text input */}
				<PromptInputBody>
					<PromptInputTextarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Ask DocMind about your knowledge base..."
						disabled={status !== 'ready'}
						// Allow Ctrl+Enter to submit
						onKeyDown={(e) => {
							if (e.key === 'Enter' && e.ctrlKey) {
								handleSubmit({ text: input }, e as any);
							}
						}}
					/>
				</PromptInputBody>

				{/* Submit button */}
				<PromptInputFooter>
					<PromptInputSubmit
						disabled={!input.trim() || status !== 'ready'}
						status={status}
					/>
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}
