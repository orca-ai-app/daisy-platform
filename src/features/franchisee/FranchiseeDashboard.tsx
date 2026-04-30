import { useRole } from '@/features/auth/RoleContext';
import { TopBar, PageHeader } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function FranchiseeDashboard() {
  const { user, signOut } = useRole();
  return (
    <div className="bg-daisy-bg min-h-screen">
      <TopBar
        actions={
          <>
            <span className="text-sm font-semibold text-white/85">{user?.email ?? ''}</span>
            <Button
              variant="ghost"
              onClick={() => void signOut()}
              className="text-white hover:bg-white/10"
            >
              Sign out
            </Button>
          </>
        }
      />
      <main className="mx-auto max-w-[1240px] px-10 py-12">
        <PageHeader
          title="Franchisee dashboard"
          subtitle="The franchisee portal lands in M2 (Weeks 6 to 9)."
        />
        <Card>
          <CardContent className="py-6">
            <p className="text-daisy-ink text-sm">
              Authenticated as <span className="font-semibold">{user?.email ?? 'unknown'}</span>
            </p>
            <p className="text-daisy-muted text-sm">role: franchisee</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
