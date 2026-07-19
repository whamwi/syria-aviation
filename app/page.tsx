import LiveMap from '@/components/LiveMap'
import StatsBar from '@/components/StatsBar'
import Nav from '@/components/Nav'

export default function HomePage() {
  return (
    <main className="flex flex-col h-screen overflow-hidden">
      <Nav />
      <div className="flex-1 flex flex-col min-h-0">
        <StatsBar />
        <LiveMap />
      </div>
    </main>
  )
}
