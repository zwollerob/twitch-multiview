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
  castDiscover: () => ipcRenderer.invoke('cast:discover'),
  castPrepare: muteLocal => ipcRenderer.invoke('cast:prepare', muteLocal),
  castStart: deviceId => ipcRenderer.invoke('cast:start', deviceId),
  castStop: () => ipcRenderer.invoke('cast:stop'),
  castChunk: buffer => ipcRenderer.send('cast:chunk', buffer),
  onCastState: cb => ipcRenderer.on('cast:state', (e, s) => cb(s)),
  onCastRecorder: cb => ipcRenderer.on('cast:recorder', (e, cmd) => cb(cmd)),
  listScreens: () => ipcRenderer.invoke('screen:list'),
  moveToScreen: id => ipcRenderer.invoke('screen:move', id),
  openMiracast: () => ipcRenderer.invoke('screen:miracast'),
  castFeedback: () => ipcRenderer.invoke('cast:feedback'),
  onAuthChanged: cb => ipcRenderer.on('auth-changed', () => cb()),
  onShortcut: cb => ipcRenderer.on('shortcut', (e, key) => cb(key)),
  onFullscreenChanged: cb => ipcRenderer.on('fullscreen-changed', (e, on) => cb(on)),
});
