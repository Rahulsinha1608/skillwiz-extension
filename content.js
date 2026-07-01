// ============================================================
//  Skillwiz Autopilot — content.js
//  Automates Skillwiz courses with intelligent AI answering
// ============================================================

console.log('═══════════════════════════════════════════════════════════');
console.log('✓ CONTENT.JS LOADED');
console.log('═══════════════════════════════════════════════════════════');

// Prevent script re-injection
if (window.SKILLWIZ_AUTOPILOT_LOADED) {
  console.log('[Skillwiz Autopilot] Already loaded, skipping re-injection');
  throw new Error('Script already injected');
}
window.SKILLWIZ_AUTOPILOT_LOADED = true;

let observer = null;
let autopilotActive = false;
let autopilotSettings = {};
let isRunning = false;
let lastRunTime = 0;

// ── Navigation prevention ──────────────────────────────────
let preventNavigation = false;

// Prevent default form submissions when autopilot is active
document.addEventListener('submit', (e) => {
  if (autopilotActive && preventNavigation) {
    e.preventDefault();
    e.stopPropagation();
    log('Blocked form submission');
  }
}, true);

// Intercept link clicks that might navigate away during quiz
document.addEventListener('click', (e) => {
  if (!autopilotActive) return;
  
  const target = e.target.closest('a, button, [role="button"]');
  if (!target) return;
  
  const href = target.getAttribute('href');
  const text = (target.textContent || '').toLowerCase();
  
  // Don't block "Next" or "Continue" buttons
  if (text.includes('next') || text.includes('continue') || text.includes('proceed')) {
    return;
  }
  
  // Block navigation links during quiz
  if (href && (href.includes('home') || href.includes('course') || href.includes('dashboard'))) {
    if (preventNavigation) {
      e.preventDefault();
      e.stopPropagation();
      log('Blocked navigation link during quiz');
    }
  }
}, true);

// ── Element finding helpers ────────────────────────────────
function findElement(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el && typeof el.offsetParent !== 'undefined') {
        return el;
      }
    } catch (_) {}
  }
  return null;
}

function findAllElements(selectors) {
  for (const sel of selectors) {
    try {
      const els = document.querySelectorAll(sel);
      if (els && els.length > 0) {
        return Array.from(els).filter(el => el.offsetParent !== null);
      }
    } catch (_) {}
  }
  return [];
}

function log(msg, isErr = false) {
  const prefix = isErr ? '[Skillwiz Autopilot ERROR]' : '[Skillwiz Autopilot]';
  console.log(prefix, msg);
}

// ── Find buttons by text content (more reliable) ───────────
function findButtonByText(textPatterns) {
  // Include anchors so we detect plain <a class="btn">Check Answer</a>
  const allCandidates = Array.from(document.querySelectorAll('button, a, a[role="button"], [role="button"], input[type="button"], input[type="submit"], input[type="image"]'));

  for (const btn of allCandidates) {
    try {
      if (btn.offsetParent === null || btn.disabled) continue;
    } catch (_) {
      continue;
    }

    const text = ((btn.textContent || btn.innerText) || '').toLowerCase().trim();
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    const value = (btn.value || '').toString().toLowerCase();
    const dataset = JSON.stringify(btn.dataset || {}).toLowerCase();

    for (const pattern of textPatterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(text) || regex.test(ariaLabel) || regex.test(title) || regex.test(value) || regex.test(dataset)) {
        return btn;
      }
    }
  }

  // As a last-ditch: search for clickable elements with onclick/data-action/data-testid that are visible
  const clickable = Array.from(document.querySelectorAll('[onclick], [data-action], [data-testid], [role="button"]')).find(el => {
    try {
      if (el.offsetParent === null) return false;
    } catch (_) {
      return false;
    }
    const combined = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + JSON.stringify(el.dataset || {})).toLowerCase();
    return textPatterns.some(p => new RegExp(p, 'i').test(combined));
  });
  if (clickable) return clickable;

  return null;
}

