(function () {
  let initialized = false;
  let prompts = [];
  let previousPromptTexts = [];
  let scanTimeout = null;
  let observer = null;
  let fallbackInterval = null;
  let container = null;
  let searchInput = null;
  let clearSearchBtn = null;
  let linksContainer = null;
  let countSpan = null;

  const isGemini = window.location.hostname.includes("gemini.google.com");
  const isGoogleSearch = window.location.hostname.includes("google.com") && window.location.pathname.startsWith("/search");

  function isGoogleAIMode() {
    if (!isGoogleSearch) return false;
    const urlParams = new URLSearchParams(window.location.search);
    const udm = urlParams.get("udm");
    if (udm === "50" || udm === "58" || (udm && udm.startsWith("5"))) return true;
    if (document.querySelector('[placeholder*="Ask anything"], [aria-label*="Ask anything"], [placeholder*="Ask Gemini"], [aria-label*="Ask Gemini"]')) return true;
    return false;
  }

  function checkAndInit() {
    if (initialized) return;
    if (isGemini || isGoogleAIMode()) {
      initNavigator();
    }
  }

  // Chrome invalidates scripts when reloaded. Calling getManifest throws if orphaned, letting us detect context loss.
  function isContextValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest());
    } catch (e) {
      return false;
    }
  }

  // Stops timers, observers, and removes old DOM nodes to prevent stacking duplicate widgets on reload.
  function cleanupOldContext() {
    console.log("[Navigator] Extension context invalidated. Cleaning up old session elements...");
    try {
      if (observer) {
        observer.disconnect();
      }
    } catch (e) {}
    try {
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    } catch (e) {}
    try {
      if (scanTimeout) {
        clearTimeout(scanTimeout);
      }
    } catch (e) {}
    try {
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      }
    } catch (e) {}
  }

  // Quick check at event thresholds to abort if context is lost.
  function checkContextAndCleanup() {
    if (!isContextValid()) {
      cleanupOldContext();
      return false;
    }
    return true;
  }

  function initNavigator() {
    initialized = true;
    console.log("[Navigator] Initializing Prompt Navigator...");

    container = document.createElement("div");
    container.id = "gemini-nav-container";
    container.className = "collapsed"; // Starts closed so it doesn't block the screen on page load.

    container.innerHTML = `
      <button id="gemini-nav-toggle-btn" title="Toggle Prompt Index">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"></line>
          <line x1="8" y1="12" x2="21" y2="12"></line>
          <line x1="8" y1="18" x2="21" y2="18"></line>
          <line x1="3" y1="6" x2="3.01" y2="6"></line>
          <line x1="3" y1="12" x2="3.01" y2="12"></line>
          <line x1="3" y1="18" x2="3.01" y2="18"></line>
        </svg>
      </button>
      <div id="gemini-nav-sidebar">
        <div class="nav-sidebar-header">
          <div class="nav-sidebar-title-row">
            <h3>Prompt Navigator</h3>
            <span class="nav-prompt-count" id="gemini-nav-count">0</span>
          </div>
          <button id="gemini-nav-close-btn" title="Close Sidebar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div class="nav-sidebar-search-box">
          <input type="text" id="gemini-nav-search-input" placeholder="Search prompts..." />
          <span class="nav-clear-search" id="gemini-nav-clear-search">&times;</span>
        </div>
        
        <div class="nav-sidebar-links" id="gemini-nav-links">
          <div class="nav-item-empty">Waiting for prompts...</div>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    const sidebarEl = container.querySelector("#gemini-nav-sidebar");
    const header = container.querySelector(".nav-sidebar-header");

    // Load saved layouts. Since sidebar uses absolute position right:0, container left is set to sidebar left + width.
    if (isContextValid() && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(
        ["sidebarExpanded", "positionX", "positionY", "sidebarWidth", "sidebarHeight"],
        function (result) {
          if (!isContextValid()) {
            cleanupOldContext();
            return;
          }
          if (result.sidebarExpanded) {
            container.classList.remove("collapsed");
            container.classList.add("expanded");
          }
          
          if (result.sidebarWidth !== undefined && result.sidebarHeight !== undefined) {
            sidebarEl.style.width = result.sidebarWidth + "px";
            sidebarEl.style.height = result.sidebarHeight + "px";
          }
          
          if (result.positionX !== undefined && result.positionY !== undefined) {
            const w = result.sidebarWidth || 320;
            const h = result.sidebarHeight || 480;
            const maxLeft = window.innerWidth - w - 10;
            const maxTop = window.innerHeight - h - 10;
            const left = Math.max(10, Math.min(maxLeft, result.positionX));
            const top = Math.max(10, Math.min(maxTop, result.positionY));
            
            container.style.right = "auto";
            container.style.left = (left + w) + "px";
            container.style.top = top + "px";
          }
        }
      );
    }

    // Drag-to-Relocate Logic
    let isDragging = false;
    let startX, startY;
    let startLeft, startTop;

    header.style.cursor = "move";

    header.addEventListener("mousedown", function handleMouseDown(e) {
      if (!checkContextAndCleanup()) return;
      if (e.button !== 0) return;
      if (e.target.closest("#gemini-nav-close-btn") || e.target.closest("input") || e.target.closest("button")) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      // Sidebar has actual width while container is 0, so we track visual sidebar rect to calculate boundaries accurately.
      const rect = sidebarEl.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", function handleMouseMove(e) {
      if (!isDragging) return;
      if (!checkContextAndCleanup()) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newSidebarLeft = startLeft + deltaX;
      let newSidebarTop = startTop + deltaY;

      const rect = sidebarEl.getBoundingClientRect();
      const margin = 10;
      newSidebarLeft = Math.max(margin, Math.min(window.innerWidth - rect.width - margin, newSidebarLeft));
      newSidebarTop = Math.max(margin, Math.min(window.innerHeight - rect.height - margin, newSidebarTop));

      container.style.right = "auto";
      container.style.left = (newSidebarLeft + rect.width) + "px";
      container.style.top = newSidebarTop + "px";
    });

    document.addEventListener("mouseup", function handleMouseUp() {
      if (!checkContextAndCleanup()) return;

      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = "";
        
        const rect = sidebarEl.getBoundingClientRect();
        if (isContextValid() && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            positionX: rect.left,
            positionY: rect.top
          });
        }
      }
      
      if (container && container.classList.contains("expanded")) {
        const rect = sidebarEl.getBoundingClientRect();
        if (isContextValid() && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            sidebarWidth: rect.width,
            sidebarHeight: rect.height
          });
        }
      }
    });

    // Keep within window boundaries on window resize
    window.addEventListener("resize", function handleResize() {
      if (!container || container.classList.contains("collapsed")) return;
      const rect = sidebarEl.getBoundingClientRect();
      const margin = 10;
      let left = rect.left;
      let top = rect.top;
      
      const maxLeft = window.innerWidth - rect.width - margin;
      const maxTop = window.innerHeight - rect.height - margin;
      
      left = Math.max(margin, Math.min(maxLeft, left));
      top = Math.max(margin, Math.min(maxTop, top));
      
      container.style.right = "auto";
      container.style.left = (left + rect.width) + "px";
      container.style.top = top + "px";
    });

    // Bind UI Events
    const toggleBtn = container.querySelector("#gemini-nav-toggle-btn");
    const closeBtn = container.querySelector("#gemini-nav-close-btn");
    searchInput = container.querySelector("#gemini-nav-search-input");
    clearSearchBtn = container.querySelector("#gemini-nav-clear-search");
    linksContainer = container.querySelector("#gemini-nav-links");
    countSpan = container.querySelector("#gemini-nav-count");

    toggleBtn.addEventListener("click", function handleToggleClick() {
      if (!checkContextAndCleanup()) return;
      container.classList.remove("collapsed");
      container.classList.add("expanded");
      if (isContextValid() && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ sidebarExpanded: true });
      }
      scanPrompts();
    });

    closeBtn.addEventListener("click", function handleCloseClick() {
      if (!checkContextAndCleanup()) return;
      container.classList.remove("expanded");
      container.classList.add("collapsed");
      if (isContextValid() && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ sidebarExpanded: false });
      }
    });

    searchInput.addEventListener("input", function handleSearchInput(e) {
      const query = e.target.value.toLowerCase().trim();
      if (query.length > 0) {
        clearSearchBtn.style.display = "block";
      } else {
        clearSearchBtn.style.display = "none";
      }
      filterLinks(query);
    });

    clearSearchBtn.addEventListener("click", function handleClearSearch() {
      searchInput.value = "";
      clearSearchBtn.style.display = "none";
      filterLinks("");
      searchInput.focus();
    });

    setTimeout(function initObserver() {
      if (!checkContextAndCleanup()) return;
      observer = new MutationObserver(function handleMutations(mutations) {
        if (!checkContextAndCleanup()) return;
        let shouldScan = false;
        for (let i = 0; i < mutations.length; i++) {
          const mutation = mutations[i];
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            let hasForeignNode = false;
            mutation.addedNodes.forEach(function verifyNode(node) {
              // Ignore scanning changes made by our own sidebar node additions.
              if (node.id !== "gemini-nav-container" && !node.closest?.("#gemini-nav-container")) {
                hasForeignNode = true;
              }
            });

            if (hasForeignNode) {
              shouldScan = true;
              break;
            }
          }
        }

        if (shouldScan) {
          triggerScan();
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      scanPrompts();
    }, 1000);

    fallbackInterval = setInterval(function fallbackScan() {
      if (!checkContextAndCleanup()) return;
      scanPrompts();
    }, 5000);
  }

  // Prioritized selectors list since Google updates Gemini/Search classes frequently.
  function getPromptElements() {
    const isGemini = window.location.hostname.includes("gemini.google.com");
    
    if (isGemini) {
      const selectors = [
        "user-query",
        "h2.query-text",
        ".query-text-inner",
        ".query-text",
        "[data-message-id][data-sender='user']"
      ];
      
      let elements = [];
      for (let i = 0; i < selectors.length; i++) {
        const selector = selectors[i];
        const found = document.querySelectorAll(selector);
        if (found.length > 0) {
          elements = Array.from(found);
          break;
        }
      }

      // Heuristics fallback: check wrapper divs containing user text.
      if (elements.length === 0) {
        const allTextContainers = document.querySelectorAll(".message-content, .query-content, .text-content");
        allTextContainers.forEach(function checkContainer(el) {
          if (el.closest(".user-message") || el.closest("[data-sender='user']")) {
            elements.push(el);
          }
        });
      }

      return elements.filter(function checkElement(el) {
        const text = el.textContent || el.innerText;
        if (!text) return false;
        const cleanText = text.trim().replace(/^you\s+said\s*:?\s*/i, "");
        return cleanText.length > 0;
      });
    } else {
      // Google Search AI Mode
      let elements = [];
      const selectors = [
        '[jsname="mE3zGb"]',
        ".PMDqCb",
        ".UTNPFf"
      ];
      
      for (let i = 0; i < selectors.length; i++) {
        const selector = selectors[i];
        const found = document.querySelectorAll(selector);
        if (found.length > 0) {
          elements = Array.from(found);
          break;
        }
      }
      
      // Fallback heuristics for Google Search AI Mode:
      if (elements.length === 0) {
        const urlParams = new URLSearchParams(window.location.search);
        const mainQuery = (urlParams.get("q") || "").trim();
        
        const candidates = document.querySelectorAll("div, span, h2, p");
        candidates.forEach(function checkCandidate(el) {
          if (el.closest("form") || el.closest("input") || el.closest("textarea") || el.closest("[role='search']")) {
            return;
          }
          
          if (el.children.length === 0 && el.textContent) {
            const text = el.textContent.trim();
            if (text.length > 3) {
              // Match main query
              if (mainQuery && text.toLowerCase() === mainQuery.toLowerCase()) {
                elements.push(el);
              } else {
                // Match follow-up messages by checking if the element is styled/aligned as a user bubble.
                const style = window.getComputedStyle(el);
                const parentStyle = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
                const isRightAligned = style.textAlign === "right" || 
                                       style.alignSelf === "flex-end" || 
                                       (parentStyle && (parentStyle.justifyContent === "flex-end" || parentStyle.alignItems === "flex-end" || parentStyle.textAlign === "right"));
                
                const hasBubbleStyle = style.borderRadius && style.borderRadius !== "0px";
                const isHeaderFooter = el.closest("header") || el.closest("footer") || el.closest("#foot") || el.closest("#heardt");
                
                if (isRightAligned && hasBubbleStyle && !isHeaderFooter) {
                  elements.push(el);
                }
              }
            }
          }
        });
      }
      
      // Remove duplicates
      elements = Array.from(new Set(elements));
      
      return elements.filter(function checkElement(el) {
        const text = el.textContent || el.innerText;
        if (!text) return false;
        const cleanText = text.trim();
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.getAttribute("contenteditable") === "true") {
          return false;
        }
        if (el.closest("form") || el.closest("[role='search']")) {
          return false;
        }
        return cleanText.length > 0;
      });
    }
  }

  // Scan and build Prompt Table of Contents
  function scanPrompts() {
    if (!checkContextAndCleanup()) return;
    
    if (container && !document.getElementById("gemini-nav-container")) {
      console.log("[Navigator] Container was removed from DOM. Re-appending...");
      document.body.appendChild(container);
    }

    const elements = getPromptElements();
    const newPrompts = [];

    elements.forEach(function assignId(el, index) {
      el.setAttribute("data-gemini-nav-id", index);
      let text = (el.textContent || el.innerText).trim();
      text = text.replace(/^you\s+said\s*:?\s*/i, "");
      newPrompts.push({
        id: index,
        text: text,
        element: el
      });
    });

    // Early exit if prompts list didn't change, saving CPU and avoiding double animation flicker.
    let isIdentical = newPrompts.length === prompts.length;
    if (isIdentical) {
      for (let i = 0; i < newPrompts.length; i++) {
        if (newPrompts[i].text !== prompts[i].text) {
          isIdentical = false;
          break;
        }
      }
    }

    if (isIdentical && prompts.length > 0) {
      return; 
    }

    const newPromptTexts = newPrompts.map(function getTxt(p) { return p.text; });
    if (prompts.length === 0) {
      newPrompts.forEach(function assignInitialAnimation(prompt, idx) {
        prompt.animation = "slide-from-top";
        prompt.animationIndex = idx;
        prompt.totalNewCount = newPrompts.length;
      });
    } else {
      let topCount = 0;
      let bottomCount = 0;
      
      newPrompts.forEach(function countNew(prompt, idx) {
        const isBrandNew = !previousPromptTexts.includes(prompt.text);
        if (isBrandNew) {
          const numAdded = newPrompts.length - prompts.length;
          if (idx < numAdded) {
            topCount++;
          } else {
            bottomCount++;
          }
        }
      });

      let currentTopIdx = 0;
      let currentBottomIdx = 0;
      newPrompts.forEach(function detectAnimation(prompt, idx) {
        const isBrandNew = !previousPromptTexts.includes(prompt.text);
        if (isBrandNew) {
          const numAdded = newPrompts.length - prompts.length;
          if (idx < numAdded) {
            prompt.animation = "slide-from-bottom";
            prompt.animationIndex = currentTopIdx++;
            prompt.totalNewCount = topCount;
          } else {
            prompt.animation = "slide-from-top";
            prompt.animationIndex = currentBottomIdx++;
            prompt.totalNewCount = bottomCount;
          }
        }
      });
    }

    prompts = newPrompts;
    previousPromptTexts = newPromptTexts;

    renderLinks();
  }

  // Render the links in the Sidebar
  function renderLinks() {
    const query = searchInput ? searchInput.value.toLowerCase().trim() : "";
    
    if (!linksContainer) return;

    if (prompts.length === 0) {
      linksContainer.innerHTML = `
        <div class="nav-item-empty">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 4px;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          No prompts found yet. Start typing!
        </div>
      `;
      if (countSpan) countSpan.textContent = "0";
      return;
    }

    if (countSpan) countSpan.textContent = prompts.length;
    linksContainer.innerHTML = "";

    prompts.forEach(function renderPrompt(prompt, idx) {
      const isVisible = query === "" || prompt.text.toLowerCase().includes(query);
      
      const link = document.createElement("div");
      link.className = "nav-item-link";
      if (prompt.animation) {
        const isTop = prompt.animation === "slide-from-top";
        link.classList.add(isTop ? "nav-item-slide-from-top" : "nav-item-slide-from-bottom");
        
        const totalItems = prompt.totalNewCount || 1;
        const animationIndex = prompt.animationIndex || 0;
        const delayStep = Math.min(60, 1000 / totalItems);
        const delayMs = animationIndex * delayStep;
        
        link.style.animationDelay = delayMs + "ms";
      }
      link.setAttribute("data-link-id", prompt.id);
      if (!isVisible) {
        link.style.display = "none";
      }

      const escapedText = prompt.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      link.innerHTML = `
        <span class="nav-item-link-num">#${idx + 1}</span>
        <span class="nav-item-link-text" title="${escapedText}">${escapedText}</span>
      `;

      link.addEventListener("click", function handleLinkClick() {
        const targetElement = document.querySelector(`[data-gemini-nav-id="${prompt.id}"]`);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: "smooth", block: "center" });

          targetElement.classList.add("gemini-nav-highlight-flash");
          setTimeout(function removeHighlight() {
            targetElement.classList.remove("gemini-nav-highlight-flash");
          }, 2000);
        }
      });

      linksContainer.appendChild(link);
    });
  }

  // Quick filter links matching query text without re-rendering elements
  function filterLinks(query) {
    if (!linksContainer) return;
    const links = linksContainer.querySelectorAll(".nav-item-link");
    let visibleCount = 0;

    prompts.forEach(function filterPrompt(prompt) {
      const link = linksContainer.querySelector(`.nav-item-link[data-link-id="${prompt.id}"]`);
      if (link) {
        const matches = prompt.text.toLowerCase().includes(query);
        if (matches) {
          link.style.display = "flex";
          visibleCount++;
        } else {
          link.style.display = "none";
        }
      }
    });

    const emptyMsg = linksContainer.querySelector(".nav-item-empty-search");
    if (visibleCount === 0 && prompts.length > 0) {
      if (!emptyMsg) {
        const msg = document.createElement("div");
        msg.className = "nav-item-empty nav-item-empty-search";
        msg.textContent = "No matches found.";
        linksContainer.appendChild(msg);
      }
    } else if (emptyMsg) {
      emptyMsg.remove();
    }
  }

  // Prevents multiple scans firing per second during rapid page mutations.
  function triggerScan() {
    if (!checkContextAndCleanup()) return;
    if (scanTimeout) {
      clearTimeout(scanTimeout);
    }
    scanTimeout = setTimeout(function debouncedScan() {
      if (!checkContextAndCleanup()) return;
      scanPrompts();
    }, 300);
  }

  // Run initial check
  checkAndInit();

  // Also poll for AI Mode detection on Google Search in case of dynamic SPA transition
  if (isGoogleSearch) {
    const checkInterval = setInterval(function () {
      if (initialized) {
        clearInterval(checkInterval);
        return;
      }
      checkAndInit();
    }, 1000);
  }
})();
