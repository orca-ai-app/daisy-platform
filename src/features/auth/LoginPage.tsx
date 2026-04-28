import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useRole } from './RoleContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'At least 8 characters'),
})

type FormValues = z.infer<typeof schema>

export default function LoginPage() {
  const navigate = useNavigate()
  const { user, isHQ, notProvisioned, isLoading } = useRole()

  // If already logged in, redirect to the right place.
  useEffect(() => {
    if (isLoading) return
    if (!user) return
    if (notProvisioned) {
      navigate('/unauthorized', { replace: true })
      return
    }
    navigate(isHQ ? '/hq/dashboard' : '/franchisee/dashboard', { replace: true })
  }, [user, isHQ, notProvisioned, isLoading, navigate])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error(error.message)
      return
    }
    // RoleContext picks up the session and the redirect effect above
    // routes the user once `user` populates.
    toast.success('Signed in')
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-daisy-bg p-6">
      <Card className="w-full max-w-md shadow-lift">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-daisy-yellow">
            <span className="text-2xl">✱</span>
          </div>
          <CardTitle>Daisy First Aid</CardTitle>
          <CardDescription>Sign in to the portal</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@daisyfirstaid.com"
                aria-invalid={!!errors.email}
                {...register('email')}
              />
              {errors.email ? (
                <p className="text-xs text-daisy-orange">{errors.email.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                {...register('password')}
              />
              {errors.password ? (
                <p className="text-xs text-daisy-orange">{errors.password.message}</p>
              ) : null}
            </div>
            <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
