import { Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Empty } from "./components/ui";
import { Accounts } from "./views/Accounts";
import { AccountWorkspace } from "./views/AccountWorkspace";
import { Admin } from "./views/Admin";
import { GovernanceBoard } from "./views/GovernanceBoard";
import { Governances } from "./views/Governances";
import { MapPage } from "./views/MapPage";
import { Personal } from "./views/Personal";
import { Review } from "./views/Review";
import { Today } from "./views/Today";

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Today />} />
        <Route path="map" element={<MapPage />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="accounts/:id" element={<AccountWorkspace />} />
        <Route path="governances" element={<Governances />} />
        <Route path="governances/:id" element={<GovernanceBoard />} />
        <Route path="review" element={<Review />} />
        <Route path="personal" element={<Personal />} />
        <Route path="admin" element={<Admin />} />
        <Route
          path="*"
          element={
            <div className="page">
              <Empty title="Page not found">Use the left rail to go back.</Empty>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
