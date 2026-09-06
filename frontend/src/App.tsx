import { Link, Route, Routes } from "react-router-dom";
import { PermissionPolicyPage } from "./pages/PermissionPolicyPage";
import { BusinessLogicRulesPage } from "./pages/BusinessLogicRulesPage";
import { NewSecurityAuditPage } from "./pages/NewSecurityAuditPage";
import { AuthProfilesPage } from "./pages/AuthProfilesPage";
import { ResourceOwnershipPage } from "./pages/ResourceOwnershipPage";
import { ScanProgressPage } from "./pages/ScanProgressPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AttackSurfacePage } from "./pages/AttackSurfacePage";
import { EndpointDetailPage } from "./pages/EndpointDetailPage";
import { FindingDetailPage } from "./pages/FindingDetailPage";
import { ReportDownloadPage } from "./pages/ReportDownloadPage";

function App() {
  return (
    <div className="app-shell">
      <header className="app-header"><Link className="brand" to="/">Auditor de configuração de segurança</Link><nav><Link to="/new-security-audit">Nova auditoria</Link><Link to="/authentication-profiles">Autenticação</Link><Link to="/resource-ownership">Propriedade</Link><Link to="/permission-policy">Permissões</Link><Link to="/business-logic-rules">Regras de negócio</Link></nav></header>
      <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/scans/:scanRunId" element={<DashboardPage />} />
      <Route path="/scans/:scanRunId/attack-surface" element={<AttackSurfacePage />} />
      <Route path="/endpoints/:endpointId" element={<EndpointDetailPage />} />
      <Route path="/findings/:findingId" element={<FindingDetailPage />} />
      <Route path="/scans/:scanRunId/reports" element={<ReportDownloadPage />} />
      <Route path="/permission-policy" element={<PermissionPolicyPage />} />
      <Route path="/business-logic-rules" element={<BusinessLogicRulesPage />} />
      <Route path="/new-security-audit" element={<NewSecurityAuditPage />} />
      <Route path="/authentication-profiles" element={<AuthProfilesPage />} />
      <Route path="/resource-ownership" element={<ResourceOwnershipPage />} />
      <Route path="/scans/:scanRunId/progress" element={<ScanProgressPage />} />
      </Routes>
    </div>
  );
}

export default App;
