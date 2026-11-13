// Relay client used by both the host page and the phone pad. Keys travel in the
// Authorization header, never in a URL.
const BASE = '/api/slipstream';

export async function api(path, {method = 'GET', key, body} = {}) {
  const headers = {};
  if (key) headers.Authorization = 'Bearer ' + key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(BASE + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store'});
  if (response.status === 204 || response.status === 202) return null;
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) throw Object.assign(new Error(data?.error || 'Request failed (' + response.status + ')'), {status: response.status});
  return data;
}

// Long-lived event stream over fetch (EventSource cannot send headers).
// Reconnects with backoff until stop() is called or the server refuses the key.
export function listen(path, key, onMessage, onStatus = () => {}) {
  let stopped = false, controller = null, delay = 500;
  (async () => {
    while (!stopped) {
      controller = new AbortController();
      try {
        const response = await fetch(BASE + path, {headers: {Authorization: 'Bearer ' + key}, signal: controller.signal, cache: 'no-store'});
        if (stopped) return;
        if (response.status === 403 || response.status === 404) { onStatus('refused'); return; }
        if (!response.ok || !response.body) throw new Error('stream ' + response.status);
        onStatus('online'); delay = 500;
        const reader = response.body.getReader(), text = new TextDecoder();
        let buffer = '';
        for (;;) {
          const {value, done} = await reader.read();
          if (stopped) return;
          if (done) break;
          buffer += text.decode(value, {stream: true});
          if (buffer.length > 65536) throw new Error('stream overflow');
          let cut;
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
            for (const line of block.split('\n')) {
              if (!line.startsWith('data: ')) continue;
              let message; try { message = JSON.parse(line.slice(6)); } catch { continue; }
              if (stopped) return;
              try { onMessage(message); } catch (error) { console.error(error); }
            }
          }
        }
      } catch (error) { if (stopped) return; }
      if (stopped) return;
      onStatus('offline');
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(5000, delay * 2);
    }
  })();
  return () => { stopped = true; controller?.abort(); };
}

// Two-way channel for a host or a player. Prefers one WebSocket (lower delay for
// steering); if a socket cannot be opened twice in a row it uses the event stream
// plus one HTTP request per message instead. The key is sent as the first socket
// message, never in the socket URL.
export function channel({room, key, role, onMessage, onStatus = () => {}}) {
  let socket = null, live = false, stopped = false, stopHttp = null, delay = 500, failures = 0;
  const useHttp = () => { if (!stopHttp && !stopped) stopHttp = listen('/rooms/' + room + '/' + role, key, onMessage, onStatus); };
  function open() {
    if (stopped) return;
    let ws, opened = false;
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + BASE + '/ws'); } catch { return useHttp(); }
    socket = ws;
    const giveUp = setTimeout(() => { if (!opened) ws.close(); }, 2500);
    const current = () => !stopped && socket === ws;
    ws.onopen = () => { if (current()) ws.send(JSON.stringify({room, key})); };
    ws.onmessage = event => {
      if (!current()) return;
      if (!opened) { opened = true; live = true; failures = 0; delay = 500; clearTimeout(giveUp); onStatus('online'); }
      if (!current()) return; // A status callback may have stopped this channel.
      let message; try { message = JSON.parse(event.data); } catch { return; }
      try { onMessage(message); } catch (error) { console.error(error); }
    };
    ws.onerror = () => {};
    ws.onclose = event => {
      clearTimeout(giveUp);
      if (!current()) return;
      live = false; socket = null;
      if (event.code === 4403) { onStatus('refused'); return; }
      if (!opened && ++failures >= 2) return useHttp();
      onStatus('offline');
      setTimeout(open, delay); delay = Math.min(5000, delay * 2);
    };
  }
  open();
  return {
    get transport() { return live ? 'socket' : stopHttp ? 'http' : 'connecting'; },
    async send(body) {
      if (stopped) throw new Error('Channel stopped');
      if (live) { socket.send(JSON.stringify({t: role === 'host' ? 'state' : 'input', ...body})); return Promise.resolve(); }
      return api('/rooms/' + room + (role === 'host' ? '/state' : '/input'), {method: 'POST', key, body});
    },
    stop() { stopped = true; live = false; try { socket?.close(); } catch {} stopHttp?.(); }
  };
}
