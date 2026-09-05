import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function ProtectedRoute({ role, roles, children }) {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;

  const allowed = roles || (role ? [role] : null);
  if (allowed && !allowed.includes(user.role)) return <Navigate to="/" replace />;

  return children;
}
