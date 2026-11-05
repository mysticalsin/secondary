import { Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Empty } from "./components/ui";
import { Accounts } from "./views/Accounts";
import { AccountWorkspace } from "./views/AccountWorkspace";
import { Admin } from "./views/admin";
import { Ask } from "./views/ask/Ask";
import { Brain } from "./views/brain/Brain";
import { GovernanceBoard } from "./views/GovernanceBoard";
import { Governances } from "./views/Governances";
import { MapPage } from "./views/MapPage";
import { Personal } from "./views/Personal";
import { Questions } from "./views/questions/Questions";
import { Review } from "./views/Review";
import { Routines } from "./views/routines/Routines";
import { SourceView } from "./views/SourceView";
import { LpEditorPage } from "./views/studio/lp/Editor";
import { Studio } from "./views/studio/Studio";
import { Today } from "./views/Today";
import { Usage } from "./views/usage/Usage";
import { WikiPage } from "./views/wiki/WikiPage";

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Ask />} />
        <Route path="today" element={<Today />} />
        <Route path="brain" element={<Brain />} />
        <Route path="questions" element={<Questions />} />
        <Route path="studio" element={<Studio />} />
        <Route path="studio/lp/:id" element={<LpEditorPage />} />
        <Route path="routines" element={<Routines />} />
        <Route path="usage" element={<Usage />} />
        <Route path="map" element={<MapPage />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="accounts/:id" element={<AccountWorkspace />} />
        <Route path="governances" element={<Governances />} />
        <Route path="governances/:id" element={<GovernanceBoard />} />
        <Route path="review" element={<Review />} />
        <Route path="personal" element={<Personal />} />
        <Route path="sources/:id" element={<SourceView />} />
        <Route path="wiki/:ws" element={<WikiPage />} />
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
