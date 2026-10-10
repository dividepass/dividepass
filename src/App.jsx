// DividePass v2026.08.25 - build fix for TDZ and vercel.json routing
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthProvider';
import { AppDataProvider } from './contexts/AppDataContext';
import { ProtectedRoute, PublicRoute } from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import PaymentReturn from './pages/PaymentReturn';
import NotFound from './pages/NotFound';
import Sobre from './pages/Sobre';
import Faq from './pages/Faq';
import PlatformPage from './pages/PlatformPage';

// User Imports
import UserLayout from './pages/user/UserLayout';
import UserDashboard from './pages/user/UserDashboard';
import Catalog from './pages/user/Catalog';
import MyCredentials from './pages/user/MyCredentials';
import Billing from './pages/user/Billing';
import Checkout from './pages/user/Checkout';
import CheckoutLink from './pages/public/CheckoutLink';
import ServiceCredentials from './pages/user/ServiceCredentials';
import UserSupport from './pages/user/Support';
import CreateTicket from './pages/user/CreateTicket';
import TicketDetail from './pages/user/TicketDetail';
import Share from './pages/user/Share';
import UserProfile from './pages/user/UserProfile';
import GroupDetail from './pages/user/GroupDetail';
import UserPublicProfile from './pages/user/UserPublicProfile';
import SubscriptionManage from './pages/user/SubscriptionManage';
import SubscriptionHistory from './pages/user/SubscriptionHistory';
import TestimonialForm from './pages/user/TestimonialForm';
import CreateGroup from './pages/user/CreateGroup';
import ManageGroup from './pages/user/ManageGroup';
import Wallet from './pages/user/Wallet';
import MyGroups from './pages/user/MyGroups';
import MyCards from './pages/user/MyCards';

// Admin Imports
import AdminLayout from './pages/admin/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import Users from './pages/admin/Users';
import UserDetail from './pages/admin/UserDetail';
import Platforms from './pages/admin/Platforms';
import PlatformForm from './pages/admin/PlatformForm';
import Subscriptions from './pages/admin/Subscriptions';
import SubscriptionEdit from './pages/admin/SubscriptionEdit/SubscriptionEdit';
import Groups from './pages/admin/Groups';
import GroupForm from './pages/admin/GroupForm';
import Support from './pages/admin/Support';
import AdminTicketDetail from './pages/admin/AdminTicketDetail';
import Announcements from './pages/admin/Announcements';
import InterestList from './pages/admin/InterestList';
import Settings from './pages/admin/Settings';
import AdminWallets from './pages/admin/Wallets';
import BillingDashboard from './pages/admin/billing/BillingDashboard';
import BillingCalendar from './pages/admin/billing/BillingCalendar';
import BillingFailures from './pages/admin/billing/BillingFailures';
import CronManagement from './pages/admin/billing/CronManagement';
import Coupons from './pages/admin/Coupons';
import PlatformEvents from './pages/admin/PlatformEvents';
import Surveys from './pages/admin/Surveys';
import SurveyResults from './pages/admin/SurveyResults';
import OnboardingReport from './pages/admin/OnboardingReport';
import TestimonialsAdmin from './pages/admin/TestimonialsAdmin';
import SavingsStats from './pages/admin/SavingsStats';
import ServicePlans from './pages/admin/ServicePlans';
import Expenses from './pages/admin/Expenses';

// Pesquisa (public)
import Pesquisa from './pages/user/Pesquisa';

import './App.css';

// Build marker: confirms new code is running
if (typeof window !== 'undefined') {
  window.__BUILD_MARKER__ = 'DIVIDEPASS_v20260825_FIXED';
}

