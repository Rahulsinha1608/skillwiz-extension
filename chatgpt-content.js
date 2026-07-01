// ============================================================
//  ChatGPT Content Script
//  Receives questions and sends answers back
// ============================================================

console.log('[Skillwiz Autopilot] ChatGPT content script loaded');

// Store the processed message IDs to avoid duplicates
const processedMessageIds = new Set();

// Check if there's a pending question
function checkForQuestion() {
  chrome.storage.local.get(['pendingQuestion', 'useChatGPTIntegration'], async (result) => {
    if (result.pendingQuestion) {
      console.log('[Skillwiz Autopilot] Found question:', result.pendingQuestion.slice(0, 60));

      await sendQuestionToChatGPT(result.pendingQuestion);

      // Clear the question
      chrome.storage.local.remove('pendingQuestion');
    }
  });
}

async function sendQuestionToChatGPT(question) {
  // Wait for ChatGPT to fully load
  const textarea = await waitForElement('textarea, [contenteditable="true"]');

  if (!textarea) {
    console.log('[Skillwiz Autopilot] Textarea not found after waiting');
    return;
  }

  // Focus and set the question
  textarea.focus();

  // Handle both textarea and contenteditable elements
  if (textarea.tagName === 'TEXTAREA') {
    textarea.value = question;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // Contenteditable div
    textarea.innerText = question;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Wait for the send button to be enabled
  let sendButton = await waitForElement('button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="send" i]');

  if (!sendButton) {
    // Try to find any button that looks like send
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.includes('send') || btn.querySelector('svg')) {
        const svgPath = btn.querySelector('svg')?.innerHTML || '';
        if (svgPath.includes('send') || svgPath.includes('Submit')) {
          sendButton = btn;
          break;
        }
      }
    }
  }

  if (sendButton) {
    sendButton.click();
    console.log('[Skillwiz Autopilot] Question sent to ChatGPT');

    // Wait for answer
    await waitForAnswer();
  } else {
    console.log('[Skillwiz Autopilot] Send button not found, trying Enter key...');
    // Try pressing Enter as last resort
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
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
    await new Promise(r => setTimeout(r, 500));
  }
  // Final attempt without visibility check
  return document.querySelector(selector);
}

// Parse answer from ChatGPT response - look for patterns like "1.", "Option 2", etc.
function parseAnswer(text) {
  if (!text) return null;

  const patterns = [
    // "The answer is 3" or "Answer: 3"
    /(?:answer|option)\s*(?:is|:)?\s*(\d+)/i,
    // Number followed by period or parenthesis at start: "3. " or "1)"
    /^(\d+)[.\)\s]/m,
    // Just find a standalone number in context
    /\b(\d+)\b/,
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
  const maxAttempts = 90; // 90 seconds timeout

  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 1000));

    // Get ChatGPT response messages - try multiple selectors
    const allMessages = document.querySelectorAll('[data-message-id], div.group, article, [role="presentation"]');

    for (const msg of allMessages) {
      const msgId = msg.getAttribute('data-message-id') || msg.getAttribute('id') || msg.textContent?.slice(0, 50);

      // Skip if already processed
      if (processedMessageIds.has(msgId)) continue;

      const text = msg.innerText || msg.textContent || '';

      // Only process if it looks like an answer (not user question)
      // Assistant messages typically have longer text and don't contain "Options:" at start
      if (text && text.length > 30 && !text.includes('Options:')) {
        // Additional check: this should be the newest message
        const allMsgs = Array.from(allMessages);
        const msgIndex = allMsgs.indexOf(msg);

        // Only consider messages that appear after potential user messages
        if (msgIndex >= allMsgs.length / 2 || allMsgs.length <= 2) {
          processedMessageIds.add(msgId);

          console.log('[Skillwiz Autopilot] Got answer:', text.slice(0, 100));

          // Parse the answer number
          const answerNum = parseAnswer(text);
          const answerToStore = answerNum ? `${answerNum}` : text;

          // Store answer for Skillwiz to read
          chrome.storage.local.set({ chatGPTAnswer: answerToStore }, () => {
            console.log('[Skillwiz Autopilot] Answer stored');
          });

          return;
        }
      }
    }

    attempts++;
  }

  console.log('[Skillwiz Autopilot] Timeout waiting for answer');
}

// Check for question when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkForQuestion);
} else {
  checkForQuestion();
}

// Also check every 3 seconds
setInterval(checkForQuestion, 3000);