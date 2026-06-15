document.addEventListener("DOMContentLoaded", () => {
  const expandCheckbox = document.getElementById("expand-default");

  // Load configuration from local storage
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["sidebarExpanded"], (result) => {
      if (result.sidebarExpanded !== undefined) {
        expandCheckbox.checked = result.sidebarExpanded;
      } else {
        // Default is closed/collapsed
        expandCheckbox.checked = false;
      }
    });
  }

  // Listen for changes and persist
  expandCheckbox.addEventListener("change", (e) => {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ sidebarExpanded: e.target.checked });
    }
  });
});
