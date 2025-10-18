import dotenv from 'dotenv';
dotenv.config(); 

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import config from './config/index.js';
import documentRoutes from './routes/document.routes.js';
import chatRoutes from './routes/chat.routes.js';
import { errorHandler } from './utils/errorHandler.js';
import logger from './utils/logger.js';
import pdfService from './services/pdf.service.js';
import vectorStoreService from './services/vectorstore.service.js';
import embeddingService from './services/embedding.service.js';
import llmService from './services/llm.service.js';
import whatsappRoutes from './routes/whatsapp.routes.js';

// Debug: Check if Twilio env vars are loaded
console.log('🔍 Twilio Environment Variables:');
console.log('TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? '✅ SET' : '❌ NOT SET');
console.log('TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? '✅ SET' : '❌ NOT SET');
console.log('TWILIO_WHATSAPP_NUMBER:', process.env.TWILIO_WHATSAPP_NUMBER ? '✅ SET' : '❌ NOT SET');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Important for Twilio webhooks
app.use(morgan('dev'));

// Initialize vector store on first request (for serverless)
let isInitialized = false;
const initializeServices = async () => {
  if (!isInitialized) {
    try {
      await vectorStoreService.initialize();
      logger.info('Vector store initialized');
      isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize vector store:', error.message);
    }
  }
};

// Root route
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'Healthcare Chatbot API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      stats: '/api/stats',
      documents: '/api/documents',
      chat: '/api/chat',
      whatsapp: '/whatsapp'
    }
  });
});

// Health check
app.get('/api/health', async (req, res) => {
  await initializeServices();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// System stats
app.get('/api/stats', async (req, res, next) => {
  try {
    await initializeServices();
    const documentStats = pdfService.getDocumentStats();
    const vectorStats = await vectorStoreService.getCollectionStats();
    const embeddingInfo = embeddingService.getModelInfo();
    const llmInfo = llmService.getModelInfo();
    
    res.json({
      status: 'success',
      data: {
        documents: documentStats,
        vectorStore: vectorStats,
        models: {
          embedding: embeddingInfo,
          llm: llmInfo
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Routes
app.use('/api/documents', documentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/whatsapp', whatsappRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Route ${req.originalUrl} not found`
  });
});

// Error handler
app.use(errorHandler);

app.listen(config.port, () => {
  logger.info(`Server is running on port ${config.port}`);
  logger.info(`Node environment: ${config.nodeEnv}`);
  logger.info(`Database environment: ${config.dbEnv}`);
  logger.info(`Database URL: ${config.dbUrl}`);
});

// Export the app for Vercel
export default app;