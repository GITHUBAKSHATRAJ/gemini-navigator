(function () {
  console.log("Gemini Prompt Navigator Active");

  let prompts = [];
  let previousPromptTexts = [];
  let scanTimeout = null;
  let observer = null;
  let fallbackInterval = null;

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

  const container = document.createElement("div");
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
    
    if (container.classList.contains("expanded")) {
      const rect = sidebarEl.getBoundingClientRect();
      if (isContextValid() && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          sidebarWidth: rect.width,
          sidebarHeight: rect.height
        });
      }
    }
  });

  // Bind UI Events
  const toggleBtn = container.querySelector("#gemini-nav-toggle-btn");
  const closeBtn = container.querySelector("#gemini-nav-close-btn");
  const searchInput = container.querySelector("#gemini-nav-search-input");
  const clearSearchBtn = container.querySelector("#gemini-nav-clear-search");
  const linksContainer = container.querySelector("#gemini-nav-links");
  const countSpan = container.querySelector("#gemini-nav-count");

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

  // Prioritized selectors list since Google updates Gemini classes frequently.
  function getPromptElements() {
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

    // Excludes system labels or empty strings.
    return elements.filter(function checkElement(el) {
      const text = el.textContent || el.innerText;
      if (!text) return false;
      const cleanText = text.trim().replace(/^you\s+said\s*:?\s*/i, "");
      return cleanText.length > 0;
    });
  }

  // Scan and build Prompt Table of Contents
  function scanPrompts() {
    if (!checkContextAndCleanup()) return;
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
            // Scrolling UP: older history loads at top, animate from bottom-to-top (slide up)
            prompt.animation = "slide-from-bottom";
            prompt.animationIndex = currentTopIdx++;
            prompt.totalNewCount = topCount;
          } else {
            // Scrolling DOWN: newer prompts load at bottom, animate from top-to-bottom (drop down)
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
    const query = searchInput.value.toLowerCase().trim();
    
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
      countSpan.textContent = "0";
      return;
    }

    countSpan.textContent = prompts.length;
    linksContainer.innerHTML = "";

    prompts.forEach(function renderPrompt(prompt, idx) {
      const isVisible = query === "" || prompt.text.toLowerCase().includes(query);
      
      const link = document.createElement("div");
      link.className = "nav-item-link";
      if (prompt.animation) {
        const isTop = prompt.animation === "slide-from-top";
        link.classList.add(isTop ? "nav-item-slide-from-top" : "nav-item-slide-from-bottom");
        
        // Spread animation sequence sequentially over 1 second.
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

  // Observe updates to the chat area.
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

  setTimeout(function initObserver() {
    if (!checkContextAndCleanup()) return;
    observer.observe(document.body, { childList: true, subtree: true });
    scanPrompts();
  }, 1000);

  fallbackInterval = setInterval(function fallbackScan() {
    if (!checkContextAndCleanup()) return;
    scanPrompts();
  }, 5000);

})();
