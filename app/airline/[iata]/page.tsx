import Nav from '@/components/Nav'
import AirlineView from '@/components/AirlineView'

export default async function AirlinePage({ params }: { params: Promise<{ iata: string }> }) {
  const { iata } = await params
  return (
    <main className="flex flex-col min-h-screen">
      <Nav />
      <AirlineView iata={iata.toUpperCase()} />
    </main>
  )
}
