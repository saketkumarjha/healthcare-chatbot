import express from 'express';
import multer from 'multer';
import pdfService from '../services/pdf.service.js';
import chunkingService from '../services/chunking.service.js';
import embeddingService from '../services/embedding.service.js';
import vectorStoreService from '../services/vectorstore.service.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Use memory storage for Vercel (files stored in memory before uploading to Blob)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760') // 10MB default
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Upload PDF
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No file uploaded'
      });
    }

    const document = await pdfService.processUpload(req.file);

    res.status(201).json({
      status: 'success',
      data: {
        document: {
          id: document.id,
          filename: document.filename,
          numPages: document.numPages,
          uploadedAt: document.uploadedAt,
          processed: document.processed,
          blobUrl: document.blobUrl
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Process document (create chunks and embeddings)
router.post('/:documentId/process', async (req, res, next) => {
  try {
    const { documentId } = req.params;
    
    logger.info(`Processing document: ${documentId}`);

    // Get document
    const document = await pdfService.getDocument(documentId);

    // Create chunks
    const chunks = chunkingService.createChunks(
      document.text,
      document.id,
      document.filename
    );

    logger.info(`Created ${chunks.length} chunks`);

    // Generate embeddings
    const chunksWithEmbeddings = await embeddingService.generateChunkEmbeddings(chunks);

    // Store in vector database
    await vectorStoreService.addChunks(chunksWithEmbeddings);

    // Mark document as processed
    await pdfService.markDocumentAsProcessed(documentId, chunks.length);

    res.json({
      status: 'success',
      message: 'Document processed successfully',
      data: {
        documentId: documentId,
        chunksCreated: chunks.length,
        chunksStored: chunksWithEmbeddings.length
      }
    });
  } catch (error) {
    next(error);
  }
});

// Debug endpoint to see chunks
router.get('/:documentId/chunks', async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const document = await pdfService.getDocument(documentId);
    
    const chunks = chunkingService.createChunks(
      document.text,
      document.id,
      document.filename
    );

    // Show first 3 chunks (fixed the slice to 3 instead of 504)
    const preview = chunks.slice(0, 3).map((chunk, i) => ({
      index: i,
      length: chunk.text.length,
      tokens: chunk.tokens,
      preview: chunk.text.substring(0, 200)
    }));

    res.json({
      status: 'success',
      data: {
        totalChunks: chunks.length,
        preview: preview
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get all documents
router.get('/', async (req, res, next) => {
  try {
    const documents = await pdfService.getAllDocuments();

    res.json({
      status: 'success',
      data: {
        documents: documents,
        count: documents.length
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get single document
router.get('/:documentId', async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const document = await pdfService.getDocument(documentId);

    res.json({
      status: 'success',
      data: {
        document: {
          id: document.id,
          filename: document.filename,
          numPages: document.numPages,
          chunksCount: document.chunksCount,
          uploadedAt: document.uploadedAt,
          processed: document.processed,
          blobUrl: document.blobUrl
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Delete document
router.delete('/:documentId', async (req, res, next) => {
  try {
    const { documentId } = req.params;

    // Delete from vector store
    await vectorStoreService.deleteByDocumentId(documentId);

    // Delete document and blob
    await pdfService.deleteDocument(documentId);

    res.json({
      status: 'success',
      message: 'Document deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;