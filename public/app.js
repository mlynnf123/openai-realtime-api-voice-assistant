// Global variables
let activeConversationId = null;
let socket = null;
const clientId = 'dashboard_' + Date.now();
const apiBaseUrl = window.location.origin; // Use the same origin as the page

// DOM elements
const conversationList = document.getElementById('conversation-list');
const chatContainer = document.getElementById('chat-container');
const emptyState = document.getElementById('empty-state');
const chatMessages = document.getElementById('chat-messages');
const chatTitle = document.getElementById('chat-title');
const chatSubtitle = document.getElementById('chat-subtitle');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
    loadConversations();
    setupEventListeners();
});

// Initialize WebSocket connection
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?clientId=${clientId}`;
    
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log('WebSocket connection established');
    };
    
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    socket.onclose = () => {
        console.log('WebSocket connection closed');
        // Attempt to reconnect after a delay
        setTimeout(initWebSocket, 3000);
    };
    
    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(data) {
    console.log('Received WebSocket message:', data);
    
    switch (data.type) {
        case 'new_message':
            handleNewMessage(data);
            break;
        case 'new_conversation':
            handleNewConversation(data);
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

// Handle new message from WebSocket
function handleNewMessage(data) {
    // Update conversation list to show the latest message
    updateConversationInList(data.conversation_id, data.message);
    
    // If this is the active conversation, add the message to the chat
    if (data.conversation_id === activeConversationId) {
        addMessageToChat(data.message);
        scrollToBottom();
    }
}

// Handle new conversation from WebSocket
function handleNewConversation(data) {
    // Add the new conversation to the list
    addConversationToList(data.conversation);
}

// Update a conversation in the list with a new message
function updateConversationInList(conversationId, message) {
    const conversationItem = document.querySelector(`.conversation-item[data-id="${conversationId}"]`);
    
    if (conversationItem) {
        // Update the last message preview
        const preview = conversationItem.querySelector('.message-preview');
        if (preview) {
            preview.textContent = message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '');
        }
        
        // Update the timestamp
        const timestamp = conversationItem.querySelector('.timestamp');
        if (timestamp) {
            timestamp.textContent = formatDate(new Date(message.created_at));
        }
        
        // Move the conversation to the top of the list
        const parent = conversationItem.parentNode;
        parent.insertBefore(conversationItem, parent.firstChild);
    } else {
        // If the conversation doesn't exist in the list, reload the conversations
        loadConversations();
    }
}

// Load all conversations from the API
async function loadConversations() {
    try {
        const response = await fetch(`${apiBaseUrl}/api/conversations`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const conversations = await response.json();
        displayConversations(conversations);
    } catch (error) {
        console.error('Error loading conversations:', error);
        conversationList.innerHTML = '<div class="loading">Error loading conversations. Please try again.</div>';
    }
}

// Display conversations in the sidebar
function displayConversations(conversations) {
    if (conversations.length === 0) {
        conversationList.innerHTML = '<div class="loading">No conversations yet</div>';
        return;
    }
    
    conversationList.innerHTML = '';
    
    conversations.forEach(conversation => {
        addConversationToList(conversation);
    });
}

// Add a single conversation to the list
function addConversationToList(conversation) {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    item.dataset.id = conversation.id;
    
    const name = conversation.name || 'Unknown';
    const phoneNumber = conversation.phone_number;
    const updatedAt = new Date(conversation.updated_at);
    
    // Get the last message if available
    let lastMessage = 'No messages yet';
    if (conversation.messages && conversation.messages.length > 0) {
        const lastMsg = conversation.messages[conversation.messages.length - 1];
        lastMessage = lastMsg.content.substring(0, 50) + (lastMsg.content.length > 50 ? '...' : '');
    }
    
    item.innerHTML = `
        <h5>${name}</h5>
        <p>${phoneNumber}</p>
        <p class="message-preview">${lastMessage}</p>
        <div class="timestamp">${formatDate(updatedAt)}</div>
    `;
    
    item.addEventListener('click', () => {
        loadConversation(conversation.id);
    });
    
    // Add to the beginning of the list
    conversationList.insertBefore(item, conversationList.firstChild);
}

// Load a specific conversation
async function loadConversation(conversationId) {
    try {
        const response = await fetch(`${apiBaseUrl}/api/conversations/${conversationId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const conversation = await response.json();
        displayConversation(conversation);
    } catch (error) {
        console.error('Error loading conversation:', error);
    }
}

// Display a conversation in the main chat area
function displayConversation(conversation) {
    // Update active conversation
    activeConversationId = conversation.id;
    
    // Update UI
    emptyState.classList.add('d-none');
    chatContainer.classList.remove('d-none');
    
    // Update conversation info
    chatTitle.textContent = conversation.name || 'Unknown';
    chatSubtitle.textContent = conversation.phone_number;
    
    // Update active conversation in sidebar
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const activeItem = document.querySelector(`.conversation-item[data-id="${conversation.id}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }
    
    // Display messages
    displayMessages(conversation.messages || []);
}

// Display messages in the chat area
function displayMessages(messages) {
    chatMessages.innerHTML = '';
    
    messages.forEach(message => {
        addMessageToChat(message);
    });
    
    scrollToBottom();
}

// Add a single message to the chat
function addMessageToChat(message) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${message.sender} clearfix`;
    
    let content = message.content;
    
    // If it's a system message and looks like JSON, try to format it
    if (message.sender === 'system' && (content.startsWith('{') || content.startsWith('['))) {
        try {
            const jsonObj = JSON.parse(content);
            content = JSON.stringify(jsonObj, null, 2);
        } catch (e) {
            // Not valid JSON, keep as is
        }
    }
    
    const timestamp = new Date(message.created_at);
    
    messageElement.innerHTML = `
        <div class="content">${content}</div>
        <div class="timestamp">${formatTime(timestamp)}</div>
    `;
    
    chatMessages.appendChild(messageElement);
}

// Scroll the chat to the bottom
function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Set up event listeners
function setupEventListeners() {
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
    });
}

// Send a message
async function sendMessage() {
    const content = messageInput.value.trim();
    
    if (!content || !activeConversationId) {
        return;
    }
    
    try {
        // Clear input
        messageInput.value = '';
        
        // Add message to UI immediately for better UX
        const tempMessage = {
            sender: 'user',
            content: content,
            created_at: new Date().toISOString()
        };
        
        addMessageToChat(tempMessage);
        scrollToBottom();
        
        // Send message to server
        const response = await fetch(`${apiBaseUrl}/api/conversations/${activeConversationId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Server will send the message back via WebSocket
    } catch (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message. Please try again.');
    }
}

// Format date for display
function formatDate(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date >= today) {
        return formatTime(date);
    } else if (date >= yesterday) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString();
    }
}

// Format time for display
function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
