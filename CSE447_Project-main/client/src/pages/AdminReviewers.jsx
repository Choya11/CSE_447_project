import StaffManagement from "../components/StaffManagement.jsx";

export default function AdminReviewers() {
  return <StaffManagement role="reviewer" createPath="/admin/reviewers" showKeyColumns />;
}