function App() {
  return (
    <AuthProvider>
      <AppDataProvider>
        <Router>
          <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/payment/return" element={<PaymentReturn />} />
            <Route path="/checkout/:groupSlug" element={<Checkout />} />
            <Route path="/checkout-link/:referenceCode" element={<CheckoutLink />} />
            <Route path="/pesquisa/:slug" element={<Pesquisa />} />

            {/* SEO Public Pages */}
            <Route path="/sobre" element={<Sobre />} />
            <Route path="/faq" element={<Faq />} />

            {/* User Routes */}
            <Route path="/dashboard" element={<ProtectedRoute><UserLayout /></ProtectedRoute>}>
              <Route index element={<UserDashboard />} />
              <Route path="catalog" element={<Catalog />} />
              <Route path="catalog/:serviceId" element={<Catalog />} />
              <Route path="checkout/:groupSlug" element={<Checkout />} />
              <Route path="credentials" element={<MyCredentials />} />
              <Route path="credentials/:serviceId" element={<ServiceCredentials />} />
              <Route path="billing" element={<Billing />} />
              <Route path="wallet" element={<Wallet />} />
              <Route path="my-cards" element={<MyCards />} />
              <Route path="my-groups" element={<MyGroups />} />
              <Route path="my-groups/create" element={<CreateGroup />} />
              <Route path="my-groups/:groupId/manage" element={<ManageGroup />} />
              <Route path="support" element={<UserSupport />} />
              <Route path="support/new" element={<CreateTicket />} />
              <Route path="support/:ticketId" element={<TicketDetail />} />
              <Route path="share" element={<Share />} />
              <Route path="profile" element={<UserProfile />} />
              <Route path="groups/:groupSlug" element={<GroupDetail />} />
              <Route path="user/:userId" element={<UserPublicProfile />} />
              <Route path="subscription/:subscriptionId" element={<SubscriptionManage />} />
              <Route path="subscription-history" element={<SubscriptionHistory />} />
              <Route path="testimonial" element={<TestimonialForm />} />
            </Route>

            {/* Admin Routes */}
            <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminLayout /></ProtectedRoute>}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<Users />} />
            <Route path="users/:userId" element={<UserDetail />} />
            <Route path="platforms" element={<Platforms />} />
            <Route path="platforms/new" element={<PlatformForm />} />
            <Route path="platforms/:platformId/edit" element={<PlatformForm />} />
            <Route path="subscriptions" element={<Subscriptions />} />
            <Route path="subscriptions/:id/edit" element={<SubscriptionEdit />} />
            <Route path="groups" element={<Navigate to="/admin/platforms" replace />} />
            <Route path="groups/new" element={<GroupForm />} />
            <Route path="groups/:groupId/edit" element={<GroupForm />} />
            <Route path="support" element={<Support />} />
            <Route path="support/:ticketId" element={<AdminTicketDetail />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="interest" element={<InterestList />} />
            <Route path="wallets" element={<AdminWallets />} />
            <Route path="settings" element={<Settings />} />
            <Route path="billing" element={<BillingDashboard />} />
            <Route path="billing/calendar" element={<BillingCalendar />} />
            <Route path="billing/failures" element={<BillingFailures />} />
            <Route path="billing/crons" element={<CronManagement />} />
            <Route path="coupons" element={<Coupons />} />
            <Route path="events" element={<PlatformEvents />} />
            <Route path="surveys" element={<Surveys />} />
            <Route path="onboarding" element={<OnboardingReport />} />
            <Route path="surveys/:id/edit" element={<Surveys />} />
            <Route path="surveys/:id/results" element={<SurveyResults />} />
            <Route path="testimonials" element={<TestimonialsAdmin />} />
            <Route path="savings" element={<SavingsStats />} />
            <Route path="service-plans" element={<ServicePlans />} />
            <Route path="expenses" element={<Expenses />} />
            </Route>

            {/* Platform SEO pages - any single-segment path matches here */}
            <Route path="/:slug" element={<PlatformPage />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </ErrorBoundary>
        </Router>
      </AppDataProvider>
    </AuthProvider>
  );
}

export default App;
