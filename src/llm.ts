import { ChatOllama } from "@langchain/ollama";

export function createChatModel() {
  return new ChatOllama({ model: process.env.OLLAMA_MODEL ?? "qwen2.5:7b", temperature: 0 });
}