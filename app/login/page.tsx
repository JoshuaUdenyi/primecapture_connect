import { isDemo, authConfigured, missingAuthSettings } from '@/lib/config';
import { SignIn } from '@/components/sign-in';
export const dynamic = 'force-dynamic';
export default function Login() {
  return <SignIn demo={isDemo()} configured={authConfigured()}
    missingSettings={process.env.NODE_ENV !== 'production' ? missingAuthSettings() : []} />;
}
