// MITK Knowledge Base 
const mitkData = {
    institutional: {
        name: "Moodlakatte Institute of Technology, Kundapura (MITK)",
        established: "2004",
        affiliation: "Visvesvaraya Technological University (VTU), Belagavi",
        contact: {
            phone: "+91-8254-237630",
            email: "info@mitkundapura.com",
            website: "https://www.mitkundapura.com"
        }
    }
};

// Backend Configuration
const BACKEND_CONFIG = {
    BASE_URL: 'http://localhost:3000',
    ENDPOINTS: {
        CHAT: '/api/chat',
        HEALTH: '/api/health',
        SEARCH_FILES: '/api/search-files'
    },
    TIMEOUT: 15000,
    ENABLED: true
};

// Translations
const translations = {
    en: { label: 'English', placeholder: 'Message AI Chat...', thinking: 'AI is thinking...', ready: '🟢 AI Ready', offline: '📚 Local Mode' },
    kn: { label: 'ಕನ್ನಡ', placeholder: 'ಸಂದೇಶ ಕಳುಹಿಸಿ...', thinking: 'AI ಯೋಚಿಸುತ್ತಿದೆ...', ready: '🟢 AI ಸಿದ್ಧ', offline: '📚 ಸ್ಥಳೀಯ ಮೋಡ್' },
};

// State management
let currentLanguage = 'en';
let conversationHistory = [];
let isProcessing = false;
let backendAvailable = false;
let isChatActive = false; // Tracks if we are in initial view or chat view
let currentSessionId = null; // tracks the active history session id

// DOM elements
let chatMessages, messageInput, chatMessageInput, sendBtn, chatSendBtn, typingIndicator, confidenceModal, statusText;
let initialView, chatView, menuToggle, sidebar, themeToggle;

// Initialize application
document.addEventListener('DOMContentLoaded', init);

function init() {
    console.log('🚀 Initializing MITK AI Assistant for Dark Theme UI...');
    
    // Layout Elements
    initialView = document.getElementById('initialView');
    chatView = document.getElementById('chatView');
    sidebar = document.querySelector('.sidebar');
    menuToggle = document.querySelector('.menu-toggle');
    themeToggle = document.getElementById('themeToggle');
    
    // Theme initialization
    const savedTheme = localStorage.getItem('mitkTheme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        if (themeToggle) themeToggle.innerHTML = '🌙 Dark Mode';
    }
    
    // Chat Elements
    chatMessages = document.getElementById('chatMessages');
    messageInput = document.getElementById('messageInput');           // Big input 
    chatMessageInput = document.getElementById('chatMessageInput');   // Bottom input in chat mode
    sendBtn = document.getElementById('sendBtn');
    chatSendBtn = document.getElementById('chatSendBtn');
    
    typingIndicator = document.getElementById('typingIndicator');
    confidenceModal = document.getElementById('confidenceModal');
    statusText = document.getElementById('statusText');
    const newChatFab = document.getElementById('newChatFab');

    if (!chatMessages || !messageInput) {
        console.error('❌ Required DOM elements not found');
        return;
    }

    setupEventListeners();
    checkBackendHealth();
    updateGreeting();
    loadChatHistory(); // Load sidebar history from backend
    
    // Listen to sidebar new chat
    if (newChatFab) newChatFab.addEventListener('click', () => resetConversation(true));
    
    // Initialize contribution modal
    initContributeModal();
    
    console.log('✅ MITK AI Assistant initialized successfully');
}

function updateGreeting() {
    const greetEl = document.getElementById('greetingText');
    if (!greetEl) return;
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) greetEl.textContent = 'Good Morning, Student.';
    else if (hour >= 12 && hour < 17) greetEl.textContent = 'Good Afternoon, Student.';
    else if (hour >= 17 && hour < 21) greetEl.textContent = 'Good Evening, Student.';
    else greetEl.textContent = 'Good Night, Student.';
}

