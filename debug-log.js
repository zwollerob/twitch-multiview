'use strict';
// Temporary diagnostics for the channel points bonus chest
// ("Error claiming bonus"). Dev runs only: `npx electron . --debug-log=chest.log`.
const fs = require('fs');

module.exports = function createDebugLog(file) {
  const write = (...parts) => {
    const line = `${new Date().toISOString()} ${parts.join(' ')}\n`;
    fs.appendFileSync(file, line);
    process.stdout.write(line);
  };
  write('--- debug run, electron', process.versions.electron, 'chrome', process.versions.chrome);

  const decodeToken = token => {
    try {
      const payload = String(token).split('.')[1] || String(token).replace(/^v4\.public\./, '');
      const json = Buffer.from(payload, 'base64url').toString('utf8');
      const m = json.match(/\{.*\}/s);
      return m ? m[0] : json.slice(0, 300);
    } catch { return '(undecodable)'; }
  };

  function watch(contents) {
    let attached = false;
    contents.on('console-message', e => {
      const msg = e.message || '';
      if (/integrity|kpsdk|claim|community|points|error|fail/i.test(msg)) write('CONSOLE', e.level, contents.getURL().slice(0, 60), msg.slice(0, 500));
    });
    contents.on('did-fail-load', (e, code, desc, url, isMain) => write('LOAD-FAIL', code, desc, 'main=' + isMain, url.slice(0, 200)));
    contents.on('did-finish-load', async () => {
      if (attached || !/^https:\/\/www\.twitch\.tv\/popout\//.test(contents.getURL())) return;
      attached = true;
      const dbg = contents.debugger;
      try {
        dbg.attach('1.3');
        await dbg.sendCommand('Network.enable');
      } catch (err) { write('DEBUGGER-FAIL', err.message); return; }
      write('watching chat', contents.getURL());
      const reqs = new Map();
      dbg.on('message', async (e, method, p) => {
        if (method === 'Network.requestWillBeSent') {
          const { url, method: m, headers, postData } = p.request;
          const interesting = /gql\.twitch\.tv\/integrity|kpsdk|\/fp\?|\/tl$|twitchcdn\.net\/.*(ips|p)\.js/i.test(url)
            || (url.startsWith('https://gql.twitch.tv/gql') && /Claim|CommunityPoints|ChannelPoint/i.test(postData || ''));
          if (!interesting) return;
          reqs.set(p.requestId, url);
          const hdrs = Object.keys(headers).filter(h => /integrity|kpsdk|device|client-id|sec-ch/i.test(h))
            .map(h => `${h}=${/integrity/i.test(h) ? decodeToken(headers[h]) : String(headers[h]).slice(0, 60)}`);
          write('REQ', m, url.slice(0, 160), (postData || '').slice(0, 400), hdrs.join(' | '));
        } else if (method === 'Network.responseReceived' && reqs.has(p.requestId)) {
          write('RES', p.response.status, p.response.url.slice(0, 160));
        } else if (method === 'Network.loadingFinished' && reqs.has(p.requestId)) {
          try {
            const { body } = await dbg.sendCommand('Network.getResponseBody', { requestId: p.requestId });
            let out = body.slice(0, 1500);
            const tok = body.match(/"token"\s*:\s*"([^"]+)"/);
            if (tok) out += `  DECODED=${decodeToken(tok[1])}`;
            write('BODY', reqs.get(p.requestId).slice(0, 100), out);
          } catch { /* body not available */ }
        } else if (method === 'Network.loadingFailed' && reqs.has(p.requestId)) {
          write('FAILED', p.errorText, p.blockedReason || '', reqs.get(p.requestId).slice(0, 160));
        }
      });
    });
  }

  return { write, watch };
};
