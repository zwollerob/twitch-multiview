'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: state => ipcRenderer.invoke('config:save', state),
  getUser: () => ipcRenderer.invoke('auth:user'),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  channelInfo: logins => ipcRenderer.invoke('twitch:channels', logins),
  followedLive: () => ipcRenderer.invoke('twitch:followed'),
  searchChannels: text => ipcRenderer.invoke('twitch:search', text),
  setFullscreen: on => ipcRenderer.invoke('window:fullscreen', on),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  args: () => ipcRenderer.invoke('app:args'),
  onAuthChanged: cb => ipcRenderer.on('auth-changed', () => cb()),
  onShortcut: cb => ipcRenderer.on('shortcut', (e, key) => cb(key)),
  onFullscreenChanged: cb => ipcRenderer.on('fullscreen-changed', (e, on) => cb(on)),
});
