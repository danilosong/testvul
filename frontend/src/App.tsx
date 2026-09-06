import { Route, Routes } from "react-router-dom";
import { PermissionPolicyPage } from "./pages/PermissionPolicyPage";
import { BusinessLogicRulesPage } from "./pages/BusinessLogicRulesPage";

function Dashboard() {
  return <div>Security Configuration Auditor</div>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/permission-policy" element={<PermissionPolicyPage />} />
      <Route path="/business-logic-rules" element={<BusinessLogicRulesPage />} />
    </Routes>
  );
}

export default App;
