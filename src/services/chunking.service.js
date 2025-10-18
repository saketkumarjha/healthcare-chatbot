import config from '../config/index.js';
import logger from '../utils/logger.js';

class ChunkingService {
  constructor() {
    this.chunkSize = config.chunking?.chunkSize || 1000;
    this.chunkOverlap = config.chunking?.chunkOverlap || 200;
    
    logger.info(`Chunking configuration: ${this.chunkSize} tokens/chunk, ${this.chunkOverlap} tokens overlap`);
  }

  /**
   * Estimate tokens from text (rough approximation: 1 token ≈ 4 characters)
   * OpenAI's tokenizer is more accurate, but this is good for chunking
   */
  estimateTokens(text) {
    if (!text) return 0;
    // More accurate estimation considering spaces and punctuation
    return Math.ceil(text.length / 4);
  }

  /**
   * Split text into sentences using multiple delimiters
   */
  splitIntoSentences(text) {
    if (!text) return [];
    
    return text
      // Handle common sentence endings
      .replace(/([.!?])\s+/g, '$1|SPLIT|')
      // Handle ellipsis
      .replace(/\.\.\.\s+/g, '...|SPLIT|')
      // Handle newlines as sentence breaks
      .replace(/\n+/g, '|SPLIT|')
      .split('|SPLIT|')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Create overlapping chunks from text
   */
  createChunks(text, documentId, filename) {
    try {
      logger.info(`Creating chunks for document: ${documentId}`);
      
      if (!text || text.trim().length === 0) {
        logger.warn(`Empty text for document ${documentId}`);
        return [];
      }

      const sentences = this.splitIntoSentences(text);
      logger.info(`Split document into ${sentences.length} sentences`);

      const chunks = [];
      let currentChunk = '';
      let currentTokens = 0;
      let chunkIndex = 0;
      let sentenceBuffer = []; // Keep track of sentences in current chunk

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i].trim();
        if (!sentence) continue;

        const sentenceTokens = this.estimateTokens(sentence);

        // Check if adding this sentence would exceed chunk size
        if (currentTokens + sentenceTokens > this.chunkSize && currentChunk.length > 0) {
          // Save current chunk
          chunks.push(this.createChunkObject(
            documentId,
            filename,
            currentChunk.trim(),
            currentTokens,
            chunkIndex
          ));

          chunkIndex++;

          // Create overlap from recent sentences
          const overlapData = this.createOverlap(sentenceBuffer);
          currentChunk = overlapData.text;
          currentTokens = overlapData.tokens;
          sentenceBuffer = overlapData.sentences;
        }

        // Add sentence to current chunk
        currentChunk += (currentChunk ? ' ' : '') + sentence;
        currentTokens += sentenceTokens;
        sentenceBuffer.push(sentence);

        // Limit buffer size to prevent memory issues
        if (sentenceBuffer.length > 10) {
          sentenceBuffer.shift();
        }
      }

      // Add final chunk if there's remaining content
      if (currentChunk.trim().length > 0) {
        chunks.push(this.createChunkObject(
          documentId,
          filename,
          currentChunk.trim(),
          currentTokens,
          chunkIndex
        ));
      }

      logger.info(`Created ${chunks.length} chunks for document ${documentId}`);
      
      // Log chunk statistics
      if (chunks.length > 0) {
        const avgTokens = chunks.reduce((sum, c) => sum + c.tokens, 0) / chunks.length;
        const minTokens = Math.min(...chunks.map(c => c.tokens));
        const maxTokens = Math.max(...chunks.map(c => c.tokens));
        logger.info(`Chunk stats - Avg: ${Math.round(avgTokens)}, Min: ${minTokens}, Max: ${maxTokens} tokens`);
      }

      return chunks;
    } catch (error) {
      logger.error(`Error creating chunks for document ${documentId}:`, error.message);
      throw error;
    }
  }

  /**
   * Create a chunk object with consistent structure
   */
  createChunkObject(documentId, filename, text, tokens, chunkIndex) {
    return {
      chunkId: `${documentId}-chunk-${chunkIndex}`,
      documentId: documentId,
      text: text,
      tokens: tokens,
      chunkIndex: chunkIndex,
      metadata: {
        filename: filename,
        position: chunkIndex,
        totalTokens: tokens,
        createdAt: new Date().toISOString()
      }
    };
  }

  /**
   * Create overlap from sentence buffer
   */
  createOverlap(sentenceBuffer) {
    let overlapText = '';
    let overlapTokens = 0;
    const overlapSentences = [];

    // Work backwards through sentences to build overlap
    for (let i = sentenceBuffer.length - 1; i >= 0; i--) {
      const sentence = sentenceBuffer[i];
      const sentenceTokens = this.estimateTokens(sentence);

      // Stop if adding this sentence would exceed overlap size
      if (overlapTokens + sentenceTokens > this.chunkOverlap) {
        break;
      }

      overlapSentences.unshift(sentence);
      overlapTokens += sentenceTokens;
    }

    overlapText = overlapSentences.join(' ');

    return {
      text: overlapText,
      tokens: overlapTokens,
      sentences: overlapSentences
    };
  }

  /**
   * Get overlap sentences (legacy method for compatibility)
   */
  getOverlapSentences(sentences) {
    let overlap = '';
    let tokens = 0;

    for (let i = sentences.length - 1; i >= 0; i--) {
      const sentence = sentences[i].trim();
      if (!sentence) continue;

      const sentenceTokens = this.estimateTokens(sentence);

      if (tokens + sentenceTokens > this.chunkOverlap) {
        break;
      }

      overlap = sentence + (overlap ? ' ' : '') + overlap;
      tokens += sentenceTokens;
    }

    return overlap;
  }

  /**
   * Validate chunks before processing
   */
  validateChunks(chunks) {
    const validChunks = chunks.filter(chunk => {
      if (!chunk.text || chunk.text.trim().length === 0) {
        logger.warn(`Empty chunk found: ${chunk.chunkId}`);
        return false;
      }
      if (chunk.tokens === 0) {
        logger.warn(`Zero-token chunk found: ${chunk.chunkId}`);
        return false;
      }
      return true;
    });

    if (validChunks.length < chunks.length) {
      logger.warn(`Filtered out ${chunks.length - validChunks.length} invalid chunks`);
    }

    return validChunks;
  }

  /**
   * Get chunking configuration info
   */
  getConfig() {
    return {
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
      estimatedCharsPerChunk: this.chunkSize * 4,
      estimatedCharsPerOverlap: this.chunkOverlap * 4
    };
  }
}

export default new ChunkingService();