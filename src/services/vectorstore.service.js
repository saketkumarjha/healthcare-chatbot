import { Pinecone } from '@pinecone-database/pinecone';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errorHandler.js';

class VectorStoreService {
  constructor() {
    this.client = null;
    this.index = null;
    this.indexName = config.pinecone.indexName;
    this.embeddingDimension = config.openai.embeddingDimension || 1024;
    this.initialized = false;
  }

  async initialize() {
    try {
      if (this.initialized) return;

      logger.info('Initializing Pinecone connection...');
      
      if (!config.pinecone.apiKey) {
        throw new Error('PINECONE_API_KEY environment variable is not set');
      }

      // Initialize Pinecone client
      this.client = new Pinecone({
        apiKey: config.pinecone.apiKey
      });

      logger.info(`Connecting to Pinecone index: ${this.indexName}`);

      // Check if index exists
      const indexList = await this.client.listIndexes();
      const indexExists = indexList.indexes?.some(idx => idx.name === this.indexName);

      if (!indexExists) {
        logger.info(`Index "${this.indexName}" not found, creating...`);
        
        await this.client.createIndex({
          name: this.indexName,
          dimension: this.embeddingDimension,
          metric: 'cosine',
          spec: {
            serverless: {
              cloud: config.pinecone.cloud || 'aws',
              region: config.pinecone.region || 'us-east-1'
            }
          }
        });

        logger.info(`Index "${this.indexName}" created successfully`);
        
        // Wait for index to be ready
        await this.waitForIndexReady();
      }

      // Get index instance
      this.index = this.client.index(this.indexName);
      
      // Test connection
      const stats = await this.index.describeIndexStats();
      logger.info('Pinecone connection successful');
      logger.info(`Index stats: ${stats.totalRecordCount || 0} vectors`);

      this.initialized = true;
      logger.info('Pinecone initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Pinecone:', error.message);
      throw new AppError('Failed to connect to vector database: ' + error.message, 500);
    }
  }