async function checkBackendHealth() {
    console.log('🔍 Checking backend connection...');
    updateStatusText('Connecting...');

    if (!BACKEND_CONFIG.ENABLED) {
        backendAvailable = false;
        updateStatusText('🟡 Local Mode');
        return;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${BACKEND_CONFIG.BASE_URL}${BACKEND_CONFIG.ENDPOINTS.HEALTH}`, {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            backendAvailable = true;
            console.log('✅ Backend connected:', data.message);
            updateStatusText(`🟢 AI Ready (${data.filesAvailable || 0} files)`);
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.log('❌ Backend connection failed:', error.message);
        backendAvailable = false;
        updateStatusText('🔴 AI Offline');
    }
}

function setupEventListeners() {
    // Initial view input
    if (sendBtn) sendBtn.addEventListener('click', () => handleSendMessage(messageInput));
    if (messageInput) {
        messageInput.addEventListener('keydown', (e) => handleKeyDown(e, messageInput));
        messageInput.addEventListener('input', () => autoResizeTextarea(messageInput));
    }
    
    // Chat view input
    if (chatSendBtn) chatSendBtn.addEventListener('click', () => handleSendMessage(chatMessageInput));
    if (chatMessageInput) {
        chatMessageInput.addEventListener('keydown', (e) => handleKeyDown(e, chatMessageInput));
        chatMessageInput.addEventListener('input', () => autoResizeTextarea(chatMessageInput));
    }

    // Sidebar search filter
    const searchInput = document.querySelector('.search-bar input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase();
            document.querySelectorAll('.sidebar .sidebar-history .history-item').forEach(el => {
                const title = el.querySelector('.history-item-title')?.textContent?.toLowerCase() || '';
                el.style.display = title.includes(query) ? '' : 'none';
            });
        });
    }

    // Modal buttons (History)
    const historyNavBtn = document.getElementById('historyNavBtn');
    const historyModal = document.getElementById('historyModal');
    const historyCloseBtn = document.getElementById('historyCloseBtn');
    const historyBackdrop = document.getElementById('historyBackdrop');
    
    if (historyNavBtn && historyModal) {
        historyNavBtn.addEventListener('click', (e) => {
            e.preventDefault();
            historyModal.classList.remove('hidden');
        });
    }
    const closeHistoryModal = () => {
        if (historyModal) historyModal.classList.add('hidden');
    }
    if (historyCloseBtn) historyCloseBtn.addEventListener('click', closeHistoryModal);
    if (historyBackdrop) historyBackdrop.addEventListener('click', closeHistoryModal);

    // History Modal Search
    const historyModalSearchInput = document.getElementById('historyModalSearchInput');
    if (historyModalSearchInput && historyModal) {
        historyModalSearchInput.addEventListener('input', () => {
            const query = historyModalSearchInput.value.toLowerCase();
            historyModal.querySelectorAll('.history-item').forEach(el => {
                const title = el.querySelector('.history-item-title')?.textContent?.toLowerCase() || '';
                el.style.display = title.includes(query) ? '' : 'none';
            });
        });
    }

    // Modals & Menu
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('confidence-badge')) {
            const confidence = e.target.dataset.confidence;
            const sources = e.target.dataset.sources;
            showConfidenceModal(confidence, sources);
        }
    });

    const modalClose = document.querySelector('.modal-close');
    const modalBackdrop = document.querySelector('.modal-backdrop');
    if (modalClose) modalClose.addEventListener('click', closeModal);
    if (modalBackdrop) modalBackdrop.addEventListener('click', closeModal);
    
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }
    
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isLight = document.body.classList.toggle('light-theme');
            localStorage.setItem('mitkTheme', isLight ? 'light' : 'dark');
            themeToggle.innerHTML = isLight ? '🌙 Dark Mode' : '☀️ Light Mode';
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    const langToggle = document.getElementById('languageToggle');
    if (langToggle) {
        langToggle.addEventListener('click', () => {
            currentLanguage = currentLanguage === 'en' ? 'kn' : 'en';
            const t = translations[currentLanguage];
            langToggle.textContent = t.label;
            if (messageInput) messageInput.placeholder = t.placeholder;
            if (chatMessageInput) chatMessageInput.placeholder = t.placeholder;
        });
    }
}

// Global function referenced from HTML onclick
function sendSuggestion(text) {
    if (!messageInput || isProcessing) return;
    messageInput.value = text;
    autoResizeTextarea(messageInput);
    handleSendMessage(messageInput);
}

function handleSendMessage(inputRef) {
    if (!inputRef) return;
    const message = inputRef.value.trim();
    if (!message || isProcessing) return;
    
    // Switch UI from initial to active chat if first message
    if (!isChatActive) {
        isChatActive = true;
        initialView.classList.add('hidden');
        chatView.classList.remove('hidden');
        // Initial bot greeting is already assumed via UI redesign context, so we just proceed
    }
    
    handleUserMessage(message, inputRef);
}

async function handleUserMessage(message, inputRef) {
    if (isProcessing) return;

    isProcessing = true;
    updateSendButtonState(true);
    addUserMessage(message);

    if (inputRef) {
        inputRef.value = '';
        autoResizeTextarea(inputRef);
    }
    
    // Sync the other input so it's empty too
    if (messageInput) messageInput.value = '';
    if (chatMessageInput) chatMessageInput.value = '';

    conversationHistory.push({
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
    });

    showTypingIndicator();
    updateStatusText('AI is thinking...');

    try {
        let response;
        if (backendAvailable && BACKEND_CONFIG.ENABLED) {
            try {
                response = await getBackendResponse(message);
            } catch (error) {
                console.log('❌ AI backend failed:', error.message);
                backendAvailable = false;
                updateStatusText('🔴 AI Failed - Using Local');
                response = getFallbackResponse(message);
            }
        } else {
            response = getFallbackResponse(message);
        }

        hideTypingIndicator();

        conversationHistory.push({
            role: 'assistant',
            content: response.text,
            timestamp: new Date().toISOString()
        });

        addBotMessage(response.text, 'ai_response', response.confidence, response.sources);

        if (response.files && response.files.length > 0) {
            displayFileResults(response.files);
        }

    } catch (error) {
        hideTypingIndicator();
        console.error('💥 Response Error:', error);
        const fallbackResponse = getFallbackResponse(message);
        addBotMessage(fallbackResponse.text, 'error', fallbackResponse.confidence, fallbackResponse.sources);
    } finally {
        isProcessing = false;
        updateSendButtonState(false);
        updateStatusText(backendAvailable ? '🟢 AI Ready' : '📚 Local Mode');
        
        // Ensure focus goes back to the chat input
        if (chatMessageInput && isChatActive) {
            chatMessageInput.focus();
        }
    }
}

async function getBackendResponse(userMessage) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BACKEND_CONFIG.TIMEOUT);

    try {
        const response = await fetch(`${BACKEND_CONFIG.BASE_URL}${BACKEND_CONFIG.ENDPOINTS.CHAT}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: userMessage,
                history: conversationHistory.slice(-6),
                language: currentLanguage
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Backend error ${response.status}`);
        }

        const data = await response.json();

        return {
            text: formatAIResponse(data.response),
            confidence: data.confidence || 90,
            sources: ['MITK AI Assistant', `${data.model || 'Gemini AI'}`],
            files: data.files || [],
            model: data.model
        };

    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

function getFallbackResponse(message) {
    return {
        text: `<p>I'm currently in offline mode, but I can help you with basic queries. Please ensure the backend is running to search for files or access Gemini AI.</p>`,
        confidence: 75,
        sources: ['Local Knowledge Base'],
        files: []
    };
}

