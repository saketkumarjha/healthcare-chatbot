import { GoogleGenerativeAI } from "@google/generative-ai";
import config from "../config/index.js";
import logger from "../utils/logger.js";
import { AppError } from "../utils/errorHandler.js";

class LLMService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.modelName = config.gemini.model;
    this.temperature = config.gemini.temperature;
    this.maxTokens = config.gemini.maxTokens;

    // Initialize model
    this.model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxTokens,
      },
    });
  }

  createSystemPrompt() {
    return `You are a helpful AI assistant that answers questions based on provided context from PDF documents.

Your responsibilities:
- Answer questions using ONLY the information from the provided context
- If the answer is not in the context, clearly state "I cannot find this information in the provided documents"
- Be concise, accurate, and helpful
- Cite sources using [1], [2], etc. when referencing specific information
- Do not make up or infer information not present in the context
- If asked about something outside the context, politely decline and redirect to the document content`;
  }

  createPrompt(question, context) {
    return `${this.createSystemPrompt()}

Context from documents:
${context}

---

Question: ${question}

Please answer the question based on the context provided above.`;
  }

  // Main method used by chat routes
  async generateAnswer(question, context, sources = []) {
    return this.generateResponse(question, context, sources);
  }

  async generateResponse(question, context, sources = []) {
    try {
      logger.info("Generating Gemini AI response");

      if (!context || context.trim().length === 0) {
        return {
          answer:
            "I don't have any relevant information to answer this question. Please make sure documents have been uploaded and processed.",
          sources: [],
          model: this.modelName,
        };
      }

      const prompt = this.createPrompt(question, context);

      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const answer = response.text();

      logger.info("Gemini response generated successfully");

      // Gemini doesn't provide token counts in the same way, but we can estimate
      const estimatedInputTokens = Math.ceil(prompt.length / 4);
      const estimatedOutputTokens = Math.ceil(answer.length / 4);

      return {
        answer: answer,
        model: this.modelName,
        usage: {
          inputTokens: estimatedInputTokens,
          outputTokens: estimatedOutputTokens,
          totalTokens: estimatedInputTokens + estimatedOutputTokens,
        },
        sources: sources,
      };
    } catch (error) {
      logger.error("Error generating Gemini response:", error.message);

      if (error.message?.includes("API key")) {
        throw new AppError("Invalid Gemini API key", 401);
      }
      if (
        error.message?.includes("quota") ||
        error.message?.includes("rate limit")
      ) {
        throw new AppError("Rate limit exceeded, please try again later", 429);
      }
      if (error.message?.includes("SAFETY")) {
        throw new AppError(
          "Response blocked by safety filters. Please rephrase your question.",
          400
        );
      }

      throw new AppError(
        "Failed to generate response from Gemini: " + error.message,
        500
      );
    }
  }

  async *generateStreamingResponse(question, context, sources = []) {
    try {
      logger.info("Generating streaming Gemini response");

      if (!context || context.trim().length === 0) {
        yield {
          type: "content",
          content:
            "I don't have any relevant information to answer this question. Please make sure documents have been uploaded and processed.",
          done: true,
        };
        return;
      }

      const prompt = this.createPrompt(question, context);

      const result = await this.model.generateContentStream(prompt);

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          yield {
            type: "content",
            content: chunkText,
            done: false,
          };
        }
      }

      yield {
        type: "done",
        content: "",
        done: true,
        sources: sources,
      };

      logger.info("Streaming response completed");
    } catch (error) {
      logger.error("Error generating streaming response:", error.message);

      if (error.message?.includes("SAFETY")) {
        yield {
          type: "error",
          content:
            "Response blocked by safety filters. Please rephrase your question.",
          error: error.message,
          done: true,
        };
      } else {
        yield {
          type: "error",
          content: "Error generating response",
          error: error.message,
          done: true,
        };
      }
    }
  }

  async testConnection() {
    try {
      logger.info("Testing Gemini API connection...");
      const result = await this.model.generateContent(
        'Hello, please respond with "Connection successful"'
      );
      const response = result.response;
      logger.info("Gemini API connection successful:", response.text());
      return true;
    } catch (error) {
      logger.error("Gemini API connection failed:", error.message);
      return false;
    }
  }

  getModelInfo() {
    return {
      model: this.modelName,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      provider: "Google Gemini",
    };
  }
}

export default new LLMService();