// ── Extract question and options ───────────────────────────
function extractQuestion() {
  let questionText = '';
  let options = [];

  // Debug: Log all visible text on the page to help identify selectors
  const allText = document.body.innerText;
  log(`Page has ${allText.length} characters of text`);

  // Try to get question text from various selectors - expanded list
  const questionSelectors = [
    '.question-text',
    '.question-item',
    '.question-header',
    '[class*="questionText"]',
    '[class*="QuestionText"]',
    'mathjax-renderer',
    '[data-testid="question-text"]',
    '.MCQ-question',
    '.quiz-title',
    '.slide-title',
    '[role="heading"]',
    'h1, h2, h3, h4',
    '.content-header',
    '.lesson-title',
  ];

  for (const sel of questionSelectors) {
    try {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el.offsetParent !== null) {
          const text = el.innerText?.trim() || el.textContent?.trim() || '';
          if (text && text.length > 10 && text.length < 500) {
            questionText = text;
            log(`Found question: "${text.slice(0, 60)}..."`);
            break;
          }
        }
      }
      if (questionText) break;
    } catch (_) {}
  }

  // Get all answer options - find checkboxes and their associated text
  const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]:not(:disabled)'));
  
  if (checkboxes.length === 0) {
    log('No checkboxes found on page');
    return null;
  }

  log(`Found ${checkboxes.length} checkboxes`);

  checkboxes.forEach((checkbox, idx) => {
    let answerText = '';

    // Skillwiz structure: checkbox is in <label>, answer text is in <span class="col answer-text">
    // Within the same <div class="row mb-2"> container
    
    // Strategy 1: Look for span.col.answer-text in the same row
    const rowContainer = checkbox.closest('.row.mb-2, .row, div.question-answers > div');
    if (rowContainer) {
      const answerSpan = rowContainer.querySelector('span.col.answer-text, span.answer-text');
      if (answerSpan) {
        // Get text from mathjax-renderer or fallback to direct text
        const mathjax = answerSpan.querySelector('mathjax-renderer');
        if (mathjax) {
          answerText = mathjax.innerText?.trim() || mathjax.textContent?.trim() || '';
        } else {
          answerText = answerSpan.innerText?.trim() || answerSpan.textContent?.trim() || '';
        }
        
        if (answerText) {
          log(`Strategy 1 (Skillwiz span.answer-text): Option ${idx + 1}: "${answerText.slice(0, 40)}"`);
        }
      }
    }

    // Strategy 2: Look for label that wraps the checkbox
    if (!answerText) {
      const wrappingLabel = checkbox.closest('label');
      if (wrappingLabel) {
        const clone = wrappingLabel.cloneNode(true);
        clone.querySelectorAll('input').forEach(el => el.remove());
        answerText = clone.innerText?.trim() || clone.textContent?.trim() || '';
        if (answerText) {
          log(`Strategy 2 (wrapping label): Option ${idx + 1}: "${answerText.slice(0, 40)}"`);
        }
      }
    }

    // Strategy 3: Find next sibling span with text
    if (!answerText) {
      let sibling = checkbox.nextElementSibling;
      let attempts = 0;
      while (sibling && attempts < 3) {
        const text = sibling.innerText?.trim() || sibling.textContent?.trim() || '';
        if (text && text.length > 1 && !text.includes('☑') && !text.includes('☐')) {
          answerText = text;
          break;
        }
        sibling = sibling.nextElementSibling;
        attempts++;
      }
      if (answerText) {
        log(`Strategy 3 (next sibling): Option ${idx + 1}: "${answerText.slice(0, 40)}"`);
      }
    }

    // Strategy 4: Get next sibling text nodes
    if (!answerText) {
      let sibling = checkbox.nextElementSibling;
      let attempts = 0;
      while (sibling && attempts < 3) {
        const text = sibling.innerText?.trim() || sibling.textContent?.trim() || '';
        if (text && text.length > 1) {
          answerText = text;
          break;
        }
        sibling = sibling.nextElementSibling;
        attempts++;
      }
    }

    // Strategy 5: Get parent's text content
    if (!answerText && checkbox.parentElement) {
      const parent = checkbox.parentElement;
      const text = parent.innerText?.trim() || parent.textContent?.trim() || '';
      if (text && text.length > 1) {
        answerText = text;
      }
    }

    // Clean up the text
    if (answerText) {
      answerText = answerText.replace(/\s+/g, ' ').trim();
      // Remove checkbox-like characters
      answerText = answerText.replace(/^[\s☐☑✓✗\[\]]+/, '').trim();
    }

    if (answerText && answerText.length > 0) {
      options.push({
        number: idx + 1,
        text: answerText,
        element: checkbox,
      });
      log(`Option ${idx + 1}: "${answerText.slice(0, 50)}..."`);
    } else {
      log(`Option ${idx + 1}: No text extracted`, true);
    }
  });

  if (options.length === 0) {
    log('No options extracted from checkboxes', true);
    return null;
  }

  return {
    question: questionText || 'Question text not found',
    options: options,
    fullQuestion: `${questionText || 'Question'}\n\nOptions:\n${options.map(o => `${o.number}. ${o.text}`).join('\n')}`,
  };
}

