import { ReportsPage } from './pages/reports'
import { AnalyticsPage } from './pages/analytics'
import { MultiCamReIdPage } from './pages/multicam-reid'
import { FaceRecognitionPage } from './pages/face-recognition'
import type { Routes } from '@angular/router'
import { AuthLayoutComponent } from './auth/auth-layout'
import { guestGuard, protectedGuard, verifyEmailGuard } from './core/guards'
import { AppLayoutComponent } from './layout/app-layout'
import { ForgotPasswordPage } from './pages/auth/forgot-password'
import { PrivacyPage, TermsPage } from './pages/auth/legal-pages'
import { LoginPage } from './pages/auth/login'
import { ResetPasswordPage } from './pages/auth/reset-password'
import { SignupPage } from './pages/auth/signup'
import { VerifyEmailPage } from './pages/auth/verify-email'
import { CamerasPage } from './pages/cameras'
import { CctvMapPage } from './pages/cctv-map'
import { DashboardPage } from './pages/dashboard'
import { IncidentsPage } from './pages/incidents'
import { MonitoringPage } from './pages/monitoring'
import { SettingsPage } from './pages/settings'
import { SubscriptionPage } from './pages/subscription'
import { SubscriptionCheckoutPage } from './pages/subscription-checkout'
import { SubscriptionConfirmationPage } from './pages/subscription-confirmation'

/** Same URLs as the React router in frontend/src/App.tsx. */
export const routes: Routes = [
  { path: 'terms', component: TermsPage },
  { path: 'privacy', component: PrivacyPage },

  // App layout FIRST: an empty-path parent matches '/' even when none of its children do,
  // so if the auth layout came first, '/' would render an empty sign-in shell.
  {
    path: '',
    component: AppLayoutComponent,
    canActivate: [protectedGuard],
    children: [
      { path: '', component: DashboardPage, pathMatch: 'full' },
      { path: 'monitoring', component: MonitoringPage },
      { path: 'incidents', component: IncidentsPage },
      { path: 'cameras', component: CamerasPage },
      { path: 'cctv-map', component: CctvMapPage },
      { path: 'face-recognition', component: FaceRecognitionPage },
      { path: 'multicam-reid', component: MultiCamReIdPage },
      { path: 'analytics', component: AnalyticsPage },
      { path: 'reports', component: ReportsPage },
      { path: 'settings', component: SettingsPage },
      { path: 'subscription', component: SubscriptionPage },
      { path: 'subscription/checkout', component: SubscriptionCheckoutPage },
      { path: 'subscription/confirmation', component: SubscriptionConfirmationPage },
    ],
  },

  {
    path: '',
    component: AuthLayoutComponent,
    canActivate: [guestGuard],
    children: [
      { path: 'login', component: LoginPage },
      { path: 'signup', component: SignupPage },
      { path: 'forgot-password', component: ForgotPasswordPage },
      { path: 'reset-password', component: ResetPasswordPage },
    ],
  },

  {
    path: '',
    component: AuthLayoutComponent,
    canActivate: [verifyEmailGuard],
    children: [{ path: 'verify-email', component: VerifyEmailPage }],
  },

  { path: '**', redirectTo: '' },
]

