import { useRole } from './RoleContext'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function Unauthorized() {
  const { signOut } = useRole()
  return (
    <div className="flex min-h-screen items-center justify-center bg-daisy-bg p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Account not yet provisioned</CardTitle>
          <CardDescription>
            Your sign-in worked, but we don't have a profile for your email
            address yet. Speak to HQ to get added to the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void signOut()} className="w-full">
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
