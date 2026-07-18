import Nav from '@/components/Nav'
import FlightBoard from '@/components/FlightBoard'

export function generateStaticParams() {
  return [{ code: 'alp' }, { code: 'dam' }]
}

export default async function AirportPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const ap = code.toUpperCase() as 'ALP' | 'DAM'
  if (ap !== 'ALP' && ap !== 'DAM') return <div>Unknown airport</div>
  return (
    <main className="flex flex-col min-h-screen">
      <Nav />
      <FlightBoard airport={ap} />
    </main>
  )
}