// ── Safe click with scroll into view ───────────────────────
async function safeClick(el, delay = 0, preventDefault = false) {
  return new Promise((resolve) => {
    setTimeout(async () => {
      if (el && el.offsetParent !== null) {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await new Promise(r => setTimeout(r, 300));
          
          // Prevent default behavior if specified
          if (preventDefault) {
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            el.dispatchEvent(clickEvent);
          } else {
            el.click();
          }
          log(`Clicked: ${el.tagName}`);
        } catch (e) {
          log(`Click failed: ${e.message}`, true);
        }
      }
      resolve();
    }, delay);
  });
}

// ── Parse answer from ChatGPT response ─────────────────────
function parseAnswerFromResponse(response, optionCount) {
  if (!response) return null;

  // Handle numeric answers (from our parseAnswer function)
  const num = parseInt(response);
  if (!isNaN(num) && num >= 1 && num <= optionCount) {
    return num;
  }

  // Handle text responses with patterns
  const patterns = [
    /(?:answer|option)\s*(?:is|:)?\s*(\d+)/i,
    /^(\d+)[\.\)\s]/m,
  ];

  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match) {
      const parsedNum = parseInt(match[1]);
      if (!isNaN(parsedNum) && parsedNum >= 1 && parsedNum <= optionCount) {
        return parsedNum;
      }
    }
  }

  // If response is longer, try to find any number
  if (response.length > 20) {
    const numbers = response.match(/\b(\d+)\b/g);
    if (numbers) {
      for (const n of numbers) {
        const num = parseInt(n);
        if (num >= 1 && num <= optionCount) {
          return num;
        }
      }
    }
  }

  return null;
}

// ── ChatGPT integration ───────────────────────────────────
async function getChatGPTAnswer(question) {
  log('Requesting answer from ChatGPT...');

  return new Promise((resolve) => {
    // Send message to background script to open ChatGPT and store question
    chrome.runtime.sendMessage(
      { type: 'SWITCH_TO_CHATGPT', question: question },
      (response) => {
        if (response?.success) {
          log('ChatGPT tab opened with ID: ' + response.tabId);
          log('Waiting for ChatGPT answer...');

          // Wait for the answer to be extracted from ChatGPT
          let attempts = 0;
          const maxAttempts = 180; // 3 minutes timeout
          
          const checkInterval = setInterval(() => {
            chrome.storage.local.get(['chatGPTAnswer'], (result) => {
              if (result.chatGPTAnswer) {
                clearInterval(checkInterval);
                const answer = result.chatGPTAnswer;
                chrome.storage.local.remove('chatGPTAnswer');
                log('✓ Received answer from ChatGPT: ' + answer);
                
                // Switch back to Skillwiz tab
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                  if (tabs && tabs[0]) {
                    chrome.tabs.update(tabs[0].id, { active: true });
                    log('Switched back to Skillwiz tab');
                  }
                });
                
                resolve(answer);
              }
              attempts++;
              if (attempts > maxAttempts) {
                clearInterval(checkInterval);
                log('ChatGPT answer timeout after ' + maxAttempts + ' attempts', true);
                resolve(null);
              }
            });
          }, 1000);
        } else {
          log('Failed to open ChatGPT tab: ' + (response?.error || 'Unknown error'), true);
          resolve(null);
        }
      }
    );
  });
}

