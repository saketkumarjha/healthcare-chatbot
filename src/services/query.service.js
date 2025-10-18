import embeddingService from "./embedding.service.js";
import vectorStoreService from "./vectorstore.service.js";
import logger from "../utils/logger.js";

class QueryService {
  async processQuery(question, documentId = null) {
    try {
      logger.info(
        `Processing query: "${question}"${
          documentId ? ` for document: ${documentId}` : ""
        }`
      );

      // Generate embedding for the question using OpenAI
      const queryEmbedding = await embeddingService.generateEmbedding(question);
      logger.info(
        `Query embedding generated (${queryEmbedding.length} dimensions)`
      );

      // Search vector store - Fixed parameter order
      // vectorStoreService.search(queryText, queryEmbedding, nResults, documentId)
      const results = await vectorStoreService.search(
        question, // queryText
        queryEmbedding, // queryEmbedding
        null, // nResults (use default)
        documentId // documentId filter
      );

      if (results.length === 0) {
        logger.warn("No relevant chunks found for the query");
        return {
          results: [],
          context: "",
          query: question,
          sources: [],
        };
      }

      // Format context and sources from results
      const context = this.formatContext(results);
      const sources = this.extractSources(results);

      logger.info(`Found ${results.length} relevant chunks`);

      return {
        results: results,
        context: context,
        query: question,
        sources: sources,
      };
    } catch (error) {
      logger.error("Error processing query:", error);
      throw error;
    }
  }

  formatContext(results) {
    if (!results || results.length === 0) {
      return "";
    }

    return results
      .map((result, index) => {
        const source = result.metadata.filename || "Unknown";
        const similarity = (result.similarity * 100).toFixed(1);
        return `[${index + 1}] Source: ${source} (Relevance: ${similarity}%)\n${
          result.document
        }`;
      })
      .join("\n\n---\n\n");
  }

  extractSources(results) {
    if (!results || results.length === 0) {
      return [];
    }

    return results.map((result, index) => ({
      index: index + 1,
      filename: result.metadata.filename,
      documentId: result.metadata.documentId,
      chunkIndex: result.metadata.chunkIndex,
      similarity: result.similarity,
      score: result.score,
      preview: result.document.substring(0, 150) + "...",
    }));
  }

  rankResults(results) {
    // Results are already sorted by Pinecone, but we can re-rank if needed
    return results.sort((a, b) => b.similarity - a.similarity);
  }
}

export default new QueryService();
