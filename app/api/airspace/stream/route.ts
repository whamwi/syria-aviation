import { getAirspace, CACHE_TTL } from '@/lib/opensky'

export const dynamic = 'force-dynamic'

const PUSH_INTERVAL = CACHE_TTL   // 25 s — real data update
const KEEPALIVE_MS  = 12_000      // 12 s — SSE comment to beat proxy/browser timeouts

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

export async function GET(req: Request) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        try { controller.enqueue(encoder.encode(chunk)) } catch { /* stream closed */ }
      }

      let lastPush = 0

      while (!req.signal.aborted) {
        const now = Date.now()

        if (now - lastPush >= PUSH_INTERVAL || lastPush === 0) {
          // Time for a real data push
          const snap = await getAirspace()
          send(`data: ${JSON.stringify(snap)}\n\n`)
          lastPush = Date.now()
        } else {
          // Keepalive comment — keeps the connection alive through proxies
          send(': keepalive\n\n')
        }

        // Wait for the shorter of: time until next data push, or keepalive interval
        const msUntilPush = PUSH_INTERVAL - (Date.now() - lastPush)
        await sleep(Math.min(msUntilPush, KEEPALIVE_MS), req.signal)
      }

      try { controller.close() } catch { /* already closed */ }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