  async waitForIndexReady(maxWaitTime = 60000) {
    const startTime = Date.now();
    logger.info('Waiting for index to be ready...');
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const indexDescription = await this.client.describeIndex(this.indexName);
        if (indexDescription.status?.ready) {
          logger.info('Index is ready');
          return;
        }
      } catch (error) {
        // Index might not be fully created yet
      }
      await this.delay(2000);
    }
    
    throw new Error('Index creation timeout');
  }

  async addChunks(chunks) {
    try {
      await this.initialize();
      
      logger.info(`Adding ${chunks.length} chunks to Pinecone`);

      if (chunks.length === 0) {
        logger.warn('No chunks to add');
        return { success: true, count: 0 };
      }

      // Validate embeddings
      for (const chunk of chunks) {
        if (!chunk.embedding || chunk.embedding.length !== this.embeddingDimension) {
          throw new AppError(
            `Invalid embedding dimension. Expected ${this.embeddingDimension}, got ${chunk.embedding?.length}`, 
            400
          );
        }
      }

      // Prepare vectors for Pinecone
      const vectors = chunks.map(chunk => ({
        id: chunk.chunkId,
        values: chunk.embedding,
        metadata: {
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          filename: chunk.metadata.filename,
          text: chunk.text, // Store text in metadata for retrieval
          tokens: chunk.tokens
        }
      }));

      // Upsert in batches (Pinecone recommends batches of 100)
      const batchSize = 100;
      for (let i = 0; i < vectors.length; i += batchSize) {
        const batch = vectors.slice(i, i + batchSize);
        await this.index.upsert(batch);
        logger.info(`Upserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(vectors.length / batchSize)}`);
      }

      logger.info(`Successfully added ${chunks.length} chunks to Pinecone`);
      return { success: true, count: chunks.length };
    } catch (error) {
      logger.error('Error adding chunks to Pinecone:', error.message);
      throw new AppError('Failed to add chunks to vector store: ' + error.message, 500);
    }
  }

  async search(queryText, queryEmbedding, nResults = null, documentId = null) {
    try {
      await this.initialize();
      
      const topK = nResults || config.retrieval.topK || 5;
      
      logger.info(`Searching Pinecone for top ${topK} results`);

      if (!queryEmbedding || queryEmbedding.length !== this.embeddingDimension) {
        throw new AppError(
          `Invalid query embedding dimension. Expected ${this.embeddingDimension}, got ${queryEmbedding?.length}`, 
          400
        );
      }

      const queryParams = {
        vector: queryEmbedding,
        topK: topK,
        includeMetadata: true
      };

      // Add document filter if specified
      if (documentId) {
        queryParams.filter = { documentId: { $eq: documentId } };
        logger.info(`Filtering results by documentId: ${documentId}`);
      }

      const results = await this.index.query(queryParams);

      // Format results
      const formattedResults = results.matches.map(match => ({
        id: match.id,
        document: match.metadata.text,
        metadata: {
          documentId: match.metadata.documentId,
          chunkIndex: match.metadata.chunkIndex,
          filename: match.metadata.filename,
          tokens: match.metadata.tokens
        },
        score: match.score,
        similarity: match.score // Pinecone returns similarity score directly
      }));

      logger.info(`Found ${formattedResults.length} relevant chunks`);
      return formattedResults;
    } catch (error) {
      logger.error('Error searching Pinecone:', error.message);
      throw new AppError('Failed to search vector store: ' + error.message, 500);
    }
  }

  async deleteByDocumentId(documentId) {
    try {
      await this.initialize();
      
      logger.info(`Deleting all chunks for document: ${documentId}`);

      // Delete vectors by metadata filter
      await this.index.deleteMany({
        filter: { documentId: { $eq: documentId } }
      });

      logger.info(`Deleted chunks for document ${documentId}`);
      return { success: true };
    } catch (error) {
      logger.error('Error deleting document chunks:', error.message);
      throw new AppError('Failed to delete document from vector store: ' + error.message, 500);
    }
  }

  async getCollectionStats() {
    try {
      await this.initialize();
      
      const stats = await this.index.describeIndexStats();
      
      return {
        indexName: this.indexName,
        totalVectors: stats.totalRecordCount || 0,
        dimension: stats.dimension,
        embeddingModel: config.openai.embeddingModel,
        provider: 'Pinecone'
      };
    } catch (error) {
      logger.error('Error getting index stats:', error.message);
      throw new AppError('Failed to get index stats: ' + error.message, 500);
    }
  }

  async deleteCollection() {
    try {
      await this.initialize();
      
      logger.info(`Deleting all vectors from index "${this.indexName}"`);
      
      // Delete all vectors
      await this.index.deleteAll();
      
      logger.info(`All vectors deleted from index "${this.indexName}"`);
      return { success: true };
    } catch (error) {
      logger.error('Error deleting all vectors:', error.message);
      throw new AppError('Failed to delete all vectors: ' + error.message, 500);
    }
  }

  async deleteIndex() {
    try {
      if (!this.client) {
        await this.initialize();
      }
      
      await this.client.deleteIndex(this.indexName);
      this.initialized = false;
      this.index = null;
      
      logger.info(`Index "${this.indexName}" deleted`);
      return { success: true };
    } catch (error) {
      logger.error('Error deleting index:', error.message);
      throw new AppError('Failed to delete index: ' + error.message, 500);
    }
  }

  async healthCheck() {
    try {
      if (!this.client) {
        await this.initialize();
      }
      
      const stats = await this.index.describeIndexStats();
      
      return { 
        connected: true, 
        initialized: this.initialized,
        vectorCount: stats.totalRecordCount || 0,
        provider: 'Pinecone'
      };
    } catch (error) {
      logger.error('Health check failed:', error.message);
      return { 
        connected: false, 
        initialized: false, 
        error: error.message 
      };
    }
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new VectorStoreService();