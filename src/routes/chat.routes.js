import express from 'express';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errorHandler.js';
import embeddingService from '../services/embedding.service.js';
import vectorStoreService from '../services/vectorstore.service.js';
import llmService from '../services/llm.service.js';

const router = express.Router();

// Chat endpoint - Ask a question
router.post('/', async (req, res, next) => {
  try {
    const { question, documentId } = req.body;

    if (!question || question.trim().length === 0) {
      throw new AppError('Question is required', 400);
    }

    logger.info(`Chat request: "${question}"${documentId ? ` for document: ${documentId}` : ''}`);

    // Generate embedding for the query
    const queryEmbedding = await embeddingService.generateEmbedding(question);
    
    if (!queryEmbedding) {
      throw new AppError('Failed to generate query embedding', 500);
    }

    logger.info(`Query embedding generated (${queryEmbedding.length} dimensions)`);

    // Search vector store with embedding
    const searchResults = await vectorStoreService.search(
      question,        // queryText (for logging/reference)
      queryEmbedding,  // queryEmbedding (actual search vector)
      5,               // nResults (top K)
      documentId       // documentId filter (optional)
    );

    logger.info(`Found ${searchResults.length} relevant chunks`);

    // Handle no results case
    if (searchResults.length === 0) {
      return res.json({
        status: 'success',
        data: {
          question: question,
          answer: 'I could not find any relevant information to answer your question. Please try rephrasing or upload a relevant document.',
          sources: [],
          confidence: 0,
          chunksFound: 0
        }
      });
    }

    // Create context from search results
    const context = searchResults
      .map((result, index) => {
        const source = result.metadata.filename || 'Unknown';
        const similarity = (result.similarity * 100).toFixed(1);
        return `[${index + 1}] Source: ${source} (Relevance: ${similarity}%)\n${result.document}`;
      })
      .join('\n\n---\n\n');

    logger.info(`Context created (${context.length} characters)`);

    // Prepare sources for response
    const sources = searchResults.map((result, index) => ({
      index: index + 1,
      documentId: result.metadata.documentId,
      filename: result.metadata.filename,
      chunkIndex: result.metadata.chunkIndex,
      similarity: parseFloat(result.similarity.toFixed(3)),
      score: parseFloat(result.score.toFixed(3)),
      preview: result.document.substring(0, 150) + '...'
    }));

    // Generate answer using LLM
    logger.info('Generating answer with Gemini...');
    const llmResponse = await llmService.generateAnswer(question, context, sources);

    // Calculate average confidence
    const avgSimilarity = searchResults.reduce((sum, r) => sum + r.similarity, 0) / searchResults.length;

    res.status(200).json({
      status: 'success',
      data: {
        question: question,
        answer: llmResponse.answer,
        sources: sources,
        confidence: parseFloat(avgSimilarity.toFixed(3)),
        chunksFound: searchResults.length,
        model: llmResponse.model,
        usage: llmResponse.usage
      }
    });
  } catch (error) {
    logger.error('Chat error:', error);
    next(error);
  }
});

// Streaming chat endpoint
router.post('/stream', async (req, res, next) => {
  try {
    const { question, documentId } = req.body;

    if (!question || question.trim().length === 0) {
      throw new AppError('Question is required', 400);
    }

    logger.info(`Streaming chat request: "${question}"`);

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    try {
      // Generate embedding for the query
      const queryEmbedding = await embeddingService.generateEmbedding(question);

      // Search vector store
      const searchResults = await vectorStoreService.search(
        question,
        queryEmbedding,
        5,
        documentId
      );

      // Send search results first
      res.write(`data: ${JSON.stringify({ 
        type: 'search_complete', 
        chunksFound: searchResults.length 
      })}\n\n`);

      if (searchResults.length === 0) {
        res.write(`data: ${JSON.stringify({ 
          type: 'content',
          content: 'I could not find any relevant information to answer your question.',
          done: true
        })}\n\n`);
        res.end();
        return;
      }

      // Create context
      const context = searchResults
        .map((result, index) => `[${index + 1}] ${result.document}`)
        .join('\n\n');

      const sources = searchResults.map((result, index) => ({
        index: index + 1,
        documentId: result.metadata.documentId,
        filename: result.metadata.filename,
        chunkIndex: result.metadata.chunkIndex,
        similarity: parseFloat(result.similarity.toFixed(3)),
        preview: result.document.substring(0, 150) + '...'
      }));

      // Stream the LLM response
      const stream = llmService.generateStreamingResponse(question, context, sources);

      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        
        if (chunk.done) {
          break;
        }
      }

      res.end();
    } catch (error) {
      logger.error('Streaming error:', error);
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        content: error.message,
        done: true 
      })}\n\n`);
      res.end();
    }
  } catch (error) {
    logger.error('Streaming route error:', error);
    next(error);
  }
});

// Test endpoint - Check system health
router.get('/test', async (req, res) => {
  try {
    const embeddingInfo = embeddingService.getModelInfo();
    const vectorHealth = await vectorStoreService.healthCheck();
    const llmInfo = llmService.getModelInfo();
    
    res.json({
      status: 'success',
      data: {
        embedding: embeddingInfo,
        vectorStore: vectorHealth,
        llm: llmInfo,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Test endpoint error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      services: {
        embedding: 'unknown',
        vectorStore: 'unknown',
        llm: 'unknown'
      }
    };

    try {
      // Test embedding service
      const testEmbedding = await embeddingService.generateEmbedding('test');
      health.services.embedding = testEmbedding ? 'healthy' : 'unhealthy';
    } catch (error) {
      health.services.embedding = 'unhealthy';
      health.status = 'degraded';
    }

    try {
      // Test vector store
      const vectorHealth = await vectorStoreService.healthCheck();
      health.services.vectorStore = vectorHealth.connected ? 'healthy' : 'unhealthy';
    } catch (error) {
      health.services.vectorStore = 'unhealthy';
      health.status = 'degraded';
    }

    try {
      // Test LLM service
      const llmTest = await llmService.testConnection();
      health.services.llm = llmTest ? 'healthy' : 'unhealthy';
    } catch (error) {
      health.services.llm = 'unhealthy';
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    
    res.status(statusCode).json({
      status: 'success',
      data: health
    });
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(503).json({
      status: 'error',
      message: error.message
    });
  }
});

export default router;