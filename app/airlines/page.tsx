import Nav from '@/components/Nav'
import AirlinesGrid from '@/components/AirlinesGrid'

export default function AirlinesPage() {
  return (
    <main className="flex flex-col min-h-screen">
      <Nav />
      <AirlinesGrid />
    </main>
  )
}
