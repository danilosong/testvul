import { Route, Routes } from "react-router-dom";
import { PermissionPolicyPage } from "./pages/PermissionPolicyPage";

function Dashboard() {
  return <div>Security Configuration Auditor</div>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/permission-policy" element={<PermissionPolicyPage />} />
    </Routes>
  );
}

export default App;