// ── Answer quiz questions with full ChatGPT automation ─────────────────────────────────
async function answerQuiz() {
  const questionData = extractQuestion();
  if (!questionData || questionData.options.length === 0) {
    log('No question or options found on page');
    return false;
  }

  log(`Found ${questionData.options.length} answer options`);
  log(`Question: "${questionData.question.slice(0, 50)}..."`);

  let selectedOption = null;
  const settings = autopilotSettings;

  // Use ChatGPT for answering
  if (settings.useChatGPT) {
    log('Starting ChatGPT automation workflow...');
    const answer = await getChatGPTAnswerFullAutomation(questionData);
    if (answer) {
      const answerNum = parseAnswerFromResponse(answer, questionData.options.length);
      if (answerNum) {
        selectedOption = questionData.options.find(o => o.number === answerNum);
        log(`ChatGPT selected option ${answerNum}`);
      }
    }
  }

  // Fallback: use first option or random
  if (!selectedOption) {
    if (settings.randomizeAnswers) {
      selectedOption = questionData.options[Math.floor(Math.random() * questionData.options.length)];
      log(`Randomly selected option ${selectedOption.number}`);
    } else {
      selectedOption = questionData.options[0];
      log('Using first option (no AI answer)');
    }
  }

  // Mark the selected answer and submit
  if (selectedOption && selectedOption.element) {
    log(`Marking option ${selectedOption.number} as selected...`);
    await markAnswerAndSubmit(selectedOption, settings);
  }

  return true;
}

// ── Full ChatGPT Automation: Open tab, send question, get answer, switch back ─────────────────────────────────
async function getChatGPTAnswerFullAutomation(questionData) {
  log('Opening ChatGPT tab with question...');

  // Get current tab ID via background script
  const skillwizTabId = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_ID' }, (response) => {
      resolve(response?.tabId);
    });
  });

  if (!skillwizTabId) {
    log('Could not get Skillwiz tab ID', true);
    return null;
  }
  log(`Current Skillwiz tab ID: ${skillwizTabId}`);

  return new Promise((resolve) => {
    // Store question in storage
    chrome.storage.local.set({
      pendingQuestion: questionData.fullQuestion,
      skillwizTabId: skillwizTabId,
      waitingForAnswer: true
    }, () => {
      // Open ChatGPT tab via background
      chrome.runtime.sendMessage({ type: 'SWITCH_TO_CHATGPT', question: questionData.fullQuestion }, (response) => {
        if (!response?.success) {
          log('Failed to open ChatGPT tab: ' + (response?.error || 'Unknown error'), true);
          resolve(null);
          return;
        }

        const chatgptTabId = response.tabId;
        log(`ChatGPT tab opened: ${chatgptTabId}`);

        // Wait for answer with timeout
        let attempts = 0;
        const checkInterval = setInterval(() => {
          chrome.storage.local.get(['chatGPTAnswer'], (result) => {
            if (result.chatGPTAnswer) {
              clearInterval(checkInterval);
              const answer = result.chatGPTAnswer;

              log('Answer received from ChatGPT, switching back...');

              // Switch back to Skillwiz tab via background
              chrome.runtime.sendMessage({ type: 'SWITCH_TO_TAB', tabId: skillwizTabId }, () => {
                log('Switched back to Skillwiz tab');
              });

              // Clean up storage
              chrome.storage.local.remove(['chatGPTAnswer', 'pendingQuestion', 'skillwizTabId', 'waitingForAnswer']);

              resolve(answer);
            }

            attempts++;
            if (attempts > 180) { // 3 minutes timeout
              clearInterval(checkInterval);
              log('ChatGPT answer timeout', true);

              // Switch back
              chrome.runtime.sendMessage({ type: 'SWITCH_TO_TAB', tabId: skillwizTabId }, () => {});

              resolve(null);
            }
          });
        }, 1000);
      });
    });
  });
}

