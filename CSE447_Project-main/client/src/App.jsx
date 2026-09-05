import { Routes, Route } from "react-router-dom";

import PublicLayout from "./components/PublicLayout.jsx";
import AuthenticatedLayout from "./components/AuthenticatedLayout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";

import Home from "./pages/Home.jsx";
import SubmitReport from "./pages/SubmitReport.jsx";
import SubmitConfirmation from "./pages/SubmitConfirmation.jsx";
import TrackReport from "./pages/TrackReport.jsx";
import TrackReportStatus from "./pages/TrackReportStatus.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Forbidden from "./pages/Forbidden.jsx";
import NotFound from "./pages/NotFound.jsx";
import SessionExpired from "./pages/SessionExpired.jsx";

import ReviewerDashboard from "./pages/ReviewerDashboard.jsx";
import ReviewerReportDetail from "./pages/ReviewerReportDetail.jsx";
import ReviewerReportHistory from "./pages/ReviewerReportHistory.jsx";

import AdminDashboard from "./pages/AdminDashboard.jsx";
import AdminReviewers from "./pages/AdminReviewers.jsx";
import AdminCustodians from "./pages/AdminCustodians.jsx";
import AdminReports from "./pages/AdminReports.jsx";
import AdminAuditLog from "./pages/AdminAuditLog.jsx";

import CustodianQueue from "./pages/CustodianQueue.jsx";
import CustodianRequestDetail from "./pages/CustodianRequestDetail.jsx";

export default function App() {
  return (
    <Routes>
      {/* Public area */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/submit" element={<SubmitReport />} />
        <Route path="/submit/confirmation" element={<SubmitConfirmation />} />
        <Route path="/track" element={<TrackReport />} />
        <Route path="/track/:trackingId" element={<TrackReportStatus />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/403" element={<Forbidden />} />
        <Route path="/session-expired" element={<SessionExpired />} />
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* Reviewer area */}
      <Route
        element={
          <ProtectedRoute role="reviewer">
            <AuthenticatedLayout role="reviewer" />
          </ProtectedRoute>
        }
      >
        <Route path="/reviewer" element={<ReviewerDashboard />} />
        <Route path="/reviewer/reports/:id" element={<ReviewerReportDetail />} />
        <Route path="/reviewer/reports/:id/history" element={<ReviewerReportHistory />} />
      </Route>

      {/* Admin area */}
      <Route
        element={
          <ProtectedRoute role="admin">
            <AuthenticatedLayout role="admin" />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/reviewers" element={<AdminReviewers />} />
        <Route path="/admin/custodians" element={<AdminCustodians />} />
        <Route path="/admin/reports" element={<AdminReports />} />
        <Route path="/admin/audit-log" element={<AdminAuditLog />} />
      </Route>

      {/* Custodian area */}
      <Route
        element={
          <ProtectedRoute role="custodian">
            <AuthenticatedLayout role="custodian" />
          </ProtectedRoute>
        }
      >
        <Route path="/custodian" element={<CustodianQueue />} />
        <Route path="/custodian/requests/:id" element={<CustodianRequestDetail />} />
      </Route>
    </Routes>
  );
}