function displayFileResults(files) {
    if (!files || files.length === 0) return;

    const filesHTML = `
        <div class="file-results">
            <h4>📂 Available Downloads (${files.length})</h4>
            ${files.map(file => `
                <div class="file-card">
                    <div class="file-info">
                        <div class="file-title">📄 ${file.title}</div>
                        <div class="file-meta">
                            <span class="file-badge">${file.branch}</span>
                            <span class="file-badge">Sem ${file.semester}</span>
                            <span class="file-badge">${file.type.replace(/-/g, ' ')}</span>
                            <span class="file-size">${file.size}</span>
                        </div>
                    </div>
                    <a href="${file.url}" 
                       download="${file.filename}" 
                       class="download-btn" 
                       title="Download ${file.filename}">
                        Download
                    </a>
                </div>
            `).join('')}
        </div>
    `;

    addBotMessage(filesHTML, 'files', 95, ['MITK File Database']);
}

function formatAIResponse(response) {
    if (!response) return 'Sorry, I could not generate a response.';
    
    let formatted = response
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/### (.*)/g, '<h3>$1</h3>')
        .replace(/## (.*)/g, '<h2>$1</h2>')
        .replace(/# (.*)/g, '<h1>$1</h1>');
    
    formatted = formatted.replace(/^\* (.+)$/gm, '<li>$1</li>');
    formatted = formatted.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    formatted = formatted.replace(/\n\n/g, '</p><p>');
    if (!formatted.startsWith('<h') && !formatted.startsWith('<p>')) {
        formatted = '<p>' + formatted;
    }
    if (!formatted.endsWith('</p>') && !formatted.endsWith('>')) {
        formatted = formatted + '</p>';
    }
    
    return formatted;
}

function addUserMessage(message) {
    const messageElement = createMessageElement(message, 'user');
    chatMessages.appendChild(messageElement);
    scrollToBottom();
}

function addBotMessage(message, type = 'bot', confidence = 85, sources = ['MITK AI']) {
    const messageElement = createMessageElement(message, 'bot', confidence, sources, type);
    chatMessages.appendChild(messageElement);
    scrollToBottom();
}

function createMessageElement(content, sender, confidence, sources, type = 'bot') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    
    const avatar = document.createElement('div');
    avatar.className = `avatar ${sender}-avatar`;
    avatar.textContent = sender === 'user' ? 'U' : '🤖';
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = content;
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(bubble);
    
    if (sender === 'bot' && confidence && sources && type !== 'files') {
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        
        const confidenceBadge = document.createElement('span');
        confidenceBadge.className = 'confidence-badge';
        confidenceBadge.textContent = `${confidence}% confident`;
        confidenceBadge.dataset.confidence = confidence;
        confidenceBadge.dataset.sources = JSON.stringify(sources);
        
        meta.appendChild(confidenceBadge);
        bubble.appendChild(meta);
    }
    
    return messageDiv;
}

function showTypingIndicator() {
    if (typingIndicator) {
        typingIndicator.classList.remove('hidden');
        scrollToBottom();
    }
}

function hideTypingIndicator() {
    if (typingIndicator) {
        typingIndicator.classList.add('hidden');
    }
}

function updateSendButtonState(isLoading) {
    if (isLoading) {
        if (sendBtn) { sendBtn.innerHTML = '⏳'; sendBtn.disabled = true; }
        if (chatSendBtn) { chatSendBtn.innerHTML = '⏳'; chatSendBtn.disabled = true; }
    } else {
        if (sendBtn) { sendBtn.innerHTML = '▶'; sendBtn.disabled = false; }
        if (chatSendBtn) { chatSendBtn.innerHTML = '▶'; chatSendBtn.disabled = false; }
    }
}

function updateStatusText(text) {
    if (statusText) {
        statusText.textContent = text;
    }
}

function handleKeyDown(e, inputRef) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage(inputRef);
    }
}

