/**
 * Minimal SSE client for POST /mcp/generate-story-stream.
 *
 * Captures every frame with a timestamp relative to the moment the request
 * was sent, so time-to-preview and time-to-completion are measured from the
 * caller's side — the number a user actually waits for.
 *
 * Frame format (streamTypes.ts): `event: <type>\ndata: <json>\n\n`; comment
 * frames starting with `:` are heartbeats and are counted, not stored.
 */

export async function streamGenerate(server, body, { onEvent, timeoutMs = 12 * 60_000 } = {}) {
  const t0 = Date.now();
  const events = [];
  let heartbeats = 0;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const finish = (extra) => {
    clearTimeout(timer);
    return {
      events,
      heartbeats,
      completion: events.find(e => e.type === 'completion')?.data ?? null,
      errorEvent: events.find(e => e.type === 'error') ?? null,
      elapsedMs: Date.now() - t0,
      httpStatus: null,
      transportError: null,
      ...extra,
    };
  };

  let res;
  try {
    res = await fetch(`${server.replace(/\/+$/, '')}/mcp/generate-story-stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    return finish({ transportError: `request failed: ${e?.message || e}` });
  }

  if (!res.ok || !res.body) {
    let text = '';
    try { text = await res.text(); } catch { /* nothing to read */ }
    return finish({ httpStatus: res.status, transportError: `HTTP ${res.status}: ${text.slice(0, 300)}` });
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (frame.startsWith(':')) { heartbeats++; continue; }
        const dataLine = frame.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine) continue;
        let ev;
        try { ev = JSON.parse(dataLine.slice(5)); } catch { events.push({ type: 'unparsable', at: Date.now() - t0, raw: frame.slice(0, 500) }); continue; }
        const record = { type: ev.type, at: Date.now() - t0, serverTimestamp: ev.timestamp, data: ev.data };
        events.push(record);
        if (onEvent) onEvent(record);
      }
    }
  } catch (e) {
    return finish({ httpStatus: res.status, transportError: ctrl.signal.aborted ? `stream timed out after ${timeoutMs}ms` : `stream broke: ${e?.message || e}` });
  }
  return finish({ httpStatus: res.status });
}

/** One console line per event, in the style of the panel's own narration. */
export function describeEvent(e) {
  const d = e.data || {};
  const s = (e.at / 1000).toFixed(1).padStart(6);
  const msg = d.message || d.error || d.strategy || '';
  let tail = '';
  if (e.type === 'completion') tail = `  success=${d.success} action=${d.summary?.action} file=${d.fileName} verified=${d.verification?.outcome ?? 'absent'} llmCalls=${d.metrics?.llmCallsCount ?? '?'}`;
  if (e.type === 'preview_ready') tail = `  file=${d.fileName} id=${d.storybookId || '?'}`;
  if (e.type === 'retry') tail = `  attempt ${d.attempt}/${d.maxAttempts}: ${d.reason || ''}`;
  if (e.type === 'error') tail = `  ${d.code || ''} ${d.message || ''}`;
  return `${s}s  ${e.type}${d.phase ? ' ' + d.phase : ''}${d.step ? ` [${d.step}/${d.totalSteps}]` : ''}${msg ? '  ' + String(msg).slice(0, 110) : ''}${tail}`;
}