// ── Mark answer option and submit ─────────────────────────────────
async function markAnswerAndSubmit(selectedOption, settings) {
  // Enable navigation prevention
  preventNavigation = true;
  
  // Click the checkbox to select the answer
  log('Clicking the selected option...');
  const checkbox = selectedOption.element;
  
  // 1) Try clicking associated label or wrapper (preferred for stylized checkboxes)
  let clickedSelection = false;
  try {
    // If checkbox has an id, try label[for="id"]
    if (checkbox.id) {
      let labelFor = null;
      try {
        labelFor = document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`);
      } catch (_) {
        // CSS.escape may not be available in some contexts; fall back
        labelFor = document.querySelector(`label[for="${checkbox.id}"]`);
      }
      if (labelFor && labelFor.offsetParent !== null) {
        await safeClick(labelFor, 0);
        log('Clicked label[for] for checkbox');
        clickedSelection = true;
      }
    }

    // If not clicked yet, check if checkbox is wrapped by a label
    if (!clickedSelection) {
      const wrappingLabel = checkbox.closest('label');
      if (wrappingLabel && wrappingLabel.offsetParent !== null) {
        await safeClick(wrappingLabel, 0);
        log('Clicked wrapping label for checkbox');
        clickedSelection = true;
      }
    }

    // If still not clicked, try to click the visible ancestor container (common in custom UIs)
    if (!clickedSelection) {
      const container = checkbox.closest('.row.mb-2, .answer, .option, .question-answers > div');
      if (container && container.offsetParent !== null) {
        await safeClick(container, 0);
        log('Clicked container for checkbox');
        clickedSelection = true;
      }
    }
  } catch (e) {
    log('Error clicking label/wrapper: ' + e.message, true);
  }

  // 2) Also set the checked state and fire events to be robust
  if (checkbox) {
    try {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
      log('Checkbox checked and events triggered');
    } catch (e) {
      log('Failed to set checkbox checked: ' + e.message, true);
    }
  }

  // 3) Small wait for UI to react
  await new Promise(r => setTimeout(r, settings.stepDelay || 800));

  // 4) Find and click the Check/Submit button
  log('Looking for Check/Submit button...');
  let checkBtn = findButtonByText(['check answer', '^check$', 'verify', 'submit', '\\bcheck\\b', '\\bsubmit\\b', 'answer']);

  if (checkBtn) {
    log('Clicking Check/Submit button...');
    await safeClick(checkBtn, settings.stepDelay || 400);
    log('Check/Submit button clicked');
  } else {
    // 5) If no explicit Check button, poll for Save/Next (auto-submit scenarios)
    log('Check/Submit button not found - will poll for Save/Next (auto-submit scenarios)');
    const timeoutMs = 4000;
    const intervalMs = 500;
    let elapsed = 0;
    let saveNextBtn = null;

    while (elapsed < timeoutMs) {
      // Try Save/Next patterns
      saveNextBtn = findButtonByText(['save', 'save & next', 'save and next', 'save/next', '^next$', 'continue', 'proceed', 'finish']);
      if (saveNextBtn) break;
      // Also look for inputs[type=submit] visible on page
      const submitInput = Array.from(document.querySelectorAll('input[type="submit"], input[type="button"]')).find(i => {
        try { return i.offsetParent !== null; } catch(_) { return false; }
      });
      if (submitInput) {
        saveNextBtn = submitInput;
        break;
      }

      await new Promise(r => setTimeout(r, intervalMs));
      elapsed += intervalMs;
    }

    if (saveNextBtn) {
      log('Found Save/Next button after polling, clicking...');
      await safeClick(saveNextBtn, 200);
    } else {
      log('No Save/Next found after polling. Attempting fallback submit triggers.');
      // Fallback: try triggering form submit on enclosing form
      try {
        const form = checkbox.closest('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          log('Dispatched submit event on enclosing form');
        }
      } catch (e) {
        log('Form submit fallback failed: ' + e.message, true);
      }
    }
  }

  // Wait a bit then disable prevention to allow normal navigation
  await new Promise(r => setTimeout(r, settings.stepDelay || 2000));
  preventNavigation = false;
}

// ── Find Save/Next button ─────────────────────────────────
async function findSaveNextButton(delay = 0) {
  await new Promise(r => setTimeout(r, delay));
  
  const btn = findButtonByText(['save', 'next', 'continue', 'proceed', 'finish']);
  if (btn) {
    log(`Found Save/Next button with text: "${btn.textContent.slice(0, 30)}"`);
    return btn;
  }
  
  return null;
}

// ── Click next lesson button ───────────────────────────────
async function clickNext() {
  const nextSelectors = [
    'a[aria-label*="Next" i]:not(:disabled)',
    'button[aria-label*="Next" i]:not(:disabled)',
    'a.btn-next:not(:disabled)',
    'button.btn-next:not(:disabled)',
    '[data-testid="next-button"]',
    '.next-button',
    'a[rel="next"]',
    'button:contains("Next")',
    '[class*="next"]:not(:disabled)',
  ];

  // Don't click next if we're in the middle of answering a quiz
  const hasCheckboxes = document.querySelectorAll('input[type="checkbox"]:not(:disabled)').length > 0;
  if (hasCheckboxes) {
    log('Skipping next click - quiz still in progress');
    return false;
  }

  const nextBtn = findButtonByText(['next', 'continue', 'proceed']);
  if (nextBtn) {
    log('Clicking Next button...');
    await safeClick(nextBtn, 500);
    return true;
  }

  log('Next button not found');
  return false;
}

// ── Click mark complete button ──────────────────────────────
async function clickComplete() {
  // Try multiple strategies to find the complete button
  let completeBtn = findButtonByText(['complete', 'finish', 'done', 'mark complete']);

  if (completeBtn) {
    log('Clicking Complete button...');
    await safeClick(completeBtn, 500);
    return true;
  }

  log('Complete button not found');
  return false;
}

// ── Main autopilot loop ───────────────────────────────────
async function runAutopilot() {
  const now = Date.now();
  if (now - lastRunTime < 1000) return; // Rate limit
  lastRunTime = now;

  if (!autopilotActive || isRunning) return;
  isRunning = true;

  try {
    const { autoQuiz, autoNext, markComplete, stepDelay } = autopilotSettings;

    // Check if quiz is present
    const hasQuiz = document.querySelectorAll('input[type="checkbox"]:not(:disabled)').length > 0;

    // Handle quiz first
    if (autoQuiz && hasQuiz) {
      await answerQuiz();
      await new Promise(r => setTimeout(r, stepDelay || 2000));
    }

    // Check if we're on a lesson complete page (no interactive content)
    const isLessonEnd = !hasQuiz && !document.querySelector('video, audio');

    if (autoNext && !hasQuiz) {
      await clickNext();
      await new Promise(r => setTimeout(r, stepDelay || 1500));
    }

    if (markComplete && isLessonEnd) {
      await clickComplete();
      await new Promise(r => setTimeout(r, stepDelay || 1000));
    }
  } catch (e) {
    log(`Autopilot error: ${e.message}`, true);
    console.error(e);
  } finally {
    isRunning = false;
  }
}

// ── Start mutation observer ───────────────────────────────
function startObserver() {
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    if (autopilotActive && !isRunning) {
      runAutopilot();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  log('Observer started');
}

// ── Message listener ───────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    if (msg.type === 'START_AUTOPILOT') {
      autopilotActive = true;
      autopilotSettings = msg.settings;
      log('✓ AUTOPILOT STARTED');
      startObserver();
      runAutopilot();
      sendResponse({ status: 'started' });
    } else if (msg.type === 'STOP_AUTOPILOT') {
      autopilotActive = false;
      if (observer) observer.disconnect();
      log('Autopilot stopped');
      sendResponse({ status: 'stopped' });
    } else if (msg.type === 'RUN_ONCE') {
      autopilotSettings = msg.settings;
      runAutopilot();
      sendResponse({ status: 'ran_once' });
    } else if (msg.type === 'GET_STATUS') {
      sendResponse({ active: autopilotActive, settings: autopilotSettings });
    }

    return true;
  } catch (e) {
    console.error('ERROR IN MESSAGE LISTENER:', e);
    sendResponse({ error: e.message });
    return true;
  }
});

console.log('═══════════════════════════════════════════════════════════');
console.log('✓ Content script ready');
console.log('═══════════════════════════════════════════════════════════');
