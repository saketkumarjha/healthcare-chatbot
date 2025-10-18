import dotenv from 'dotenv';
dotenv.config();

const config = {
  // Server Configuration
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    embeddingDimension: parseInt(process.env.OPENAI_EMBEDDING_DIMENSION || '512'),
    // Dimension options for text-embedding-3-small: 512 or 1536
    // Dimension options for text-embedding-3-large: 256, 1024, or 3072
    // For Pinecone free tier (max 1024 dims), use 512 or 1024
  },

  // Pinecone Configuration
  pinecone: {
    apiKey: process.env.PINECONE_API_KEY,
    indexName: process.env.PINECONE_INDEX_NAME || 'pdf-rag-index',
    cloud: process.env.PINECONE_CLOUD || 'aws', // 'aws', 'gcp', or 'azure'
    region: process.env.PINECONE_REGION || 'us-east-1'
    // Regions by cloud:
    // AWS: us-east-1, us-west-2, eu-west-1, ap-southeast-1, etc.
    // GCP: us-central1, us-west1, us-east1, etc.
    // Azure: eastus, westus, etc.
  },

  // Gemini Configuration (for LLM responses)
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    temperature: parseFloat(process.env.GEMINI_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.GEMINI_MAX_TOKENS || '2048')
  },

  // Chunking Configuration
  chunking: {
    chunkSize: parseInt(process.env.CHUNK_SIZE || '1000'), // tokens per chunk
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '200') // overlap tokens
  },

  // RAG Retrieval Configuration
  retrieval: {
    topK: parseInt(process.env.TOP_K || '5'),
    similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.7')
  },

  // File Upload Configuration
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB default
    allowedMimeTypes: ['application/pdf'],
    uploadDir: process.env.UPLOAD_DIR || './uploads'
  },

  // CORS Configuration
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info'
};

// Validate required environment variables
const requiredEnvVars = [
  'OPENAI_API_KEY',
  'PINECONE_API_KEY',
  'GEMINI_API_KEY'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(varName => console.error(`   - ${varName}`));
  console.error('\nPlease set these in your .env file');
  process.exit(1);
}

export default config;