function autoResizeTextarea(inputRef) {
    if (!inputRef) return;
    inputRef.style.height = 'auto';
    const newHeight = Math.min(inputRef.scrollHeight, 120);
    inputRef.style.height = newHeight + 'px';
}

function scrollToBottom() {
    if (chatMessages) {
        // Slight timeout to let DOM render
        setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 10);
    }
}

async function resetConversation(forceShowMessage = false) {
    // Save current chat to history before resetting (if it has messages)
    if (conversationHistory.length > 0) {
        await saveCurrentChat();
    }
    
    conversationHistory = [];
    isChatActive = false;
    currentSessionId = null;
    
    if (chatMessages) {
        chatMessages.innerHTML = '';
    }
    
    // Switch UI back to initial state
    if (chatView) chatView.classList.add('hidden');
    if (initialView) initialView.classList.remove('hidden');
    
    if (messageInput) {
        messageInput.value = '';
        messageInput.focus();
    }
    
    // Refresh sidebar history
    loadChatHistory();
    
    console.log('🔄 Conversation reset');
}

function showConfidenceModal(confidence, sources) {
    if (!confidenceModal) return;
    
    const sourcesArray = typeof sources === 'string' ? JSON.parse(sources) : sources;
    const modalBody = confidenceModal.querySelector('.modal-body');
    if (modalBody) {
        modalBody.innerHTML = `
            <div style="margin-bottom: 20px;">
                <h2 style="font-size: 32px; font-weight: bold; color: var(--text-primary);">${confidence}%</h2>
            </div>
            <div class="sources">
                <h4 style="margin-bottom: 8px; color: var(--text-secondary);">Information Sources:</h4>
                <ul style="margin-left: 20px; color: var(--text-primary);">
                    ${sourcesArray.map(source => `<li>${source}</li>`).join('')}
                </ul>
            </div>
        `;
    }
    
    confidenceModal.classList.remove('hidden');
}

