import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <div className="container">
      <h1>Welcome to TanStack Start</h1>
      <p>Edit <code>src/routes/index.tsx</code> to get started.</p>
    </div>
  )
}
