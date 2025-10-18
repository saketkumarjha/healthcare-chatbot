import OpenAI from "openai";
import config from "../config/index.js";
import logger from "../utils/logger.js";
import { AppError } from "../utils/errorHandler.js";

class EmbeddingService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
    this.model = config.openai.embeddingModel || "text-embedding-3-small";
    this.embeddingDimension = config.openai.embeddingDimension || 1536;
    this.maxChunkLength = 8191; // OpenAI's max tokens for embeddings

    logger.info(`Embedding provider: OpenAI (${this.model})`);
    logger.info(`Embedding dimension: ${this.embeddingDimension}`);
  }

  /**
   * Clean and normalize text for embedding
   */
  cleanText(text) {
    if (!text || typeof text !== "string") {
      return "empty text content";
    }

    try {
      let cleaned = text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Truncate if too long (rough estimate: 1 token ≈ 4 chars)
      const maxChars = this.maxChunkLength * 4;
      if (cleaned.length > maxChars) {
        cleaned = cleaned.substring(0, maxChars);
        const lastSpace = cleaned.lastIndexOf(" ");
        if (lastSpace > maxChars * 0.7) {
          cleaned = cleaned.substring(0, lastSpace);
        }
        cleaned = cleaned.trim();
      }

      if (cleaned.length < 10) {
        cleaned = "This is a text chunk from a document";
      }

      return cleaned;
    } catch (error) {
      logger.error("Error cleaning text:", error.message);
      return "text content for embedding";
    }
  }

  /**
   * Generate embedding for a single text using OpenAI
   */
  async generateEmbedding(text) {
    try {
      const cleanedText = this.cleanText(text);
      logger.debug(
        `Generating embedding for text: ${cleanedText.substring(0, 50)}...`
      );

      // Log configuration for debugging
      logger.info(
        `🔧 Embedding config: model=${this.model}, dimensions=${this.embeddingDimension}`
      );

      const requestParams = {
        model: this.model,
        input: cleanedText,
        encoding_format: "float",
      };

      // CRITICAL: Add dimensions parameter for text-embedding-3-* models
      if (this.embeddingDimension && this.embeddingDimension !== 1536) {
        requestParams.dimensions = this.embeddingDimension;
        logger.info(
          `✅ Requesting ${this.embeddingDimension} dimensions from OpenAI`
        );
      }

      const response = await this.openai.embeddings.create(requestParams);
      const embedding = response.data[0].embedding;

      logger.info(`✅ Received embedding with ${embedding.length} dimensions`);

      if (
        !Array.isArray(embedding) ||
        embedding.length !== this.embeddingDimension
      ) {
        throw new Error(
          `Invalid embedding dimension: expected ${this.embeddingDimension}, got ${embedding.length}`
        );
      }

      return embedding;
    } catch (error) {
      logger.error("OpenAI embedding generation failed:", {
        error: error.message,
        textPreview: text.substring(0, 100),
      });

      if (error.status === 401) {
        throw new AppError("Invalid OpenAI API key", 401);
      }
      if (error.status === 429) {
        throw new AppError("OpenAI rate limit exceeded", 429);
      }

      throw new AppError(`Embedding failed: ${error.message}`, 500);
    }
  }

  /**
   * Generate embeddings for multiple texts (batch processing)
   * OpenAI supports batch requests up to 2048 inputs
   */
  async generateEmbeddings(texts) {
    try {
      logger.info(`\n${"=".repeat(60)}`);
      logger.info(`Starting batch embedding: ${texts.length} chunks`);
      logger.info(
        `Using ${this.model} with ${this.embeddingDimension} dimensions`
      );
      logger.info(`${"=".repeat(60)}\n`);

      const embeddings = [];
      const batchSize = 100;

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(texts.length / batchSize);

        logger.info(
          `📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} items)`
        );

        try {
          const cleanedBatch = batch.map((text) => this.cleanText(text));

          const requestParams = {
            model: this.model,
            input: cleanedBatch,
            encoding_format: "float",
          };

          // CRITICAL: Add dimensions parameter
          if (this.embeddingDimension && this.embeddingDimension !== 1536) {
            requestParams.dimensions = this.embeddingDimension;
            logger.info(
              `🔧 Requesting ${this.embeddingDimension} dimensions for batch ${batchNum}`
            );
          }

          const response = await this.openai.embeddings.create(requestParams);
          const batchEmbeddings = response.data.map((item) => item.embedding);

          // Verify dimensions
          if (batchEmbeddings[0].length !== this.embeddingDimension) {
            logger.error(
              `❌ Dimension mismatch in batch ${batchNum}: expected ${this.embeddingDimension}, got ${batchEmbeddings[0].length}`
            );
          }

          embeddings.push(...batchEmbeddings);

          const progress = Math.round(
            ((i + batch.length) / texts.length) * 100
          );
          logger.info(`✅ Batch ${batchNum} complete (${progress}% total)`);

          if (i + batchSize < texts.length) {
            await this.delay(100);
          }
        } catch (error) {
          logger.error(`❌ Batch ${batchNum} failed: ${error.message}`);
          embeddings.push(...new Array(batch.length).fill(null));
        }
      }

      const successCount = embeddings.filter((e) => e !== null).length;
      logger.info(
        `\n✅ Completed: ${successCount}/${texts.length} successful\n`
      );

      return embeddings;
    } catch (error) {
      logger.error("Batch embedding failed:", error.message);
      throw error;
    }
  }
  /**
   * Generate embeddings for chunks with metadata
   */
  async generateChunkEmbeddings(chunks) {
    try {
      logger.info(`Starting embedding for ${chunks.length} chunks`);

      const texts = chunks.map((chunk, index) => {
        if (!chunk.text) {
          logger.warn(`Chunk ${index} missing text field`);
          return "empty chunk content";
        }
        return chunk.text;
      });

      const embeddings = await this.generateEmbeddings(texts);

      const chunksWithEmbeddings = chunks
        .map((chunk, index) => ({
          ...chunk,
          embedding: embeddings[index],
        }))
        .filter((chunk) => chunk.embedding !== null);

      logger.info(
        `✅ Successfully processed ${chunksWithEmbeddings.length}/${chunks.length} chunks`
      );

      if (chunksWithEmbeddings.length > 0) {
        logger.info(
          `🔍 Embedding dimension: ${chunksWithEmbeddings[0].embedding.length}`
        );
        logger.info(
          `🔍 Sample values: [${chunksWithEmbeddings[0].embedding
            .slice(0, 5)
            .map((n) => n.toFixed(4))
            .join(", ")}...]`
        );
      }

      return chunksWithEmbeddings;
    } catch (error) {
      logger.error("Error in generateChunkEmbeddings:", error.message);
      throw error;
    }
  }

  /**
   * Test the embedding service
   */
  async testConnection() {
    try {
      logger.info("\n🔍 Testing OpenAI embedding API...");

      const testText = "This is a test sentence for embedding generation";
      const startTime = Date.now();
      const embedding = await this.generateEmbedding(testText);
      const duration = Date.now() - startTime;

      logger.info(`✅ OpenAI API test successful!`);
      logger.info(`   Model: ${this.model}`);
      logger.info(`   Dimension: ${embedding.length}`);
      logger.info(`   Expected: ${this.embeddingDimension}`);
      logger.info(`   Generation time: ${duration}ms`);
      logger.info(
        `   Sample values: [${embedding
          .slice(0, 5)
          .map((n) => n.toFixed(4))
          .join(", ")}...]`
      );

      return true;
    } catch (error) {
      logger.error("❌ OpenAI API test failed:", error.message);
      return false;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(embedding1, embedding2) {
    if (embedding1.length !== embedding2.length) {
      throw new Error("Embeddings must have the same dimensions");
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get information about the embedding service
   */
  getModelInfo() {
    return {
      model: this.model,
      dimension: this.embeddingDimension,
      provider: "OpenAI",
      maxChunkLength: this.maxChunkLength,
    };
  }
}

export default new EmbeddingService();
