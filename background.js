// background.js — service worker
let chatGPTTabId = null; // Store the ChatGPT tab ID for reuse

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    autopilotActive: false,
    settings: {
      autoNext: true,
      autoQuiz: true,
      markComplete: true,
    },
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SWITCH_TO_CHATGPT') {
    const question = message.question;

    // Store question in storage for ChatGPT to read
    chrome.storage.local.set({ pendingQuestion: question }, () => {
      // Check if we already have a ChatGPT tab open
      if (chatGPTTabId) {
        chrome.tabs.get(chatGPTTabId, (tab) => {
          if (tab && tab.url && (tab.url.includes('chatgpt.com') || tab.url.includes('chat.openai.com'))) {
            // Tab still exists and is a ChatGPT tab, reuse it
            console.log('Reusing existing ChatGPT tab:', chatGPTTabId);
            chrome.tabs.update(chatGPTTabId, { active: true }, () => {
              sendResponse({ success: true, tabId: chatGPTTabId });
            });
            return;
          } else {
            // Tab was closed or navigated away, reset
            chatGPTTabId = null;
            openNewChatGPTTab(sendResponse);
          }
        });
      } else {
        // No existing tab, open a new one
        openNewChatGPTTab(sendResponse);
      }
    });

    return true;
  }

  // NEW: Get current active tab ID (only works in background)
  if (message.type === 'GET_ACTIVE_TAB_ID') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        sendResponse({ tabId: tabs[0].id });
      } else {
        sendResponse({ tabId: null, error: 'No active tab found' });
      }
    });
    return true;
  }

  // NEW: Switch to a specific tab
  if (message.type === 'SWITCH_TO_TAB') {
    chrome.tabs.update(message.tabId, { active: true }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }

  // NEW: Close a tab
  if (message.type === 'CLOSE_TAB') {
    chrome.tabs.remove(message.tabId, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }

  // NEW: Store ChatGPT tab ID for reuse
  if (message.type === 'REGISTER_CHATGPT_TAB') {
    chatGPTTabId = message.tabId;
    console.log('ChatGPT tab registered for reuse:', chatGPTTabId);
    sendResponse({ success: true });
    return true;
  }
});

// Helper function to open a new ChatGPT tab
function openNewChatGPTTab(sendResponse) {
  const chatUrl = 'https://chatgpt.com/?model=gpt-4&utm_source=chrome_extension';

  chrome.tabs.create(
    {
      url: chatUrl,
      active: false,
      pinned: false,
    },
    (tab) => {
      if (chrome.runtime.lastError) {
        console.log('Failed to open ChatGPT tab:', chrome.runtime.lastError.message);
        const altUrl = 'https://chat.openai.com/?model=gpt-4&utm_source=chrome_extension';
        chrome.tabs.create(
          { url: altUrl, active: false },
          (tab2) => {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
              chatGPTTabId = tab2.id;
              console.log('ChatGPT tab opened (fallback):', tab2.id);
              sendResponse({ success: true, tabId: tab2.id });
            }
          }
        );
        return;
      }

      chatGPTTabId = tab.id;
      console.log('ChatGPT tab opened:', tab.id);
      sendResponse({ success: true, tabId: tab.id });
    }
  );
}