function closeModal() {
    if (confidenceModal) {
        confidenceModal.classList.add('hidden');
    }
}

// ============================================================
//  CONTRIBUTION MODAL
// ============================================================

let contributeModal, contributeForm, contributeDropzone, fileInput;
let dropzoneIdle, dropzonePreview, previewName, removeFileBtn;
let contributeSuccess, contributeError, contributeSubmitBtn;
let contributeSubmitLabel, contributeSpinner;
let selectedFile = null;

function initContributeModal() {
    contributeModal      = document.getElementById('contributeModal');
    contributeForm       = document.getElementById('contributeForm');
    contributeDropzone   = document.getElementById('contributeDropzone');
    fileInput            = document.getElementById('fileInput');
    dropzoneIdle         = document.getElementById('dropzoneIdle');
    dropzonePreview      = document.getElementById('dropzonePreview');
    previewName          = document.getElementById('previewName');
    removeFileBtn        = document.getElementById('removeFileBtn');
    contributeSuccess    = document.getElementById('contributeSuccess');
    contributeError      = document.getElementById('contributeError');
    contributeSubmitBtn  = document.getElementById('contributeSubmitBtn');
    contributeSubmitLabel = document.getElementById('contributeSubmitLabel');
    contributeSpinner    = document.getElementById('contributeSpinner');

    const navBtn         = document.getElementById('contributeNavBtn');
    const closeBtn       = document.getElementById('contributeCloseBtn');
    const backdrop       = document.getElementById('contributeBackdrop');
    const anotherBtn     = document.getElementById('contributeAnotherBtn');

    if (navBtn)    navBtn.addEventListener('click', (e) => { e.preventDefault(); openContributeModal(); });
    if (closeBtn)  closeBtn.addEventListener('click', closeContributeModal);
    if (backdrop)  backdrop.addEventListener('click', closeContributeModal);
    if (anotherBtn) anotherBtn.addEventListener('click', resetContributeForm);

    // Form submit
    if (contributeForm) contributeForm.addEventListener('submit', handleContributeSubmit);

    // File input change
    if (fileInput) fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
    });

    // Remove file
    if (removeFileBtn) removeFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearSelectedFile();
    });

    // Drag and drop
    if (contributeDropzone) {
        contributeDropzone.addEventListener('click', (e) => {
            // Avoid triggering if remove button was clicked
            if (e.target === removeFileBtn || removeFileBtn?.contains(e.target)) return;
            if (!selectedFile) fileInput?.click();
        });

        contributeDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            contributeDropzone.classList.add('drag-over');
        });
        contributeDropzone.addEventListener('dragleave', () => {
            contributeDropzone.classList.remove('drag-over');
        });
        contributeDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            contributeDropzone.classList.remove('drag-over');
            const file = e.dataTransfer?.files?.[0];
            if (file) {
                if (file.type !== 'application/pdf') {
                    showContributeError('Only PDF files are allowed.');
                    return;
                }
                setSelectedFile(file);
            }
        });
    }

    // ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && contributeModal && !contributeModal.classList.contains('hidden')) {
            closeContributeModal();
        }
    });
}

