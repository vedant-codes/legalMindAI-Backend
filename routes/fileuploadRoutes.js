import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

import mammoth from 'mammoth';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  if (allowedTypes.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only PDF, DOC, DOCX allowed'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

export const fileProcessingStatus = new Map();

async function extractTextFromPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return { text: data.text, pages: data.numpages, info: data.info };
}

async function extractTextFromWord(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return { text: result.value, messages: result.messages };
}

function classifyDocument(text) {
  const types = {
    NDA: ['non-disclosure', 'confidential'],
    'Employment Agreement': ['employment', 'employee'],
    'Service Agreement': ['services', 'contractor'],
    'License Agreement': ['license', 'licensing']
  };

  const textLower = text.toLowerCase();
  let maxScore = 0;
  let documentType = 'Unknown';

  for (const [type, keywords] of Object.entries(types)) {
    const score = keywords.reduce((acc, keyword) => {
      const occurrences = (textLower.match(new RegExp(keyword, 'g')) || []).length;
      return acc + occurrences;
    }, 0);
    if (score > maxScore) {
      maxScore = score;
      documentType = type;
    }
  }
  return documentType;
}

function calculateRiskScore(text) {
  const riskKeywords = ['indemnification', 'liability', 'damages', 'termination'];
  const textLower = text.toLowerCase();
  const riskCount = riskKeywords.reduce((acc, keyword) => {
    const occurrences = (textLower.match(new RegExp(keyword, 'g')) || []).length;
    return acc + occurrences;
  }, 0);
  const maxRisk = riskKeywords.length * 3;
  return Math.min(Math.round((riskCount / maxRisk) * 100), 100);
}

async function processFileAsync(fileId, filePath, mimetype, fileInfo) {
  try {
    fileProcessingStatus.set(fileId, { ...fileInfo, progress: 20, stage: 'extracting_text' });

    let extractedData;
    if (mimetype === 'application/pdf') {
      extractedData = await extractTextFromPDF(filePath);
    } else if (mimetype.includes('wordprocessingml')) {
      extractedData = await extractTextFromWord(filePath);
    } else {
      throw new Error('Unsupported file type');
    }

    fileProcessingStatus.set(fileId, {
      ...fileProcessingStatus.get(fileId),
      progress: 70,
      stage: 'analyzing_content'
    });

    const documentType = classifyDocument(extractedData.text);
    const riskScore = calculateRiskScore(extractedData.text);

    fileProcessingStatus.set(fileId, {
      ...fileProcessingStatus.get(fileId),
      progress: 100,
      status: 'completed',
      stage: 'done',
      extractedText: extractedData.text,
      documentType,
      riskScore,
      wordCount: extractedData.text.split(/\s+/).length
    });

  } catch (error) {
    fileProcessingStatus.set(fileId, {
      ...fileProcessingStatus.get(fileId),
      status: 'error',
      error: error.message
    });
  }
}

// Route to upload file
router.post('/upload', upload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const fileId = uuidv4();
  const filePath = req.file.path;
  const fileInfo = {
    id: fileId,
    originalName: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    status: 'processing',
    uploadedAt: new Date().toISOString()
  };

  fileProcessingStatus.set(fileId, fileInfo);

  res.json({
    success: true,
    fileId,
    message: 'File uploaded successfully. Processing started.',
    file: fileInfo
  });

  await processFileAsync(fileId, filePath, req.file.mimetype, fileInfo);
});

// Get file processing status
router.get('/status/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const status = fileProcessingStatus.get(fileId);
  
  if (!status) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  res.json(status);
});

// Get processed file data
router.get('/document/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const fileData = fileProcessingStatus.get(fileId);
  
  if (!fileData) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  if (fileData.status !== 'completed') {
    return res.status(202).json({ 
      message: 'File is still processing', 
      status: fileData.status,
      progress: fileData.progress 
    });
  }
  
  res.json({
    id: fileData.id,
    originalName: fileData.originalName,
    documentType: fileData.documentType,
    riskScore: fileData.riskScore,
    wordCount: fileData.wordCount,
    extractedText: fileData.extractedText,
    uploadedAt: fileData.uploadedAt,
    completedAt: fileData.completedAt
  });
});

// Get all processed documents (for dashboard)
router.get('/documents', (req, res) => {
  const documents = Array.from(fileProcessingStatus.values())
    .filter(doc => doc.status === 'completed')
    .map(doc => ({
      id: doc.id,
      originalName: doc.originalName,
      documentType: doc.documentType,
      riskScore: doc.riskScore,
      wordCount: doc.wordCount,
      uploadedAt: doc.uploadedAt,
      completedAt: doc.completedAt
    }));
  
  res.json(documents);
});

// Delete document
router.delete('/document/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const fileData = fileProcessingStatus.get(fileId);
  
  if (!fileData) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Delete file from disk if it exists
  const filePath = path.join(uploadsDir, fileData.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  
  // Remove from memory
  fileProcessingStatus.delete(fileId);
  
  res.json({ message: 'Document deleted successfully' });
});



export default router;
