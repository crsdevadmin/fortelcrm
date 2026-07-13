import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';

import Login from './screens/Login';
import ChangePassword from './screens/ChangePassword';
import Dashboard from './screens/Dashboard';
import EnterSales from './screens/EnterSales';
import ROIDashboard from './screens/ROIDashboard';
import Doctors from './screens/Doctors';
import PendingApprovals from './screens/PendingApprovals';
import Regions from './screens/Regions';
import AdminUsers from './screens/AdminUsers';
import AdminDoctors from './screens/AdminDoctors';
import RegionView from './screens/RegionView';
import MyTeam from './screens/MyTeam';
import MyCustomers from './screens/MyCustomers';
import ProductSales from './screens/ProductSales';
import VisitLog from './screens/VisitLog';
import RepActivity from './screens/RepActivity';
import TargetSetting from './screens/TargetSetting';

// Route guard — redirects to / if role not allowed
function RoleGuard({ children, allowedRoles }) {
  const { user } = useAuth();
  if (!allowedRoles.includes(user?.role)) return <Navigate to="/" replace />;
  return children;
}

function PrivateRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <Layout>
      <Routes>
        <Route path="/"                 element={<Dashboard />} />
        <Route path="/doctors"          element={<Doctors />} />
        <Route path="/enter-sales"      element={<EnterSales />} />
        <Route path="/enter-investment" element={<Navigate to="/investment-roi" replace />} />
        <Route path="/investment-roi"   element={<ROIDashboard />} />
        <Route path="/roi-product"      element={<Navigate to="/product-sales" replace />} />
        <Route path="/control-tower"    element={<Navigate to="/" replace />} />
        <Route path="/business"         element={<Navigate to="/" replace />} />
        <Route path="/investment"       element={<Navigate to="/investment-roi" replace />} />
        <Route path="/risk"             element={<Navigate to="/investment-roi" replace />} />
        <Route path="/whiteboard"       element={<Navigate to="/" replace />} />
        <Route path="/my-team"          element={<MyTeam />} />
        <Route path="/visit-log"        element={<VisitLog />} />
        <Route path="/rep-activity"     element={<RepActivity />} />
        <Route path="/my-customers"     element={<MyCustomers />} />
        <Route path="/my-sales"         element={<Navigate to="/investment-roi?tab=my_sales" replace />} />
        <Route path="/product-sales"    element={<ProductSales />} />
        <Route path="/target-setting"   element={
          <RoleGuard allowedRoles={['md']}>
            <TargetSetting />
          </RoleGuard>
        } />

        {/* Admin + MD only */}
        <Route path="/users"            element={
          <RoleGuard allowedRoles={['admin', 'md']}>
            <AdminUsers />
          </RoleGuard>
        } />
        <Route path="/admin-doctors"    element={
          <RoleGuard allowedRoles={['admin', 'md', 'director', 'senior_manager', 'manager']}>
            <AdminDoctors />
          </RoleGuard>
        } />

        <Route path="/region-view"      element={<RegionView />} />
        <Route path="/regions"          element={<Regions />} />
        <Route path="/approvals"        element={<PendingApprovals />} />
        <Route path="/mapping"          element={<Navigate to="/admin-doctors" replace />} />
        <Route path="*"                 element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login"           element={<Login />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/*"               element={<PrivateRoutes />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