function openContributeModal() {
    if (!contributeModal) return;
    resetContributeForm();
    contributeModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeContributeModal() {
    if (!contributeModal) return;
    contributeModal.classList.add('hidden');
    document.body.style.overflow = '';
}

function setSelectedFile(file) {
    selectedFile = file;
    if (previewName) previewName.textContent = file.name;
    dropzoneIdle?.classList.add('hidden');
    dropzonePreview?.classList.remove('hidden');
    hideContributeError();
}

function clearSelectedFile() {
    selectedFile = null;
    if (fileInput) fileInput.value = '';
    dropzonePreview?.classList.add('hidden');
    dropzoneIdle?.classList.remove('hidden');
}

function showContributeError(msg) {
    if (contributeError) {
        contributeError.textContent = msg;
        contributeError.classList.remove('hidden');
    }
}
function hideContributeError() {
    if (contributeError) contributeError.classList.add('hidden');
}

function setContributeLoading(loading) {
    if (!contributeSubmitBtn) return;
    contributeSubmitBtn.disabled = loading;
    contributeSubmitLabel && (contributeSubmitLabel.textContent = loading ? 'Uploading...' : 'Submit Contribution');
    contributeSpinner?.classList.toggle('hidden', !loading);
}

async function handleContributeSubmit(e) {
    e.preventDefault();
    hideContributeError();

    if (!selectedFile) {
        showContributeError('Please select a PDF file to upload.');
        return;
    }

    const branch = document.getElementById('contrib-branch')?.value;
    const semester = document.getElementById('contrib-semester')?.value;
    if (!branch) { showContributeError('Please select a branch.'); return; }
    if (!semester) { showContributeError('Please select a semester.'); return; }

    const formData = new FormData(contributeForm);
    // Override the file field explicitly to ensure the dropped file is used
    formData.set('file', selectedFile, selectedFile.name);

    setContributeLoading(true);
    try {
        const resp = await fetch('/api/contribute', {
            method: 'POST',
            body: formData
        });
        const data = await resp.json();

        if (data.success) {
            // Show success state
            contributeForm.classList.add('hidden');
            contributeSuccess?.classList.remove('hidden');
            showToast('Paper submitted successfully! 🎉');
        } else {
            showContributeError(data.error || 'Submission failed. Please try again.');
        }
    } catch (err) {
        console.error('❌ Contribution error:', err);
        showContributeError('Network error. Please check your connection and try again.');
    } finally {
        setContributeLoading(false);
    }
}

function resetContributeForm() {
    if (contributeForm) {
        contributeForm.reset();
        contributeForm.classList.remove('hidden');
    }
    contributeSuccess?.classList.add('hidden');
    contributeError?.classList.add('hidden');
    clearSelectedFile();
    setContributeLoading(false);
}

// ---- Toast ----
let toastTimer = null;
function showToast(msg) {
    const toast = document.getElementById('toastNotification');
    const toastMsg = document.getElementById('toastMsg');
    if (!toast) return;
    if (toastMsg) toastMsg.textContent = msg;
    toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 4000);
}

// ============================================================
//  CHAT HISTORY (sidebar)
// ============================================================

async function loadChatHistory() {
    const historyContainers = document.querySelectorAll('.sidebar-history');
    if (!historyContainers.length) return;

    try {
        const resp = await fetch(`${BACKEND_CONFIG.BASE_URL}/api/history`);
        const data = await resp.json();
        if (!data.success) throw new Error('Failed');

        const sessions = data.sessions || [];
        historyContainers.forEach(container => renderHistorySidebar(sessions, container));
    } catch (err) {
        console.warn('Could not load chat history:', err.message);
        historyContainers.forEach(container => {
            container.innerHTML = '<div class="history-section"><h4>History</h4><p class="history-empty">Unable to load</p></div>';
        });
    }
}

