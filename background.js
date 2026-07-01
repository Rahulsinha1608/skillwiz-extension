// background.js — service worker
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
      // Force opening ChatGPT in Chrome browser, not desktop app
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
                  console.log('ChatGPT tab opened (fallback):', tab2.id);
                  sendResponse({ success: true, tabId: tab2.id });
                }
              }
            );
            return;
          }

          console.log('ChatGPT tab opened:', tab.id);
          sendResponse({ success: true, tabId: tab.id });
        }
      );
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
});