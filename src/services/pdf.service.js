import { put, del, list } from '@vercel/blob';
import { PDFExtract } from 'pdf.js-extract';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errorHandler.js';

const pdfExtract = new PDFExtract();

class PDFService {
  constructor() {
    this.documents = new Map();
    this.storageFile = path.join(process.cwd(), 'data', 'documents.json');
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Create data directory if it doesn't exist
      const dataDir = path.dirname(this.storageFile);
      await fs.mkdir(dataDir, { recursive: true });

      // Load documents from file if exists
      try {
        const data = await fs.readFile(this.storageFile, 'utf-8');
        const docs = JSON.parse(data);
        
        // Convert array to Map
        docs.forEach(doc => {
          this.documents.set(doc.id, {
            ...doc,
            uploadedAt: new Date(doc.uploadedAt)
          });
        });
        
        logger.info(`Loaded ${this.documents.size} documents from storage`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.error('Error loading documents:', error);
        }
        logger.info('No existing documents found, starting fresh');
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Error initializing PDF service:', error);
    }
  }

  async saveDocuments() {
    try {
      const docs = Array.from(this.documents.values());
      await fs.writeFile(this.storageFile, JSON.stringify(docs, null, 2));
      logger.debug('Documents saved to storage');
    } catch (error) {
      logger.error('Error saving documents:', error);
    }
  }

  async extractText(pdfBuffer) {
    try {
      logger.info('Extracting text from PDF buffer');
      
      const data = await pdfExtract.extractBuffer(pdfBuffer);
      
      let fullText = '';
      data.pages.forEach(page => {
        page.content.forEach(item => {
          if (item.str) {
            fullText += item.str + ' ';
          }
        });
        fullText += '\n';
      });
      
      const numPages = data.pages.length;
      
      logger.info(`Successfully extracted ${numPages} pages, ${fullText.length} characters`);
      
      return {
        text: fullText.trim(),
        numPages: numPages,
        metadata: {
          numpages: numPages
        }
      };
    } catch (error) {
      logger.error('Error extracting text from PDF:', error);
      throw new AppError('Failed to extract text from PDF: ' + error.message, 500);
    }
  }

  async processUpload(file) {
    try {
      await this.initialize();
      
      const documentId = uuidv4();
      const originalName = file.originalname;
      const timestamp = Date.now();
      const filename = `${documentId}_${timestamp}_${originalName}`;
      
      logger.info(`Processing upload: ${originalName}`);

      // Upload to Vercel Blob
      const blob = await put(filename, file.buffer, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      logger.info(`File uploaded to Blob: ${blob.url}`);

      // Extract text from buffer
      const { text, numPages, metadata } = await this.extractText(file.buffer);
      
      const document = {
        id: documentId,
        filename: originalName,
        blobUrl: blob.url,
        blobPathname: blob.pathname,
        text: text,
        numPages: numPages,
        metadata: metadata,
        uploadedAt: new Date(),
        processed: false,
        chunksCount: 0
      };
      
      this.documents.set(documentId, document);
      await this.saveDocuments();
      
      logger.info(`Document processed successfully: ${documentId}`);
      
      return document;
    } catch (error) {
      logger.error('Error processing upload:', error);
      throw new AppError('Failed to process upload: ' + error.message, 500);
    }
  }

  async getDocument(documentId) {
    await this.initialize();
    
    const document = this.documents.get(documentId);
    if (!document) {
      logger.error(`Document not found: ${documentId}`);
      logger.info(`Available documents: ${Array.from(this.documents.keys()).join(', ')}`);
      throw new AppError('Document not found', 404);
    }
    return document;
  }

  async getAllDocuments() {
    await this.initialize();
    
    return Array.from(this.documents.values()).map(doc => ({
      id: doc.id,
      filename: doc.filename,
      numPages: doc.numPages,
      chunksCount: doc.chunksCount,
      uploadedAt: doc.uploadedAt,
      processed: doc.processed,
      blobUrl: doc.blobUrl
    }));
  }

  async deleteDocument(documentId) {
    await this.initialize();
    
    const document = this.documents.get(documentId);
    if (!document) {
      throw new AppError('Document not found', 404);
    }

    try {
      // Delete from Vercel Blob
      await del(document.blobUrl, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      logger.info(`Deleted blob: ${document.blobUrl}`);
    } catch (error) {
      logger.error('Error deleting blob:', error);
    }

    this.documents.delete(documentId);
    await this.saveDocuments();
    
    logger.info(`Document deleted: ${documentId}`);
    
    return { message: 'Document deleted successfully' };
  }

  async markDocumentAsProcessed(documentId, chunksCount = 0) {
    await this.initialize();
    
    const document = this.documents.get(documentId);
    if (document) {
      document.processed = true;
      document.chunksCount = chunksCount;
      this.documents.set(documentId, document);
      await this.saveDocuments();
      logger.info(`Document marked as processed: ${documentId} (${chunksCount} chunks)`);
    } else {
      logger.warn(`Cannot mark non-existent document as processed: ${documentId}`);
    }
  }

  async getDocumentStats() {
    await this.initialize();
    
    const docs = Array.from(this.documents.values());
    return {
      totalDocuments: docs.length,
      processedDocuments: docs.filter(d => d.processed).length,
      totalPages: docs.reduce((sum, d) => sum + d.numPages, 0),
      totalChunks: docs.reduce((sum, d) => sum + d.chunksCount, 0)
    };
  }

  async listAllBlobs() {
    try {
      const { blobs } = await list({
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      return blobs;
    } catch (error) {
      logger.error('Error listing blobs:', error);
      throw error;
    }
  }

  async syncWithBlobs() {
    try {
      await this.initialize();
      
      logger.info('Syncing documents with Vercel Blob...');
      
      const { blobs } = await list({
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      const blobUrls = new Set(blobs.map(b => b.url));
      const docUrls = new Set(Array.from(this.documents.values()).map(d => d.blobUrl));

      // Remove documents that no longer exist in blob
      let removed = 0;
      for (const [id, doc] of this.documents.entries()) {
        if (!blobUrls.has(doc.blobUrl)) {
          this.documents.delete(id);
          removed++;
        }
      }

      if (removed > 0) {
        await this.saveDocuments();
        logger.info(`Removed ${removed} orphaned documents`);
      }

      logger.info('Sync complete');
      return { synced: true, removed };
    } catch (error) {
      logger.error('Error syncing with blobs:', error);
      throw error;
    }
  }
}

export default new PDFService();