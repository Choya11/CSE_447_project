import StaffManagement from "../components/StaffManagement.jsx";

export default function AdminCustodians() {
  return (
    <StaffManagement role="custodian" createPath="/admin/custodians" showKeyColumns={false} />
  );
}
