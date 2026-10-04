// Renders build/icon.png (256px) and build/icon.ico with Electron's canvas.
// Run: electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const html = `<canvas id=c width=256 height=256></canvas><script>
const x = document.getElementById('c').getContext('2d');
const g = x.createLinearGradient(0, 0, 256, 256);
g.addColorStop(0, '#a970ff'); g.addColorStop(1, '#6420d6');
x.fillStyle = g; x.beginPath(); x.roundRect(8, 8, 240, 240, 52); x.fill();
// one big tile + three small ones
x.fillStyle = '#fff';
x.beginPath(); x.roundRect(40, 62, 120, 132, 12); x.fill();
x.globalAlpha = .82;
for (let i = 0; i < 3; i++) { x.beginPath(); x.roundRect(170, 62 + i * 46, 46, 40, 8); x.fill(); }
x.globalAlpha = 1;
x.fillStyle = '#7b3cf0';
x.beginPath(); x.moveTo(84, 100); x.lineTo(84, 156); x.lineTo(124, 128); x.closePath(); x.fill();
</script>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 256, height: 256 });
  await win.loadURL('data:text/html,' + encodeURIComponent(html));
  const dataUrl = await win.webContents.executeJavaScript("document.getElementById('c').toDataURL('image/png')");
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  const out = path.join(__dirname, '..', 'build');
  fs.writeFileSync(path.join(out, 'icon.png'), png);
  // ICO with a single embedded 256x256 PNG image
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6); header.writeUInt8(0, 7); header.writeUInt8(0, 8); header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, png]));
  console.log('icon.png + icon.ico geschreven');
  app.quit();
});
