const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { scrapeLeads } = require('../scraper');

let mainWindow;
let scraping = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('start-scrape', async (event, { query, maxResults }) => {
  if (scraping) {
    return { ok: false, error: 'A scrape is already running.' };
  }
  scraping = true;
  try {
    const { output, outFile } = await scrapeLeads(query, maxResults, (progress) => {
      mainWindow.webContents.send('scrape-progress', progress);
    });
    return { ok: true, output, outFile };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    scraping = false;
  }
});

ipcMain.handle('show-in-folder', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});
