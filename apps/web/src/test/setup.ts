import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// findBy and waitFor wait up to 1 s by default; a full run keeps the CPU busy and jsdom renders of the
// larger views then take longer than that. Waiting longer costs nothing when the element is already there.
configure({ asyncUtilTimeout: 5000 });
