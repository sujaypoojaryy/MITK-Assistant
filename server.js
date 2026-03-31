// 1) Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

let fetch;
import('node-fetch').then(module => {
  fetch = module.default;
}).catch(err => {
  console.error("Failed to load node-fetch as ESM", err);
  // fallback if needed
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve files from /files directory
app.use('/files', express.static(path.join(__dirname, 'files')));

// ----- Cloudinary Configuration -----
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log('☁️  Cloudinary cloud:', process.env.CLOUDINARY_CLOUD_NAME ? `configured (${process.env.CLOUDINARY_CLOUD_NAME})` : '❌ NOT SET');

// ----- Contribution Upload Setup -----
const CONTRIBUTIONS_JSON = path.join(__dirname, 'dataset', 'contributions.json');

// Ensure contributions.json exists
if (!fs.existsSync(CONTRIBUTIONS_JSON)) {
  fs.writeFileSync(CONTRIBUTIONS_JSON, JSON.stringify([], null, 2));
  console.log('📄 Created contributions.json');
}

// Cloudinary storage for PDF uploads
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'mitk-contributions',
    allowed_formats: ['pdf'],
    resource_type: 'raw',          // raw = non-image files (PDFs)
    public_id: (req, file) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_');
      return `${timestamp}_${safeName}`;
    },
  },
});

const uploadContribution = multer({
  storage: cloudinaryStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Read API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log('Has GEMINI_API_KEY?', !!GEMINI_API_KEY, String(GEMINI_API_KEY || '').slice(0, 10) + '...');

if (!GEMINI_API_KEY) {
  console.error('❌ ERROR: GEMINI_API_KEY not found');
  console.log('Get your free API key from: https://makersuite.google.com/app/apikey');
  process.exit(1);
}

// Load file database (question papers, PDFs, etc.)
let fileDatabase = [];
const filesPath = path.join(__dirname, 'dataset', 'files.json');
if (fs.existsSync(filesPath)) {
  try {
    const raw = fs.readFileSync(filesPath, 'utf-8');
    fileDatabase = JSON.parse(raw);
    console.log(`✅ Loaded ${fileDatabase.length} files from database`);
  } catch (err) {
    console.error('❌ Error reading files.json:', err.message);
  }
}

// Enhanced system prompt with file search capability
const SYSTEM_PROMPT = `You are an intelligent AI assistant for Moodlakatte Institute of Technology, Kundapura (MITK). 
Be helpful, concise, and encouraging. Provide clear, structured answers.

MITK INFORMATION:
- Name: Moodlakatte Institute of Technology, Kundapura (MITK)
- Established: 2004
- Affiliation: VTU, Belagavi
- Location: Moodlakatte, Near Kundapura Railway Station, Udupi District, Karnataka - 576217
- Contact: +91-8254-237630, info@mitkundapura.com
- Website: https://www.mitkundapura.com
- Courses: CSE (Computer Science), ECE (Electronics), ME (Mechanical), CE (Civil), AI/ML
- Facilities: Labs, library, hostels, sports, Wi‑Fi, transport, cafeteria, placement cell

IMPORTANT: When users ask for question papers, model papers, previous year papers, syllabus, or any documents:
1. Identify the branch (CSE/ECE/ME/CE/AIML)
2. Identify the semester (1-8)
3. Identify the subject if mentioned
4. Tell them you're searching for relevant files
5. The system will automatically attach download links if files are available`;

// Load FAQ dataset
let faqs = [];
const faqPath = path.join(__dirname, 'dataset', 'mitk_faq.json');
if (fs.existsSync(faqPath)) {
  try {
    const raw = fs.readFileSync(faqPath, 'utf-8');
    faqs = JSON.parse(raw);
    console.log(`✅ Loaded ${faqs.length} FAQ entries`);
  } catch (err) {
    console.error('❌ Error reading FAQ:', err.message);
  }
}

// Function to check if user is requesting files
function isFileRequest(message) {
  const lower = message.toLowerCase();
  
  // Reject very short messages (like "hi", "hello")
  if (lower.length < 8) {
    return false;
  }
  
  // Strong file request indicators
  const fileKeywords = [
    'question paper', 'model paper', 'previous year', 'past paper',
    'syllabus', 'notes', 'material', 'download', 'pdf', 'document',
    'exam paper', 'test paper', 'old paper', 'study material'
  ];
  
  // Action words that indicate file request
  const actionWords = [
    'show me', 'give me', 'i need', 'i want', 'get me',
    'send me', 'provide', 'share', 'can i get', 'where can i find'
  ];
  
  // Check for file keywords
  const hasFileKeyword = fileKeywords.some(keyword => lower.includes(keyword));
  
  // Check for action words combined with file context
  const hasActionWord = actionWords.some(action => lower.includes(action));
  
  // Check if message has branch + semester combination
  const hasBranch = /\b(cse|ece|me|ce|aiml|computer|electronics|mechanical|civil)\b/i.test(lower);
  const hasSemester = /\b(sem(?:ester)?|[1-8](?:st|nd|rd|th)?)\s*[1-8]\b/i.test(lower);
  
  // Return true only if:
  // 1. Has explicit file keywords, OR
  // 2. Has action word + (branch OR semester), OR
  // 3. Has branch + semester together
  return hasFileKeyword || 
         (hasActionWord && (hasBranch || hasSemester)) ||
         (hasBranch && hasSemester);
}

// Function to search for relevant files
function searchFiles(message) {
  const lower = message.toLowerCase();
  const matches = [];
  
  // First check if this is actually a file request
  if (!isFileRequest(message)) {
    return []; // Return empty array if not a file request
  }
  
  // Extract branch
  let branch = null;
  if (lower.includes('cse') || lower.includes('computer science')) branch = 'CSE';
  else if (lower.includes('ece') || lower.includes('electronics')) branch = 'ECE';
  else if (lower.includes('me') || lower.includes('mechanical')) branch = 'ME';
  else if (lower.includes('ce') || lower.includes('civil')) branch = 'CE';
  else if (lower.includes('aiml') || lower.includes('ai/ml') || lower.includes('ai ml')) branch = 'AIML';
  
  // Extract semester
  let semester = null;
  const semMatch = lower.match(/sem(?:ester)?\s*(\d)|(\d)(?:st|nd|rd|th)?\s*sem/i);
  if (semMatch) {
    semester = parseInt(semMatch[1] || semMatch[2]);
  }
  
  // Keywords for file types
  const isQuestionPaper = lower.includes('question') || lower.includes('paper') || lower.includes('exam');
  const isModelPaper = lower.includes('model');
  const isPreviousYear = lower.includes('previous') || lower.includes('old') || lower.includes('past');
  const isSyllabus = lower.includes('syllabus');
  const isNotes = lower.includes('notes') || lower.includes('material');
  
  // Search in file database
  for (const file of fileDatabase) {
    let score = 0;
    
    // Match branch (require branch or subject match for scoring)
    if (branch && file.branch === branch) score += 15;
    
    // Match semester
    if (semester && file.semester === semester) score += 15;
    
    // Match file type
    if (isQuestionPaper && file.type.includes('question')) score += 10;
    if (isModelPaper && file.type.includes('model')) score += 10;
    if (isPreviousYear && file.type.includes('previous')) score += 10;
    if (isSyllabus && file.type.includes('syllabus')) score += 10;
    if (isNotes && file.type.includes('notes')) score += 10;
    
    // Match subject name
    if (file.subject && lower.includes(file.subject.toLowerCase())) score += 12;
    
    // Only include files with meaningful scores (at least 10 points)
    if (score >= 10) {
      matches.push({ ...file, score });
    }
  }
  
  // Sort by relevance score
  matches.sort((a, b) => b.score - a.score);
  
  return matches.slice(0, 5); // Return top 5 matches
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'MITK AI Backend is running',
    model: 'Google Gemini 2.5 Flash',
    filesAvailable: fileDatabase.length,
    time: new Date().toISOString()
  });
});

