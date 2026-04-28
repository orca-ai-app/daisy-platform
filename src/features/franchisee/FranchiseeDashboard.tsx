import { useRole } from '@/features/auth/RoleContext'
import { TopBar, PageHeader } from '@/components/daisy'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function FranchiseeDashboard() {
  const { user, signOut } = useRole()
  return (
    <div className="min-h-screen bg-daisy-bg">
      <TopBar email={user?.email ?? null}>
        <Button variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>
      </TopBar>
      <main className="mx-auto max-w-[1240px] px-10 py-12">
        <PageHeader
          title="Franchisee dashboard"
          subtitle="Wave 1A placeholder. The franchisee portal lands in M2."
        />
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-daisy-ink">
              Authenticated as <span className="font-semibold">{user?.email ?? 'unknown'}</span>
            </p>
            <p className="text-sm text-daisy-muted">role: franchisee</p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