function renderHistorySidebar(sessions, container) {
    if (!sessions.length) {
        container.innerHTML = `
            <div class="history-section">
                <h4>Recent Chats</h4>
                <p class="history-empty">No conversations yet</p>
            </div>`;
        return;
    }

    // Group by Today vs Earlier
    const today = new Date().toDateString();
    const todaySessions = [];
    const earlierSessions = [];

    sessions.forEach(s => {
        const d = new Date(s.createdAt);
        if (d.toDateString() === today) todaySessions.push(s);
        else earlierSessions.push(s);
    });

    let html = '';

    if (todaySessions.length) {
        html += '<div class="history-section"><h4>Today</h4>';
        todaySessions.forEach(s => { html += historyItemHTML(s); });
        html += '</div>';
    }

    if (earlierSessions.length) {
        html += '<div class="history-section"><h4>Previous 7 Days</h4>';
        earlierSessions.slice(0, 20).forEach(s => { html += historyItemHTML(s); });
        html += '</div>';
    }

    container.innerHTML = html;

    // Attach click handlers
    container.querySelectorAll('.history-item[data-id]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            loadSession(el.dataset.id);
        });
    });

    // Attach delete handlers
    container.querySelectorAll('.history-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await deleteSession(btn.dataset.id);
        });
    });
}

function historyItemHTML(session) {
    const title = escapeHTML(session.title || 'New Chat');
    return `
        <a href="#" class="history-item text-truncate" data-id="${session.id}">
            <span class="history-item-title">${title}</span>
            <button class="history-delete" data-id="${session.id}" title="Delete">&times;</button>
        </a>`;
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function loadSession(sessionId) {
    try {
        const resp = await fetch(`${BACKEND_CONFIG.BASE_URL}/api/history/${sessionId}`);
        const data = await resp.json();
        if (!data.success) throw new Error('Session not found');

        const session = data.session;

        // Save current chat first if it has unsaved messages
        if (conversationHistory.length > 0 && currentSessionId !== sessionId) {
            await saveCurrentChat();
        }

        // Restore session
        currentSessionId = session.id;
        conversationHistory = session.messages.map(m => ({ ...m }));
        isChatActive = true;

        // Switch UI
        initialView.classList.add('hidden');
        chatView.classList.remove('hidden');
        chatMessages.innerHTML = '';

        // Render all messages
        session.messages.forEach(msg => {
            if (msg.role === 'user') {
                addUserMessage(msg.content);
            } else {
                addBotMessage(msg.content, 'ai_response', msg.confidence || 85, msg.sources || ['MITK AI']);
                if (msg.files && msg.files.length > 0) {
                    displayFileResults(msg.files);
                }
            }
        });

        scrollToBottom();
        // Close sidebar on mobile
        sidebar?.classList.remove('open');
    } catch (err) {
        console.error('Failed to load session:', err);
        showToast('Could not load chat session');
    }
}

async function saveCurrentChat() {
    if (conversationHistory.length === 0) return;
    if (!BACKEND_CONFIG.ENABLED) return;

    try {
        const payload = {
            id: currentSessionId || undefined,
            messages: conversationHistory,
            title: conversationHistory[0]?.content?.slice(0, 60) || 'New Chat',
        };

        const resp = await fetch(`${BACKEND_CONFIG.BASE_URL}/api/history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (data.success && data.session) {
            currentSessionId = data.session.id;
        }
    } catch (err) {
        console.warn('Could not save chat:', err.message);
    }
}

async function deleteSession(sessionId) {
    try {
        await fetch(`${BACKEND_CONFIG.BASE_URL}/api/history/${sessionId}`, { method: 'DELETE' });
        // If deleting current session, reset
        if (currentSessionId === sessionId) {
            conversationHistory = [];
            currentSessionId = null;
            isChatActive = false;
            chatMessages.innerHTML = '';
            chatView.classList.add('hidden');
            initialView.classList.remove('hidden');
        }
        loadChatHistory();
        showToast('Chat deleted');
    } catch (err) {
        console.error('Delete failed:', err);
    }
}