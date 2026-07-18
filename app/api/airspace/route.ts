import { NextResponse } from 'next/server'
import { getAirspace } from '@/lib/opensky'

export async function GET() {
  const snap = await getAirspace()
  if (!snap.ok) {
    return NextResponse.json(snap, { status: 502 })
  }
  return NextResponse.json(snap)
}