// ----- Contribution Endpoint -----

// POST /api/contribute – upload a question/model paper to Cloudinary
app.post('/api/contribute', uploadContribution.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No PDF file uploaded.' });
    }

    const { paperType, branch, semester, subject, year, contributorName, contributorEmail } = req.body;

    // Basic validation
    if (!paperType || !branch || !semester) {
      return res.status(400).json({ success: false, error: 'Paper type, branch, and semester are required.' });
    }

    const contributionId = `contrib_${Date.now()}`;
    const entry = {
      id: contributionId,
      status: 'pending',          // pending | approved | rejected
      paperType,                  // question-paper | model-paper
      branch,
      semester: parseInt(semester),
      subject: subject || 'Unknown',
      year: year || new Date().getFullYear().toString(),
      contributorName: contributorName || 'Anonymous',
      contributorEmail: contributorEmail || '',
      filename: req.file.originalname,
      originalName: req.file.originalname,
      size: req.file.size,
      // Cloudinary fields
      cloudinaryUrl:      req.file.path,          // full download URL
      cloudinaryPublicId: req.file.filename,       // public_id for management
      uploadedAt: new Date().toISOString()
    };

    // Append to contributions.json
    let contributions = [];
    try {
      const raw = fs.readFileSync(CONTRIBUTIONS_JSON, 'utf-8');
      contributions = JSON.parse(raw);
    } catch (_) { /* start fresh if unreadable */ }

    contributions.push(entry);
    fs.writeFileSync(CONTRIBUTIONS_JSON, JSON.stringify(contributions, null, 2));

    console.log(`📤 New contribution uploaded to Cloudinary: ${entry.originalName} from ${entry.contributorName}`);
    console.log(`   URL: ${entry.cloudinaryUrl}`);

    res.json({
      success: true,
      message: 'Thank you! Your paper has been submitted for review.',
      id: contributionId,
      url: entry.cloudinaryUrl
    });

  } catch (err) {
    console.error('❌ Contribution upload error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Upload failed, please try again.' });
  }
});

