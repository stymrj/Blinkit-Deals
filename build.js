// Builds dist/bookmarklet.txt and index.html (from src/index.tpl.html).
// Usage: node build.js   (uses terser if available via npx, else ships unminified)
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const src = path.join(__dirname, 'src/deals.js');
let code = fs.readFileSync(src, 'utf8');
try {
  code = execSync(`npx --yes terser "${src}" --compress --mangle`, { encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] });
  console.log('minified with terser');
} catch (e) {
  code = code.replace(/^\s*\/\/.*$/gm, '').replace(/\n\s*\n/g, '\n');
  console.log('terser unavailable, comments stripped only');
}
const bookmarklet = 'javascript:' + encodeURIComponent('(function(){' + code + '})()');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/bookmarklet.txt'), bookmarklet);
fs.copyFileSync(src, path.join(__dirname, 'dist/deals.js'));
// Tampermonkey/Violentmonkey build: loads quietly, adds a floating launcher button.
const header = `// ==UserScript==
// @name         Blinkit Deal Scout
// @namespace    blinkit-deals
// @version      2.0.0
// @description  Scan Blinkit across dozens of keywords and collections, rank by real savings, and build a smart basket.
// @match        https://www.blinkit.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
`;
const launcher = `
(function(){
  if(!window.__BDS__) return;
  window.__BDS__.hide();
  var b=document.createElement('button');
  b.textContent='⚡ Deals';
  b.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483646;background:#ffe500;color:#111;font:800 14px system-ui,sans-serif;border:0;border-radius:99px;padding:12px 18px;box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer';
  b.onclick=function(){window.__BDS__.toggle()};
  document.body.appendChild(b);
})();
`;
fs.writeFileSync(path.join(__dirname, 'dist/blinkit-deals.user.js'), header + code + '\n' + launcher);
const tpl =fs.readFileSync(path.join(__dirname, 'src/index.tpl.html'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'index.html'), tpl.replace('__BOOKMARKLET__', bookmarklet.replace(/&/g, '&amp;').replace(/"/g, '&quot;')));
console.log('bookmarklet size:', (bookmarklet.length / 1024).toFixed(1), 'KB');
