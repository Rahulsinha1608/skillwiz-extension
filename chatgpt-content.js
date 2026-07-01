// ============================================================
//  ChatGPT Content Script
//  Receives questions and sends answers back
// ============================================================

console.log('[Skillwiz Autopilot] ChatGPT content script loaded');

// Store the processed message IDs to avoid duplicates
const processedMessageIds = new Set();
let lastCheckedTime = 0;

// Check if there's a pending question
function checkForQuestion() {
  const now = Date.now();
  // Debounce: don't check more than once per 500ms
  if (now - lastCheckedTime < 500) return;
  lastCheckedTime = now;

  chrome.storage.local.get(['pendingQuestion', 'waitingForAnswer'], async (result) => {
    if (result.pendingQuestion && result.waitingForAnswer) {
      console.log('[Skillwiz Autopilot] Found pending question:', result.pendingQuestion.slice(0, 60));

      // Register this tab as the ChatGPT tab for reuse
      try {
        const currentTab = await chrome.tabs.getCurrent();
        if (currentTab) {
          chrome.runtime.sendMessage({ 
            type: 'REGISTER_CHATGPT_TAB', 
            tabId: currentTab.id 
          });
        }
      } catch (e) {
        console.log('[Skillwiz Autopilot] Error getting current tab:', e);
      }

      await sendQuestionToChatGPT(result.pendingQuestion);
    }
  });
}

async function sendQuestionToChatGPT(question) {
  console.log('[Skillwiz Autopilot] Attempting to send question to ChatGPT');
  
  // Wait for ChatGPT to fully load - try multiple selectors
  let textarea = await waitForElement('textarea', 20000);
  
  if (!textarea) {
    // Try contenteditable fallback
    textarea = await waitForElement('[contenteditable="true"]', 10000);
  }

  if (!textarea) {
    console.log('[Skillwiz Autopilot] Textarea not found after waiting');
    return;
  }

  console.log('[Skillwiz Autopilot] Found textarea, injecting question');
  
  // Focus and clear first
  textarea.focus();
  textarea.click();
  
  // Clear any existing text
  if (textarea.tagName === 'TEXTAREA') {
    textarea.value = '';
  } else {
    textarea.innerText = '';
  }

  // Inject question with proper event dispatch
  if (textarea.tagName === 'TEXTAREA') {
    textarea.value = question;
  } else {
    // Contenteditable div
    textarea.innerText = question;
    textarea.textContent = question;
  }

  // Dispatch events to trigger React/Vue state updates
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  textarea.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));

  console.log('[Skillwiz Autopilot] Question injected, looking for send button...');

  // Wait a bit for UI to update
  await new Promise(r => setTimeout(r, 1000));

  // Look for send button with multiple strategies
  let sendButton = null;

  // Strategy 1: data-testid
  sendButton = document.querySelector('button[data-testid="send-button"]');
  
  // Strategy 2: aria-label containing "send"
  if (!sendButton) {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const btn of buttons) {
      if (btn.offsetParent === null) continue;
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.includes('send') && !btn.disabled) {
        sendButton = btn;
        console.log('[Skillwiz Autopilot] Found send button by aria-label');
        break;
      }
    }
  }

  // Strategy 3: SVG-based send button
  if (!sendButton) {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const btn of buttons) {
      if (btn.offsetParent === null) continue;
      const svg = btn.querySelector('svg');
      if (svg && !btn.disabled) {
        // This is likely a send button if it's near the textarea
        sendButton = btn;
        console.log('[Skillwiz Autopilot] Found send button by SVG');
        break;
      }
    }
  }

  if (sendButton && !sendButton.disabled) {
    sendButton.click();
    console.log('[Skillwiz Autopilot] Clicked send button');
    
    // Wait for answer
    await new Promise(r => setTimeout(r, 2000)); // Give ChatGPT time to respond
    await waitForAnswer();
  } else {
    console.log('[Skillwiz Autopilot] Send button not found or disabled, trying Enter key...');
    // Try pressing Enter as last resort
    textarea.focus();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, shiftKey: false }));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    
    await new Promise(r => setTimeout(r, 2000));
    await waitForAnswer();
  }
}

// Helper function to wait for an element to appear
async function waitForElement(selector, timeoutMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const el = document.querySelector(selector);
    if (el && el.offsetParent !== null) {
      return el;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  // Final attempt without visibility check
  return document.querySelector(selector);
}

// Parse answer from ChatGPT response - look for patterns like "1.", "Option 2", etc.
function parseAnswer(text) {
  if (!text) return null;

  // Normalize text
  const normalized = text.toLowerCase().trim();

  const patterns = [
    // "The answer is 3" or "Answer: 3" or "Option 3"
    /(?:answer|option)\s*(?:is|:)?\s*(\d+)/i,
    // Number followed by period or parenthesis at start: "3. " or "1)"
    /^(\d+)[\.\)\s]/m,
    // "Correct answer: 2"
    /(?:correct\s+)?answer\s*:?\s*(\d+)/i,
    // "Choose 2" or "Select option 3"
    /(?:choose|select|option)\s+(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      if (!isNaN(num) && num >= 1 && num <= 10) {
        return num;
      }
    }
  }
  return null;
}

async function waitForAnswer() {
  console.log('[Skillwiz Autopilot] Waiting for ChatGPT answer...');

  let attempts = 0;
  const maxAttempts = 120; // 2 minutes timeout

  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 1000));

    // Get ChatGPT response messages - try multiple selectors
    const messages = Array.from(document.querySelectorAll(
      '[data-message-id], div.group.w-full, article, [role="article"], div[data-testid*="message"]'
    )).filter(el => el.offsetParent !== null);

    if (messages.length === 0) {
      attempts++;
      continue;
    }

    // Process messages in reverse order (newest first)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgId = msg.getAttribute('data-message-id') || msg.getAttribute('id') || `msg-${i}`;

      // Skip if already processed
      if (processedMessageIds.has(msgId)) continue;

      const text = (msg.innerText || msg.textContent || '').trim();

      // Only process if it looks like an answer (not empty and substantial)
      if (text && text.length > 10 && !text.includes('Loading') && !text.includes('thinking')) {
        // Try to parse answer from this message
        const answerNum = parseAnswer(text);
        
        if (answerNum !== null) {
          processedMessageIds.add(msgId);
          console.log('[Skillwiz Autopilot] Got answer:', answerNum, 'from text:', text.slice(0, 150));

          // Store answer for Skillwiz to read
          chrome.storage.local.set({ chatGPTAnswer: String(answerNum) }, () => {
            console.log('[Skillwiz Autopilot] Answer stored:', answerNum);
          });

          return;
        } else {
          console.log('[Skillwiz Autopilot] Could not parse answer from:', text.slice(0, 100));
        }
      }
    }

    attempts++;
  }

  console.log('[Skillwiz Autopilot] Timeout waiting for answer after', maxAttempts, 'attempts');
}

// Check for question when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkForQuestion);
} else {
  checkForQuestion();
}

// Also check every 2 seconds
setInterval(checkForQuestion, 2000);