// GET /api/contributions – list all contributions (admin use)
app.get('/api/contributions', (req, res) => {
  try {
    const raw = fs.readFileSync(CONTRIBUTIONS_JSON, 'utf-8');
    const contributions = JSON.parse(raw);
    res.json({ success: true, total: contributions.length, contributions });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not read contributions.' });
  }
});

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ success: false, error: err.message });
  }
  next(err);
});

// ----- Chat History Setup -----
const HISTORY_JSON = path.join(__dirname, 'dataset', 'chat_history.json');

if (!fs.existsSync(HISTORY_JSON)) {
  fs.writeFileSync(HISTORY_JSON, JSON.stringify([], null, 2));
  console.log('📄 Created chat_history.json');
}

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_JSON, 'utf-8'));
  } catch { return []; }
}
function writeHistory(data) {
  fs.writeFileSync(HISTORY_JSON, JSON.stringify(data, null, 2));
}

// GET /api/history – list all chat sessions (summary only)
app.get('/api/history', (req, res) => {
  const sessions = readHistory();
  const summaries = sessions.map(s => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length,
  }));
  res.json({ success: true, sessions: summaries });
});

// GET /api/history/:id – get a full chat session
app.get('/api/history/:id', (req, res) => {
  const sessions = readHistory();
  const session = sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
  res.json({ success: true, session });
});

// POST /api/history – save / update a chat session
app.post('/api/history', (req, res) => {
  const { id, title, messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ success: false, error: 'messages array is required' });
  }

  const sessions = readHistory();
  const now = new Date().toISOString();

  if (id) {
    // Update existing session
    const idx = sessions.findIndex(s => s.id === id);
    if (idx !== -1) {
      sessions[idx].messages = messages;
      sessions[idx].title = title || sessions[idx].title;
      sessions[idx].updatedAt = now;
      writeHistory(sessions);
      return res.json({ success: true, session: sessions[idx] });
    }
  }

  // Create new session
  const session = {
    id: `chat_${Date.now()}`,
    title: title || (messages[0]?.content || 'New Chat').slice(0, 60),
    messages,
    createdAt: now,
    updatedAt: now,
  };
  sessions.unshift(session); // newest first
  writeHistory(sessions);
  res.json({ success: true, session });
});

// DELETE /api/history/:id – delete a chat session
app.delete('/api/history/:id', (req, res) => {
  let sessions = readHistory();
  const before = sessions.length;
  sessions = sessions.filter(s => s.id !== req.params.id);
  if (sessions.length === before) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  writeHistory(sessions);
  res.json({ success: true });
});

// Search files endpoint
app.post('/api/search-files', (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const matches = searchFiles(query);
    res.json({ files: matches });
  } catch (err) {
    console.error('❌ File search error:', err.message);
    res.status(500).json({ error: 'File search failed' });
  }
});

// Chat endpoint with file search integration
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Search for relevant files
    const relevantFiles = searchFiles(message);
    
    // Debug logging
    console.log(`📝 Message: "${message}"`);
    console.log(`🔍 Files found: ${relevantFiles.length}`);

    // Check FAQ first
    if (Array.isArray(faqs) && faqs.length > 0) {
      const found = faqs.find(
        f => (f.question || '').toString().trim().toLowerCase() === message.trim().toLowerCase()
      );
      if (found?.answer) {
        return res.json({
          response: found.answer,
          confidence: 95,
          model: 'Local Dataset',
          files: relevantFiles
        });
      }
    }

    // Build conversation
    let conversationText = SYSTEM_PROMPT + '\n\n';
    const recent = Array.isArray(history) ? history.slice(-4) : [];
    for (const msg of recent) {
      if (!msg || !msg.role || !msg.content) continue;
      if (msg.role === 'user') conversationText += `Human: ${msg.content}\n\n`;
      if (msg.role === 'assistant') conversationText += `Assistant: ${msg.content}\n\n`;
    }
    conversationText += `Human: ${message}\n\nAssistant: `;

    // Call Gemini API
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: conversationText }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Gemini API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    let aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';

    // Only append file information if files were actually found
    if (relevantFiles.length > 0) {
      aiText += `\n\n📚 I found ${relevantFiles.length} relevant document(s) for you. Check the download section below.`;
    }

    // Calculate confidence
    let confidence = 85;
    if (aiText.length > 200) confidence += 5;
    if (aiText.toLowerCase().includes('mitk')) confidence += 5;
    if (!/sorry|don\'t know|cannot/i.test(aiText)) confidence += 3;
    confidence = Math.min(confidence, 95);

    return res.json({
      response: aiText,
      confidence,
      model: 'Google Gemini 2.5 Flash',
      files: relevantFiles // Only send files if they exist
    });

  } catch (err) {
    console.error('❌ Chat error:', err.message);
    return res.status(500).json({
      error: 'AI service error',
      details: err.message
    });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 MITK AI Server running at http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
  console.log(`✅ Using Gemini 2.5 Flash (v1 API)`);
  console.log(`📁 Files available: ${fileDatabase.length}`);
});