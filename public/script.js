// === CONFIG ===
const API = '/api/chat';
const state = { conversation: [], loading: false };
const el = {
  messages: document.getElementById('chatMessages'),
  input: document.getElementById('messageInput'),
  send: document.getElementById('sendButton'),
  typing: document.getElementById('typingIndicator'),
  count: document.getElementById('charCount'),
};

// === INIT ===
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadHistory();
  el.input.focus();
});

// === EVENT BINDING ===
function bindEvents() {
  el.send.onclick = () => send();
  
  el.input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  
  el.input.oninput = (e) => {
    el.count.textContent = `${e.target.value.length}/2000`;
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };
  
  document.querySelectorAll('.quick-action-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const msg = btn.dataset.message || btn.innerText.trim();
      send(msg);
    };
  });
}

// === SEND MESSAGE ===
async function send(directText = null) {
  const text = directText ? directText.trim() : el.input.value.trim();
  if (!text || state.loading) return;
  
  // Clear input only for manual typing
  if (!directText) {
    el.input.value = '';
    el.input.style.height = 'auto';
    el.count.textContent = '0/2000';
  }
  
  // Add user message
  addMsg('user', text);
  state.conversation.push({ role: 'user', text });
  setLoading(true);
  
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation: state.conversation }),
    });
    
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error || data.debug || `HTTP ${res.status}`);
    
    // Add assistant response
    addMsg('assistant', data.result);
    state.conversation.push({ role: 'assistant', text: data.result });
    saveHistory();
    
  } catch (err) {
    console.error('Chat error:', err);
    addMsg('error', `⚠️ ${err.message}`);
  } finally {
    setLoading(false);
  }
}

// === UI HELPERS ===
function addMsg(role, text) {
  // Remove welcome on first user message
  const welcome = document.querySelector('.welcome-message');
  if (welcome && role === 'user') welcome.remove();
  
  const div = document.createElement('div');
  div.className = `message ${role}`;
  
  const content = document.createElement('div');
  content.className = 'message-content';
  
  if (role === 'assistant') {
    // Format: bold, code, line breaks
    content.innerHTML = escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  } else {
    content.textContent = text;
  }
  
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  
  div.appendChild(content);
  div.appendChild(time);
  el.messages.appendChild(div);
  scrollToBottom();
}

function setLoading(loading) {
  state.loading = loading;
  el.typing.style.display = loading ? 'flex' : 'none';
  el.send.disabled = loading;
  el.input.disabled = loading;
  if (!loading) el.input.focus();
  scrollToBottom();
}

function scrollToBottom() {
  el.messages.scrollTop = el.messages.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// === LOCAL STORAGE ===
function saveHistory() {
  try {
    localStorage.setItem('cloud_chat', JSON.stringify({
      conversation: state.conversation,
      ts: Date.now(),
    }));
  } catch (e) { console.warn('Save failed', e); }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem('cloud_chat');
    if (!raw) return;
    
    const { conversation, ts } = JSON.parse(raw);
    
    // Load if < 24h old
    if (Array.isArray(conversation) && conversation.length && Date.now() - ts < 86400000) {
      document.querySelector('.welcome-message')?.remove();
      state.conversation = conversation;
      conversation.forEach(m => addMsg(m.role, m.text));
    }
  } catch (e) { console.warn('Load failed', e); }
}