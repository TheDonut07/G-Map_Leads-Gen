const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startScrape: (query, maxResults) => ipcRenderer.invoke('start-scrape', { query, maxResults }),
  onProgress: (callback) => {
    ipcRenderer.on('scrape-progress', (event, progress) => callback(progress));
  },
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
});
