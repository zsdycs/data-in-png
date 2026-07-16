'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 请求主进程将一组文件下载到系统默认下载目录。
   * files: [{ url: string, name: string }]
   * 返回 Promise<{ ok: boolean, saved: string[], error?: string }>
   */
  downloadFiles: (files) => ipcRenderer.invoke('download-files', files),

  /**
   * 监听下载进度：{ done: number, total: number, file: string }
   */
  onDownloadProgress: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on('download-progress', wrapped);
    return () => ipcRenderer.removeListener('download-progress', wrapped);
  },
});
