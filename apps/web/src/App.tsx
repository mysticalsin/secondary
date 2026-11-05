import { Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Empty } from "./components/ui";
import {
  AccessPage,
  ActivityPage,
  BrainPage,
  CoachPage,
  Directory,
  FieldsPage,
  ImportPage,
  JournalPage,
  PageView,
  TrashPage,
  VersionsPage,
} from "./views/brains";
import { Home } from "./views/home/Home";
import { SourceView } from "./views/SourceView";
import { SearchPage } from "./views/search/Search";
import { Settings } from "./views/settings/Settings";
import { ProposalPage } from "./views/waiting/Proposal";
import { Waiting } from "./views/waiting/Waiting";

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="waiting" element={<Waiting />} />
        <Route path="waiting/:id" element={<ProposalPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="brains" element={<Directory />} />
        <Route path="brains/:id" element={<BrainPage />} />
        <Route path="brains/:id/pages/:pid" element={<PageView />} />
        <Route path="brains/:id/pages/:pid/versions" element={<VersionsPage />} />
        <Route path="brains/:id/access" element={<AccessPage />} />
        <Route path="brains/:id/fields" element={<FieldsPage />} />
        <Route path="brains/:id/import" element={<ImportPage />} />
        <Route path="brains/:id/journal" element={<JournalPage />} />
        <Route path="brains/:id/coach" element={<CoachPage />} />
        <Route path="brains/:id/activity" element={<ActivityPage />} />
        <Route path="brains/:id/trash" element={<TrashPage />} />
        <Route path="settings/*" element={<Settings />} />
        <Route path="sources/:id" element={<SourceView />} />
        <Route
          path="*"
          element={
            <div className="page v4page">
              <Empty title="Page not found">Use the sidebar to go back.</Empty>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
