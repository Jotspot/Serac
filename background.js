// Example blocklist
const blocklist = [
  "facebook.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "reddit.com"
];

// Listen for tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  checkAndRedirect(tab);
});

// Listen for tab URL updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    checkAndRedirect(tab);
  }
});

// Function to check blocklist and redirect
async function checkAndRedirect(tab) {
  const {url, id} = tab;
  
  // Check if blocking is enabled
  const {blockingEnabled} = await chrome.storage.local.get("blockingEnabled");
  if (!blockingEnabled) return;

  for (let blocked of blocklist) {
    if (url.includes(blocked)) {
      chrome.tabs.update(id, {url: chrome.runtime.getURL("blocked.html")});
      break;
    }
  }
}